"""Offline fail-closed #659 GOV85 GitHub→GCP delivery control checks."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "guard659", ROOT / "scripts/gcp/gov85_659_stage1_guard.py"
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def baseline():
    return {
        "spec": {"template": {"spec": {
            "serviceAccountName": guard.SA,
            "containers": [{"image": "image@"+guard.OLD_DIGEST, "env": [
                {"name": "APP_ENV", "value": "dev"},
                {"name": "JSCC_RUNTIME_BACKEND", "value": "gcp"},
                {"name": "SEARCH_MODE", "value": "disabled"},
                {"name": "SOURCE_SHA", "value": "a"*40},
                {"name": "RUNTIME_DATA_SHA", "value": "a"*40},
                {"name": "NILE_DATABASE_URL", "valueSource": {"secretKeyRef": {"name": "nile", "key": "1"}}},
            ]}],
        }}},
        "status": {"traffic": [{"revisionName": guard.OLD_REV, "percent": 100}]},
    }


def staged(sha="b"*40):
    old=baseline()
    new=deepcopy(old)
    env=new["spec"]["template"]["spec"]["containers"][0]["env"]
    for name in ["SOURCE_SHA", "RUNTIME_DATA_SHA"]:
        next(x for x in env if x["name"]==name)["value"]=sha
    env.append({"name":"JSCC_PERF_TELEMETRY","value":"1"})
    new["status"]["traffic"].append({
        "revisionName":"jscc-command-api-dev-00100-stg",
        "percent":0,"tag":"perf659",
        "url":"https://perf659---jscc-command-api-dev-example.run.app"
    })
    return new


class Stage1GuardTest(unittest.TestCase):
    def denied(self, fn):
        with self.assertRaises(SystemExit) as cm:
            fn()
        self.assertEqual(cm.exception.code, 86)

    def test_known_native_dev_runtime_pass(self):
        self.assertIsNone(guard.assert_old(baseline()))

    def test_reject_wrong_project_env_revision_or_secret_mutation(self):
        for name, wrong in [
            ("APP_ENV","prod"), ("JSCC_RUNTIME_BACKEND","github"),
            ("SEARCH_MODE","live")
        ]:
            s=baseline()
            next(x for x in s["spec"]["template"]["spec"]["containers"][0]["env"]
                 if x["name"]==name)["value"]=wrong
            self.denied(lambda: guard.assert_old(s))
        s=baseline()
        s["status"]["traffic"][0]["revisionName"]="jscc-command-api-dev-00101-evil"
        self.denied(lambda: guard.assert_old(s))
        s=baseline()
        s["spec"]["template"]["spec"]["serviceAccountName"]="wrong@example.test"
        self.denied(lambda: guard.assert_old(s))

    def test_preflight_detects_concurrent_dev_config_changes(self):
        old=baseline()
        self.assertIsNone(guard.assert_no_intervening_dev_change(old,deepcopy(old)))
        changed=deepcopy(old)
        changed["spec"]["template"]["spec"]["containers"][0]["env"].append(
          {"name":"UNAPPROVED","value":"true"})
        self.denied(lambda:guard.assert_no_intervening_dev_change(old,changed))

    def test_immutable_build_reuse_requires_successful_exact_provenance(self):
        sha="b"*40
        digest="sha256:"+"c"*64
        tag=guard.IMAGE_REPO+":"+sha
        evidence={
            "status":"SUCCESS", "serviceAccount":guard.BUILD_SA,
            "substitutions":{"_GIT_SHA":sha}, "images":[tag],
            "results":{"images":[{"name":tag,"digest":digest}]},
        }
        self.assertTrue(guard.attest_service_image_build([evidence],sha,digest))
        for change in [
            {"status":"FAILURE"},
            {"serviceAccount":"projects/jscc-shared/serviceAccounts/wrong@example.test"},
            {"substitutions":{"_GIT_SHA":"a"*40}},
            {"images":["wrong"]},
            {"results":{"images":[{"name":tag,"digest":"sha256:"+"d"*64}]}},
        ]:
            bad={**evidence,**change}
            self.denied(lambda: guard.attest_service_image_build([bad],sha,digest))
        self.denied(lambda: guard.attest_service_image_build([],sha,digest))

    def test_full_template_guard_rejects_non_env_runtime_mutation(self):
        before=baseline()
        for field, value in [
            ("vpcAccess",{"connector":"unexpected"}),
            ("maxScale",7),
            ("volumes",[{"name":"changed"}]),
            ("containerConcurrency",9),
        ]:
            new=staged()
            new["spec"]["template"]["spec"][field]=value
            self.denied(lambda:guard.check_stage(before,new,"b"*40))
        preserved=staged()
        self.assertTrue(guard.immutable_template_equal(before,preserved))

    def test_script_uses_canonical_url_and_strict_impersonation(self):
        script=(ROOT/"scripts/gcp/gov85_659_stage1_dev.sh").read_text()
        self.assertIn('service_url="$(gcloud run services describe',script)
        self.assertIn('--audiences="$service_url"',script)
        self.assertIn('--impersonate-service-account="$GCP_WIF_SA"',script)
        self.assertNotIn('|| true',script)
        self.assertIn("JSCC659_CANONICAL_POST_CUTOVER_HEALTH=PASS",script)
        self.assertIn("/tmp/jscc659-before-cutover.json",script)
        self.assertIn("image-provenance",script)
        self.assertIn("JSCC659_AUTHENTICATED_DEV_PREFLIGHT=PASS",script)
        self.assertLess(script.index("JSCC659_AUTHENTICATED_DEV_PREFLIGHT=PASS"),
                        script.index("gcloud builds submit candidate"))
        self.assertIn("JSCC659_INVOKER_PREFLIGHT_DENIED",script)


    def test_exact_stage_retains_secret_binding_and_old_traffic(self):
        sha="b"*40
        self.assertIsNone(guard.check_stage(baseline(),staged(sha),sha))
        altered=staged(sha)
        altered["spec"]["template"]["spec"]["containers"][0]["env"][-2] = {
          "name":"NILE_DATABASE_URL","value":"insecure"}
        self.denied(lambda:guard.check_stage(baseline(),altered,sha))
        wrong=staged(sha)
        wrong["status"]["traffic"][0]["percent"]=0
        self.denied(lambda:guard.check_stage(baseline(),wrong,sha))
        self.denied(lambda:guard.check_stage(baseline(),staged(sha),"c"*40))

    def test_github_lane_is_immutable_and_owner_scoped(self):
        flow=(ROOT/".github/workflows/gov85-659-dev-stage1.yml").read_text()
        script=(ROOT/"scripts/gcp/gov85_659_stage1_dev.sh").read_text()
        for token in [
            "github.actor == 'Shosetzel69'",
            "github.event.issue.number == 659",
            "dbebc032710020d25e9060ba8bdc225ca3c8b446",
            "APPROVE_659_STAGE1_673_DEV_RELEASE_WITH_TELEMETRY",
            "checkout exact application candidate",
            "GCP_WIF_PROVIDER",
        ]:
            self.assertIn(token.lower(),flow.lower())
        self.assertIn("--no-traffic",script)
        self.assertIn("--to-revisions=",script)
        self.assertIn("JSCC659_STAGE1_CONFIG_PARITY=PASS",script)
        self.assertNotIn("run jobs execute",script.lower())
        self.assertNotIn("run jobs update",script.lower())
        self.assertNotIn("db:migrate",script.lower())
        self.assertNotIn("gcloud iam",script.lower())
        self.assertNotIn("cloudbuild.promotion.yaml",script.lower())


if __name__ == "__main__":
    unittest.main()
