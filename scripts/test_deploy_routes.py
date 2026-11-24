"""#492 dual-route deployment source and fail-closed policy tests; no GCP calls."""
import copy
import contextlib
import io
import json
import re
import subprocess
import tempfile
import urllib.parse
import unittest
from pathlib import Path

from scripts.deploy import jscc_deploy_guard as guard

ROOT=Path(__file__).resolve().parents[1]
WORKFLOW=ROOT/".github/workflows/GitDeploy.yml"
GIT=ROOT/"scripts/deploy/GitDeploy.sh"
CLOUD=ROOT/"scripts/deploy/GCloudDeploy.sh"
ENGINE=ROOT/"scripts/deploy/jscc-dev-service.sh"
SHA="a"*40
TAG="gd"+SHA[:10]
OLD="jscc-command-api-dev-00100-mek"
NEW="jscc-command-api-dev-00101-abc"
DIGEST="sha256:"+"b"*64

def service(sha="old"):
    return {
      "metadata":{"annotations":{"run.googleapis.com/ingress":"internal-and-cloud-load-balancing"}},
      "spec":{"template":{
        "metadata":{"annotations":{
          "run.googleapis.com/vpc-access-connector":"projects/jscc-dev/locations/europe-west1/connectors/existing",
          "autoscaling.knative.dev/maxScale":"3"}},
        "spec":{"serviceAccountName":guard.RUNTIME_SA,
          "containers":[{"image":guard.IMAGE_REPO+"@sha256:"+"c"*64,
          "env":[{"name":"APP_ENV","value":"dev"},
                 {"name":"JSCC_RUNTIME_BACKEND","value":"gcp"},
                 {"name":"SEARCH_MODE","value":"disabled"},
                 {"name":"SOURCE_SHA","value":sha},
                 {"name":"RUNTIME_DATA_SHA","value":sha},
                 {"name":"NILE_SECRET","valueFrom":{"secretKeyRef":{"name":"nile"}}}]}]}}},
      "status":{"traffic":[{"revisionName":OLD,"percent":100}],
                "latestCreatedRevisionName":OLD,"latestReadyRevisionName":OLD}}
def staged():
    s=service()
    guard.shape(s)["containers"][0]["image"]=guard.IMAGE_REPO+"@"+DIGEST
    for e in guard.shape(s)["containers"][0]["env"]:
        if e["name"] in ("SOURCE_SHA","RUNTIME_DATA_SHA"): e["value"]=SHA
    s["status"]["traffic"].append({
      "revisionName":NEW,"percent":0,"tag":TAG,
      "url":"https://gdabc---jscc-command-api-dev-abc.a.run.app"})
    s["status"]["latestCreatedRevisionName"]=NEW
    s["status"]["latestReadyRevisionName"]=NEW
    return s

def revision(name=OLD, sha="old", digest="sha256:"+"c"*64):
    container=copy.deepcopy(guard.shape(service(sha))["containers"][0])
    container["image"]=guard.IMAGE_REPO+"@"+digest
    return {"metadata":{"name":name},
            "spec":{"serviceAccountName":guard.RUNTIME_SA,
                    "containers":[container]},
            "status":{"imageDigest":guard.IMAGE_REPO+"@"+digest}}

def deny(fn,*args):
    with contextlib.redirect_stderr(io.StringIO()):
        with unittest.TestCase().assertRaises(SystemExit) as exc:
            fn(*args)
    return exc.exception.code

def canonical_check(name, job_id, run_id, conclusion="success", sha=SHA):
    return {"name":name, "id":job_id, "head_sha":sha,
            "status":"completed", "conclusion":conclusion,
            "app":{"slug":"github-actions"},
            "details_url":(
                f"https://github.com/Shosetzel69/job-search-command-center/"
                f"actions/runs/{run_id}/job/{job_id}")}

def canonical_run(name, run_id, sha=SHA):
    path, workflow_name = guard.REQUIRED_WORKFLOWS[name]
    return {"id":run_id, "path":path, "name":workflow_name,
            "event":"push", "head_sha":sha, "head_branch":"main",
            "status":"completed", "conclusion":"success"}

def ci_fixture():
    checks = [canonical_check(name, i+1, 101+i)
              for i, name in enumerate(guard.REQUIRED_CHECKS)]
    runs = {str(101+i): canonical_run(name,101+i)
            for i,name in enumerate(guard.REQUIRED_CHECKS)}
    return {"check_runs":checks, "workflow_runs":runs}

class DeployRoutes(unittest.TestCase):
    def test_baseline_guards_environment_and_tag(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.baseline(service(),SHA,TAG),OLD)
        for variant in ("sa","env","tag","traffic","sha"):
            obj=service()
            sha=SHA
            if variant=="sa": guard.shape(obj)["serviceAccountName"]="other"
            if variant=="env": obj["spec"]["template"]["spec"]["containers"][0]["env"][0]["value"]="prod"
            if variant=="tag": obj["status"]["traffic"].append({"tag":TAG,"percent":0,"revisionName":NEW})
            if variant=="traffic": obj["status"]["traffic"][0]["percent"]=99
            if variant=="sha": sha="bad"
            self.assertEqual(deny(guard.baseline,obj,sha,TAG),86,variant)

    def test_already_serving_same_sha_preflight_is_idempotent(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(service(), revision(), SHA, TAG), "NEW")
        live=staged()
        live["status"]["traffic"]=[{"revisionName":NEW,"percent":100,"tag":TAG,
            "url":"https://gdabc---jscc-command-api-dev-abc.a.run.app"}]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(live, revision(NEW,SHA,DIGEST), SHA, TAG), "ALREADY_SERVING")
        # Cloud Run can retain a 0%-traffic tag entry for the same 100%-serving revision.
        live["status"]["traffic"]=[
            {"revisionName":NEW,"percent":100},
            {"revisionName":NEW,"percent":0,"tag":TAG,
             "url":"https://gdabc---jscc-command-api-dev-abc.a.run.app"}]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(live, revision(NEW,SHA,DIGEST), SHA, TAG), "ALREADY_SERVING")
        engine=ENGINE.read_text()
        self.assertIn('deployment-state "$work/before.json" "$work/serving-revision.json"',engine)
        self.assertIn('if [[ "$deploy_state" == ALREADY_SERVING ]]',engine)
        self.assertIn('python3 "$guard" health "$work/old-health.json" staged "$sha"',engine)
        self.assertIn('python3 "$guard" db "$work/already-db.json"',engine)
        self.assertIn("JSCC_DEPLOY_ALREADY_SERVING_PASS",engine)
        self.assertLess(engine.index('if [[ "$deploy_state" == ALREADY_SERVING ]]'),
                        engine.index('gcp builds list'))
        # The early return is before any staged or serving-traffic mutation.
        self.assertLess(engine.index('if [[ "$deploy_state" == ALREADY_SERVING ]]'),
                        engine.index('gcp run services update "$service"'))

    def test_m1_failed_stage_and_rollback_allow_same_sha_retry(self):
        failed=staged()  # new service template, old revision still serves
        failed["status"]["traffic"]=[{"revisionName":OLD,"percent":100}]
        # Staging failure: latest revision was attempted but not Ready.
        failed["status"]["latestReadyRevisionName"]=OLD
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(failed,revision(),SHA,TAG),"NEW")
        # Rollback: newest ready revision is the failed SHA, traffic is old.
        failed["status"]["latestReadyRevisionName"]=NEW
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(failed,revision(),SHA,TAG),"NEW")
        # Even if the service reports the serving revision as latest Ready,
        # its actual env SHA remains old and must not yield a false no-op.
        failed["status"]["latestReadyRevisionName"]=OLD
        failed["status"]["latestCreatedRevisionName"]=OLD
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(failed,revision(),SHA,TAG),"NEW")
        # The engine must fetch the active revision independently.
        engine=ENGINE.read_text()
        self.assertIn('gcp run revisions describe "$serving_rev"',engine)
        self.assertIn('deployment-state "$work/before.json" "$work/serving-revision.json"',engine)
        self.assertLess(engine.index('gcp run revisions describe "$serving_rev"'),
                        engine.index('deployment-state "$work/before.json"'))

    def test_m1_already_serving_requires_real_revision_source_digest_and_status(self):
        live=staged()
        live["status"]["traffic"]=[{"revisionName":NEW,"percent":100}]
        actual=revision(NEW,SHA,DIGEST)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.deployment_state(live,actual,SHA,TAG),"ALREADY_SERVING")
        for case in ("wrong_serving_revision","revision_source","revision_data_sha",
                     "revision_digest","mutable_revision_image","service_digest",
                     "newer_revision_pending"):
            svc=copy.deepcopy(live)
            rev=copy.deepcopy(actual)
            if case=="wrong_serving_revision": rev["metadata"]["name"]=OLD
            if case=="revision_source":
                next(e for e in rev["spec"]["containers"][0]["env"] if e["name"]=="SOURCE_SHA")["value"]="0"*40
            if case=="revision_data_sha":
                next(e for e in rev["spec"]["containers"][0]["env"] if e["name"]=="RUNTIME_DATA_SHA")["value"]="0"*40
            if case=="revision_digest": rev["status"]["imageDigest"]=guard.IMAGE_REPO+"@sha256:"+"d"*64
            if case=="mutable_revision_image": rev["spec"]["containers"][0]["image"]="latest"
            if case=="service_digest":
                guard.shape(svc)["containers"][0]["image"]=guard.IMAGE_REPO+"@sha256:"+"d"*64
            if case=="newer_revision_pending": svc["status"]["latestCreatedRevisionName"]=OLD
            if case=="wrong_serving_revision":
                self.assertEqual(deny(guard.deployment_state,svc,rev,SHA,TAG),86,case)
            else:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(guard.deployment_state(svc,rev,SHA,TAG),"NEW",case)

    def test_collision_still_denied_for_foreign_revision_or_wrong_sha(self):
        live=staged()
        live["status"]["traffic"]=[{"revisionName":NEW,"percent":100,"tag":TAG}]
        bad=copy.deepcopy(live)
        bad["status"]["traffic"]=[{"revisionName":NEW,"percent":100},
                                   {"revisionName":OLD,"percent":0,"tag":TAG}]
        self.assertEqual(deny(guard.deployment_state,bad,revision(NEW,SHA,DIGEST),SHA,TAG),86)
        bad=copy.deepcopy(live)
        guard.env(bad)["SOURCE_SHA"]["value"]="b"*40
        self.assertEqual(deny(guard.deployment_state,bad,revision(NEW,SHA,DIGEST),SHA,TAG),86)
        bad=copy.deepcopy(live)
        guard.shape(bad)["containers"][0]["image"]="not-pinned"
        self.assertEqual(deny(guard.deployment_state,bad,revision(NEW,SHA,DIGEST),SHA,TAG),86)
        bad=copy.deepcopy(live)
        bad["status"]["traffic"].append({"revisionName":NEW,"percent":0,"tag":TAG})
        self.assertEqual(deny(guard.deployment_state,bad,revision(NEW,SHA,DIGEST),SHA,TAG),86)
        bad=copy.deepcopy(live)
        bad["status"]["traffic"]=[{"revisionName":NEW,"percent":50,"tag":TAG},
                                  {"revisionName":NEW,"percent":50}]
        self.assertEqual(deny(guard.deployment_state,bad,revision(NEW,SHA,DIGEST),SHA,TAG),86)

    def test_retire_all_owned_staging_tags_preserving_100_percent_traffic(self):
        final=staged()
        other_tag="gd"+"1"*10
        legacy_tag="gd"+"2"*10
        final["status"]["traffic"]=[
            {"revisionName":NEW,"percent":100,"tag":TAG},
            {"revisionName":OLD,"percent":0,"tag":other_tag},
            {"revisionName":"jscc-command-api-dev-00099-abc","percent":0,
             "tag":legacy_tag},
            {"revisionName":OLD,"percent":0,"tag":"review-pin"}]
        with contextlib.redirect_stdout(io.StringIO()):
            plan=guard.retire_plan(final,SHA,NEW)
        self.assertEqual(plan,",".join(sorted((TAG,other_tag,legacy_tag))))
        after=copy.deepcopy(final)
        # Provider may remove an obsolete tagged row or retain it untagged.
        after["status"]["traffic"]=[
            {"revisionName":NEW,"percent":100},
            {"revisionName":OLD,"percent":0},
            {"revisionName":OLD,"percent":0,"tag":"review-pin"}]
        with contextlib.redirect_stdout(io.StringIO()):
            guard.retire_verify(final,after,SHA,NEW)
            self.assertEqual(guard.deployment_state(after,revision(NEW,SHA,DIGEST),SHA,TAG),"ALREADY_SERVING")
        shell=ENGINE.read_text()
        self.assertIn('python3 "$guard" retire-plan "$work/pre-retire.json"',shell)
        self.assertIn('python3 "$guard" retire-verify "$work/pre-retire.json"',shell)
        self.assertIn('gcp run services update-traffic "$service"',shell)
        self.assertIn('--remove-tags="$tags_to_retire"',shell)
        self.assertIn("JSCC_DEPLOY_STAGING_TAGS_RETIRED=PASS",shell)
        self.assertIn('if [[ "$mode" == deploy ]]; then\n    # A retry',shell)
        self.assertIn('retire_managed_tags "$old_rev"',shell)
        self.assertLess(shell.index('python3 "$guard" db "$work/final-db.json"'),
                        shell.index('retire_managed_tags "$staged_rev"'))
        self.assertLess(shell.index('retire_managed_tags "$staged_rev"'),
                        shell.rindex('JSCC_DEV_TECHNICAL_DEPLOY_PASS channel='))
        # A failed tag-only mutation must not intentionally roll back a healthy,
        # verified serving revision to a vulnerable prior version.
        self.assertLess(shell.index("cutover_attempted=0\nstage_attempted=0"),
                        shell.index('retire_managed_tags "$staged_rev"'))

    def test_live_cloudrun_omits_zero_percent_on_tagged_revision(self):
        obj=staged()
        current_tag=TAG
        old1="gd"+"5"*10
        old2="gd"+"6"*10
        old3="gd"+"7"*10
        obj["status"]["traffic"]=[
            {"revisionName":NEW,"percent":100},
            {"revisionName":NEW,"tag":current_tag,
             "url":"https://tag.example.run.app"},
            {"revisionName":OLD,"tag":old1},
            {"revisionName":"jscc-command-api-dev-00099-abc","tag":old2},
            {"revisionName":"jscc-command-api-dev-00098-abc","tag":old3},
            {"revisionName":OLD,"tag":"keepme"}]
        expected=",".join(sorted((current_tag,old1,old2,old3)))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.retire_plan(obj,SHA,NEW),expected)
        after=copy.deepcopy(obj)
        after["status"]["traffic"]=[
            {"revisionName":NEW,"percent":100},
            {"revisionName":OLD,"tag":"keepme"}]
        with contextlib.redirect_stdout(io.StringIO()):
            guard.retire_verify(obj,after,SHA,NEW)
        expected_reasons={
            "duplicate":"MANAGED_TAG_DUPLICATE",
            "explicit_null":"MANAGED_TAG_TRAFFIC_INVALID",
            "partial":"MANAGED_TAG_TRAFFIC_UNEXPECTED",
            "non_numeric":"MANAGED_TAG_TRAFFIC_INVALID",
            "bool":"MANAGED_TAG_TRAFFIC_INVALID",
            "fractional":"MANAGED_TAG_TRAFFIC_INVALID",
            "numeric_text":"MANAGED_TAG_TRAFFIC_INVALID",
        }
        for variant,reason in expected_reasons.items():
            with self.subTest(variant=variant):
                bad=copy.deepcopy(obj)
                if variant=="duplicate":
                    bad["status"]["traffic"].append({"revisionName":OLD,"tag":old1})
                elif variant=="explicit_null":
                    bad["status"]["traffic"][2]["percent"]=None
                elif variant=="partial":
                    bad["status"]["traffic"][2]["percent"]=1
                elif variant=="non_numeric":
                    bad["status"]["traffic"][2]["percent"]="not-a-number"
                elif variant=="bool":
                    bad["status"]["traffic"][2]["percent"]=False
                elif variant=="fractional":
                    bad["status"]["traffic"][2]["percent"]=0.5
                elif variant=="numeric_text":
                    bad["status"]["traffic"][2]["percent"]="100"
                captured=io.StringIO()
                # Isolate the unit under review: retire_plan may reject
                # malformed traffic earlier in its separate serving() guard.
                with contextlib.redirect_stderr(captured):
                    with self.assertRaises(SystemExit) as raised:
                        guard.managed_tags(bad)
                self.assertEqual(raised.exception.code,86)
                self.assertEqual(
                    captured.getvalue().strip(),
                    "JSCC_DEPLOY_DENIED="+reason)
                # The complete retirement path must independently fail closed.
                self.assertEqual(deny(guard.retire_plan,bad,SHA,NEW),86)

    def test_tag_retirement_fails_closed_on_foreign_or_ambiguous_tags(self):
        final=staged()
        final["status"]["traffic"]=[{"revisionName":NEW,"percent":100,"tag":TAG},
                                   {"revisionName":OLD,"percent":0,"tag":"gd"+"1"*10}]
        for case in ("wrong_sha","wrong_rev","wrong_env","bad_image",
                     "bad_tag","bad_rev","duplicate","partial_tag"):
            bad=copy.deepcopy(final)
            given_sha=SHA
            given_rev=NEW
            if case=="wrong_sha": given_sha="0"*40
            if case=="wrong_rev": given_rev=OLD
            if case=="wrong_env": guard.env(bad)["RUNTIME_DATA_SHA"]["value"]="0"*40
            if case=="bad_image": guard.shape(bad)["containers"][0]["image"]="mutable:latest"
            if case=="bad_tag": bad["status"]["traffic"][1]["tag"]="gdNOTHEX"
            if case=="bad_rev": bad["status"]["traffic"][1]["revisionName"]="evil"
            if case=="duplicate": bad["status"]["traffic"].append(
                {"revisionName":OLD,"percent":0,"tag":TAG})
            if case=="partial_tag": bad["status"]["traffic"][1]["percent"]=50
            self.assertEqual(deny(guard.retire_plan,bad,given_sha,given_rev),86,case)

    def test_tag_retirement_verifies_poststate_and_preserves_unrelated_tags(self):
        final=staged()
        final["status"]["traffic"]=[{"revisionName":NEW,"percent":100,"tag":TAG},
                                   {"revisionName":OLD,"percent":0,"tag":"review-pin"}]
        after=copy.deepcopy(final)
        del after["status"]["traffic"][0]["tag"]
        with contextlib.redirect_stdout(io.StringIO()):
            guard.retire_verify(final,after,SHA,NEW)
        for case in ("left_old_tag","changed_traffic","changed_secret",
                     "changed_unrelated_tag","changed_identity","changed_image"):
            bad=copy.deepcopy(after)
            if case=="left_old_tag": bad["status"]["traffic"][0]["tag"]=TAG
            if case=="changed_traffic":
                bad["status"]["traffic"][0]["percent"]=99
            if case=="changed_secret":
                guard.env(bad)["NILE_SECRET"]["valueFrom"]["secretKeyRef"]["name"]="wrong"
            if case=="changed_unrelated_tag":
                bad["status"]["traffic"][1]["tag"]="different-pin"
            if case=="changed_identity":
                guard.env(bad)["SOURCE_SHA"]["value"]="0"*40
            if case=="changed_image":
                guard.shape(bad)["containers"][0]["image"]="unauthorized:image"
            self.assertEqual(deny(guard.retire_verify,final,bad,SHA,NEW),86,case)

    def test_concurrent_change_rejected(self):
        before=service()
        after=copy.deepcopy(before)
        with contextlib.redirect_stdout(io.StringIO()):
            guard.unchanged(before,after,SHA,TAG)
        for variant in ("vpc","secret","scale","traffic","sa"):
            after=copy.deepcopy(before)
            if variant=="vpc":
                after["spec"]["template"]["metadata"]["annotations"]["run.googleapis.com/vpc-access-connector"]="other"
            elif variant=="secret":
                guard.shape(after)["containers"][0]["env"][-1]["valueFrom"]["secretKeyRef"]["name"]="other"
            elif variant=="scale":
                after["spec"]["template"]["metadata"]["annotations"]["autoscaling.knative.dev/maxScale"]="99"
            elif variant=="traffic":
                after["status"]["traffic"][0]["percent"]=40
            elif variant=="sa":
                guard.shape(after)["serviceAccountName"]="new"
            self.assertEqual(deny(guard.unchanged,before,after,SHA,TAG),86,variant)

    def test_staging_and_rollback_boundaries(self):
        before=service(); after=staged()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(guard.stage(before,after,SHA,TAG),NEW)
        final=copy.deepcopy(after)
        final["status"]["traffic"][0]["percent"]=0
        final["status"]["traffic"][1]["percent"]=100
        with contextlib.redirect_stdout(io.StringIO()):
            guard.final(before,final,SHA,TAG,NEW)
            guard.rollback(before,before,SHA,TAG)
        bad=staged()
        guard.shape(bad)["containers"][0]["env"][-1]["valueFrom"]["secretKeyRef"]["name"]="hijacked"
        self.assertEqual(deny(guard.stage,before,bad,SHA,TAG),86)
        self.assertEqual(deny(guard.final,before,after,SHA,TAG,NEW),86)
        self.assertEqual(deny(guard.rollback,before,final,SHA,TAG),86)

    def test_only_owned_zero_traffic_stage_tag_can_be_cleaned(self):
        obj=staged()
        with contextlib.redirect_stdout(io.StringIO()):
            guard.cleanup_tag(obj,SHA,TAG,DIGEST,NEW)
        for variant in ("foreign_rev","live_tag","foreign_sha"):
            bad=copy.deepcopy(obj); source=SHA
            if variant=="foreign_rev": bad["status"]["traffic"][1]["revisionName"]="other"
            if variant=="live_tag": bad["status"]["traffic"][1]["percent"]=1
            if variant=="foreign_sha": source="0"*40
            self.assertEqual(deny(guard.cleanup_tag,bad,source,TAG,DIGEST,NEW),86)

    def test_ci_and_build_attestation(self):
        payload=ci_fixture()
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_ci(payload,SHA)
        payload["check_runs"][0]["conclusion"]="failure"
        self.assertEqual(deny(guard.check_ci,payload,SHA),86)
        image=guard.IMAGE_REPO+":"+SHA
        build={"status":"SUCCESS","serviceAccount":guard.BUILD_SA,
               "substitutions":{"_GIT_SHA":SHA},"images":[image],
               "results":{"images":[{"name":image,"digest":DIGEST}]}}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.attest_build([build],SHA,DIGEST)
        build["serviceAccount"]="wrong"
        self.assertEqual(deny(guard.attest_build,[build],SHA,DIGEST),86)

    def test_latest_canonical_check_failure_beats_older_pass(self):
        payload=ci_fixture()
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_ci(payload,SHA)
        payload["check_runs"].append(
            canonical_check("validate",999,9999,conclusion="failure"))
        payload["workflow_runs"]["9999"]=canonical_run("validate",9999)
        self.assertEqual(deny(guard.check_ci,payload,SHA),86)

    def test_n1_foreign_validate_success_cannot_mask_command_api_failure(self):
        payload=ci_fixture()
        payload["check_runs"][0]["conclusion"]="failure"
        payload["check_runs"].append(canonical_check("validate",9999,9999))
        foreign=canonical_run("validate",9999)
        foreign["name"]="Validate Remote Executor"
        foreign["path"]=".github/workflows/remote-executor-check.yml"
        foreign["event"]="workflow_dispatch"
        payload["workflow_runs"]["9999"]=foreign
        self.assertEqual(deny(guard.check_ci,payload,SHA),86)
        # If the canonical check is healthy, a foreign job must not poison it.
        payload["check_runs"][0]["conclusion"]="success"
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_ci(payload,SHA)
        # Also deny a same-named job from the wrong workflow even with push.
        foreign["event"]="push"
        self.assertEqual(deny(guard.check_ci,{
            "check_runs":[x for x in payload["check_runs"] if x["id"]!=1],
            "workflow_runs":payload["workflow_runs"]},SHA),86)
        # Workflow metadata missing or mismatched must fail closed.
        payload["check_runs"][0]["conclusion"]="failure"
        foreign["path"]=".github/workflows/command-api-check.yml"
        self.assertEqual(deny(guard.check_ci,payload,SHA),86)

    def test_ci_workflow_binding_rejects_wrong_event_ref_and_sha(self):
        for field,value in (("event","workflow_dispatch"),
                            ("head_branch","feature/unsafe"),
                            ("path",".github/workflows/remote-executor-check.yml"),
                            ("head_sha","b"*40)):
            payload=ci_fixture()
            payload["workflow_runs"]["101"][field]=value
            self.assertEqual(deny(guard.check_ci,payload,SHA),86,field)
        payload=ci_fixture()
        payload["check_runs"][0]["details_url"]="https://evil.example/actions/runs/101/job/1"
        self.assertEqual(deny(guard.check_ci,payload,SHA),86)

    def test_ci_filter_latest_paginates_more_than_100_runs(self):
        calls=[]
        names=list(guard.REQUIRED_CHECKS)
        def fake_fetch(url):
            parsed=urllib.parse.urlparse(url)
            if "/actions/runs/" in parsed.path:
                run_id=int(parsed.path.rsplit("/",1)[-1])
                name=names[run_id-1000]
                calls.append(("workflow",run_id))
                return canonical_run(name,run_id)
            params=urllib.parse.parse_qs(parsed.query)
            self.assertEqual(params["filter"],["latest"])
            self.assertEqual(params["per_page"],["100"])
            name=params["check_name"][0]
            page=int(params["page"][0])
            calls.append((name,page))
            count=100 if name=="validate" and page==1 else (
                1 if page==1 or (name=="validate" and page==2) else 0)
            run_id=1000+names.index(name)
            return {"check_runs":[
                canonical_check(name,(page-1)*100+i+1,run_id)
                for i in range(count)]}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/"ci.json"
            with contextlib.redirect_stdout(io.StringIO()):
                guard.fetch_ci_snapshot(SHA,output,fetch_json=fake_fetch)
            payload=json.loads(output.read_text())
            self.assertEqual(len(payload["check_runs"]),105)
            self.assertEqual(len(payload["workflow_runs"]),5)
        self.assertIn(("validate",2),calls)
        self.assertEqual(len([c for c in calls if c[0]!="workflow"]),6)
        self.assertEqual(len([c for c in calls if c[0]=="workflow"]),5)

    def test_noninteractive_cloudshell_release_is_rejected_before_gcloud(self):
        p=subprocess.run(["bash",str(CLOUD),SHA,"deploy"],
                         input="DEPLOY DEV "+SHA+"\n",capture_output=True,text=True)
        self.assertEqual(p.returncode,86)
        self.assertIn("JSCC_CLOUD_DEPLOY_INTERACTIVE_TTY_REQUIRED",p.stdout)

    def test_sha_only_health_and_manual_contract(self):
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_health({"status":"ok","environment":"dev",
              "runtime_backend":"gcp","search_mode":"disabled",
              "source_sha":SHA,"runtime_data_sha":SHA},"staged",SHA)
            guard.check_db({"status":"ok","database":"jobsearch_dev"})
        self.assertEqual(deny(guard.check_health,
           {"status":"ok","environment":"prod","runtime_backend":"gcp","search_mode":"disabled"},
           "baseline",SHA),86)

    def test_gitdeploy_auto_after_main_ci_not_release(self):
        w=WORKFLOW.read_text()
        for required in ("name: GitDeploy","workflow_run:",
            'workflows: ["Validate Command API"]',"types: [completed]",
            "github.event.workflow_run.event == 'push'",
            "github.event.workflow_run.conclusion == 'success'",
            "environment: dev", "id-token: write","GCP_WIF_PROVIDER",
            "GitDeploy.sh preflight", "GitDeploy.sh deploy",
            "scripts.test_deploy_routes"):
            self.assertIn(required,w,required)
        self.assertNotIn("issue_comment:",w)
        self.assertNotIn("release:\n",w)
        self.assertNotIn("workflow_dispatch:\n",w)
        self.assertLess(w.index("GITDEPLOY_MAIN_SHA_ADMITTED=PASS"),
                        w.index("Authenticate via existing DEV WIF"))
        self.assertNotIn("environment: prod",w.lower())
        self.assertNotIn("environment: test",w.lower())

    def test_cloudshell_manual_and_execution_invariants(self):
        cloud=CLOUD.read_text(); engine=ENGINE.read_text()
        git=GIT.read_text()
        for required in ("CLOUD_SHELL","DEVSHELL_PROJECT_ID","[[ -t 0 && -t 1 && -r /dev/tty ]]",
            "gcloud auth list","git -C \"$root\" fetch origin main",
            "git -C \"$root\" worktree add --detach",
            "DEPLOY DEV $sha","IFS= read -r confirmation","preflight","deploy"):
            self.assertIn(required,cloud,required)
        for required in ("--no-traffic","--to-revisions=","--remove-tags=",
            "cloudbuild.531.dev-service.yaml","health/db",
            "rollback","cleanup-tag","attest","sha256:","JSCC_GITDEPLOY_SOURCE_SHA",
            "JSCC_CLOUDSHELL_ADMITTED"):
            self.assertIn(required,engine+git,required)
        for forbidden in ("gcloud run jobs deploy", "gcloud run jobs execute",
             "run_db_migration.sh","add-iam-policy-binding", "cloudbuild.promotion.yaml"):
            self.assertNotIn(forbidden,engine,forbidden)
        self.assertIn('channel=github',engine.replace("channel=$channel","channel=github"))
        self.assertIn("JSCC_DEV_FUNCTIONAL_ACCEPTANCE=PENDING",engine)
        self.assertIn("fetch-ci",engine)
        self.assertIn("^\u0028https://github[.]com/|git@github[.]com:\u0029",engine)
        self.assertIn("IFS= read -r confirmation </dev/tty",cloud)

if __name__=="__main__":
    unittest.main()
