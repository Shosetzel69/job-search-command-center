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
      "status":{"traffic":[{"revisionName":OLD,"percent":100}]}}
def staged():
    s=service()
    guard.shape(s)["containers"][0]["image"]=guard.IMAGE_REPO+"@"+DIGEST
    for e in guard.shape(s)["containers"][0]["env"]:
        if e["name"] in ("SOURCE_SHA","RUNTIME_DATA_SHA"): e["value"]=SHA
    s["status"]["traffic"].append({
      "revisionName":NEW,"percent":0,"tag":TAG,
      "url":"https://gdabc---jscc-command-api-dev-abc.a.run.app"})
    return s

def deny(fn,*args):
    with contextlib.redirect_stderr(io.StringIO()):
        with unittest.TestCase().assertRaises(SystemExit) as exc:
            fn(*args)
    return exc.exception.code

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
        names=["validate","Nile-only native provider CI","gitleaks","api-version-policy","snapshot"]
        checks={"check_runs":[{"name":n,"head_sha":SHA,"status":"completed",
           "conclusion":"success","app":{"slug":"github-actions"}} for n in names]}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_ci(checks,SHA)
        checks["check_runs"][0]["conclusion"]="failure"
        self.assertEqual(deny(guard.check_ci,checks,SHA),86)
        image=guard.IMAGE_REPO+":"+SHA
        build={"status":"SUCCESS","serviceAccount":guard.BUILD_SA,
               "substitutions":{"_GIT_SHA":SHA},"images":[image],
               "results":{"images":[{"name":image,"digest":DIGEST}]}}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.attest_build([build],SHA,DIGEST)
        build["serviceAccount"]="wrong"
        self.assertEqual(deny(guard.attest_build,[build],SHA,DIGEST),86)

    def test_latest_check_fails_even_when_older_check_passed(self):
        names=list(guard.REQUIRED_CHECKS)
        checks={"check_runs":[{"name":n,"id":i+1,"head_sha":SHA,
             "status":"completed","conclusion":"success",
             "app":{"slug":"github-actions"}} for i,n in enumerate(names)]}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_ci(checks,SHA)
        stale={"name":"validate","id":999,"head_sha":SHA,
               "status":"completed","conclusion":"failure",
               "app":{"slug":"github-actions"}}
        checks["check_runs"].append(stale)
        self.assertEqual(deny(guard.check_ci,checks,SHA),86)

    def test_ci_filter_latest_paginates_more_than_100_runs(self):
        calls=[]
        def fake_fetch(url):
            parsed=urllib.parse.urlparse(url)
            params=urllib.parse.parse_qs(parsed.query)
            self.assertEqual(params["filter"],["latest"])
            self.assertEqual(params["per_page"],["100"])
            name=params["check_name"][0]
            page=int(params["page"][0])
            calls.append((name,page))
            n=100 if name=="validate" and page==1 else 1 if page==1 or (name=="validate" and page==2) else 0
            return {"check_runs":[{
                "name":name,"id":(page-1)*100+i+1,
                "head_sha":SHA,"status":"completed",
                "conclusion":"success","app":{"slug":"github-actions"}
            } for i in range(n)]}
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/"ci.json"
            with contextlib.redirect_stdout(io.StringIO()):
                guard.fetch_ci_snapshot(SHA,output,fetch_json=fake_fetch)
            payload=json.loads(output.read_text())
            self.assertEqual(len(payload["check_runs"]),105)
        self.assertIn(("validate",2),calls)
        self.assertEqual(len(calls),6)

    def test_noninteractive_cloudshell_release_is_rejected_before_gcloud(self):
        p=subprocess.run(["bash",str(CLOUD),SHA,"jscc-dev-v1.0.0","deploy"],
                         input="DEPLOY DEV "+SHA+"\n",capture_output=True,text=True)
        self.assertEqual(p.returncode,86)
        self.assertIn("JSCC_CLOUD_DEPLOY_INTERACTIVE_TTY_REQUIRED",p.stdout)

    def test_release_auth_and_health(self):
        approved={"tag_name":"jscc-dev-v1.0.0","draft":False,
                  "prerelease":False,"author":{"login":"Shosetzel69"},"id":234}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check_release(approved,SHA,"jscc-dev-v1.0.0")
            guard.check_health({"status":"ok","environment":"dev",
              "runtime_backend":"gcp","search_mode":"disabled",
              "source_sha":SHA,"runtime_data_sha":SHA},"staged",SHA)
            guard.check_db({"status":"ok","database":"jobsearch_dev"})
        bad=copy.deepcopy(approved);bad["draft"]=True
        self.assertEqual(deny(guard.check_release,bad,SHA,"jscc-dev-v1.0.0"),86)
        bad=copy.deepcopy(approved);bad["author"]["login"]="untrusted"
        self.assertEqual(deny(guard.check_release,bad,SHA,"jscc-dev-v1.0.0"),86)
        self.assertEqual(deny(guard.check_health,
           {"status":"ok","environment":"prod","runtime_backend":"gcp","search_mode":"disabled"},
           "baseline",SHA),86)

    def test_github_automatic_release_triggers_with_human_gate(self):
        w=WORKFLOW.read_text()
        for required in ("name: GitDeploy","release:","types: [published]",
            "workflow_dispatch:","github.event_name == 'workflow_dispatch'",
            "environment: dev","required_reviewers","prevent_self_review",
            ".can_admins_bypass == false",
            '.reviewer.login!="Shosetzel69"',"actions: write",
            "id-token: write","GCP_WIF_PROVIDER","GCP_WIF_SA",
            "GitDeploy.sh preflight","GitDeploy.sh deploy",
            "bash -n scripts/deploy/GCloudDeploy.sh"):
            self.assertIn(required,w,required)
        self.assertNotIn("issue_comment:",w)
        self.assertNotIn("push:",w)
        self.assertLess(w.index("GITDEPLOY_RELEASE_GATE=PASS"),
                        w.index("Authenticate via DEV WIF"))
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
            "rollback","cleanup-tag","attest","sha256:","GITHUB_REF",
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
