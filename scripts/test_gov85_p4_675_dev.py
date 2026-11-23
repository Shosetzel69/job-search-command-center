"""P4 #675 DEV-only release control tests. No network and no cloud calls."""
import contextlib
import copy
import io
import unittest
from pathlib import Path

from scripts.gcp import gov85_p4_675_dev_guard as guard

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / "scripts/gcp/gov85_p4_675_dev_release.sh"
WORKFLOW = ROOT / ".github/workflows/gov85-p4-675-dev-service.yml"


def fixture():
    return {
        "spec": {"template": {"spec": {
            "serviceAccountName": guard.SA,
            "containers": [{"image": guard.IMAGE_REPO + "@sha256:" + "a"*64,
                            "env": [{"name": "APP_ENV", "value": "dev"},
                                    {"name": "JSCC_RUNTIME_BACKEND", "value": "gcp"},
                                    {"name": "SEARCH_MODE", "value": "disabled"},
                                    {"name": "SOURCE_SHA", "value": "old"},
                                    {"name": "RUNTIME_DATA_SHA", "value": "old"},
                                    {"name": "NILE_SECRET", "valueFrom": {"secretKeyRef": {"name": "nile"}}}]}],
            "containerConcurrency": 80, "timeoutSeconds": 300,
        }}},
        "status": {"traffic": [{"revisionName": guard.OLD_REV, "percent": 100}]},
    }


def staged(old):
    obj = copy.deepcopy(old)
    t = guard.template(obj)
    t["containers"][0]["image"] = guard.IMAGE_REPO + "@sha256:" + "b"*64
    for item in t["containers"][0]["env"]:
        if item["name"] in {"SOURCE_SHA", "RUNTIME_DATA_SHA"}:
            item["value"] = guard.TARGET_SHA
    obj["status"]["traffic"].append({
        "revisionName": "jscc-command-api-dev-00101-p4w",
        "percent": 0, "tag": guard.TAG,
        "url": "https://p4w1---jscc-command-api-dev-abc-ew.a.run.app"
    })
    return obj


def rejects(action, *args):
    with contextlib.redirect_stderr(io.StringIO()):
        with unittest.TestCase().assertRaises(SystemExit) as cm:
            action(*args)
    return cm.exception.code


class P4ReleaseControls(unittest.TestCase):
    def test_baseline_valid(self):
        with contextlib.redirect_stdout(io.StringIO()):
            guard.base(fixture())

    def test_baseline_serving_revision_or_environment_drift_denied(self):
        for change in ("revision", "environment", "account", "tag"):
            obj = fixture()
            if change == "revision":
                obj["status"]["traffic"][0]["revisionName"] = "jscc-command-api-dev-00102-x"
            if change == "environment":
                guard.template(obj)["containers"][0]["env"][0]["value"] = "prod"
            if change == "account":
                guard.template(obj)["serviceAccountName"] = "other@jscc-dev.iam.gserviceaccount.com"
            if change == "tag":
                obj["status"]["traffic"].append({"revisionName": "jscc-command-api-dev-00102-x", "tag": "p4w1", "percent": 0})
            self.assertEqual(rejects(guard.base, obj), 86, change)

    def test_unchanged_detects_external_configuration_or_traffic_change(self):
        original = fixture()
        drift = copy.deepcopy(original)
        guard.template(drift)["containerConcurrency"] = 200
        self.assertEqual(rejects(guard.unchanged, original, drift), 86)
        drift = copy.deepcopy(original)
        drift["status"]["traffic"][0]["percent"] = 99
        self.assertEqual(rejects(guard.unchanged, original, drift), 86)
        with contextlib.redirect_stdout(io.StringIO()):
            guard.unchanged(original, fixture())

    def test_staging_parity_success_and_final_100_percent(self):
        original = fixture()
        candidate = staged(original)
        with contextlib.redirect_stdout(io.StringIO()):
            guard.stage(original, candidate)
        final = copy.deepcopy(candidate)
        final["status"]["traffic"][0]["percent"] = 0
        final["status"]["traffic"][1]["percent"] = 100
        with contextlib.redirect_stdout(io.StringIO()):
            guard.final(candidate, final, "jscc-command-api-dev-00101-p4w")

    def test_staging_fails_closed_on_secret_vpc_scaling_sa_and_source_drift(self):
        original = fixture()
        for mutation in ("secret", "scale", "sa", "source", "traffic"):
            candidate = staged(original)
            if mutation == "secret":
                guard.template(candidate)["containers"][0]["env"][-1]["valueFrom"]["secretKeyRef"]["name"] = "different"
            elif mutation == "scale":
                guard.template(candidate)["containerConcurrency"] = 200
            elif mutation == "sa":
                guard.template(candidate)["serviceAccountName"] = "wrong"
            elif mutation == "source":
                next(x for x in guard.template(candidate)["containers"][0]["env"] if x["name"]=="SOURCE_SHA")["value"] = "bad"
            elif mutation == "traffic":
                candidate["status"]["traffic"][0]["percent"] = 99
            self.assertEqual(rejects(guard.stage, original, candidate), 86, mutation)

    def test_image_provenance_must_match_digest_sha_and_build_service_account(self):
        digest="sha256:" + "b"*64
        image=guard.IMAGE_REPO + ":" + guard.TARGET_SHA
        build={"status": "SUCCESS",
               "serviceAccount": guard.BUILD_SA,
               "substitutions": {"_GIT_SHA": guard.TARGET_SHA},
               "images": [image],
               "results": {"images":[{"name":image,"digest":digest}]}}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.attest([build],digest)
        for changed in ("status","serviceAccount","_GIT_SHA","digest"):
            b=copy.deepcopy(build)
            if changed=="status": b["status"]="FAILURE"
            if changed=="serviceAccount": b["serviceAccount"]="wrong"
            if changed=="_GIT_SHA": b["substitutions"]["_GIT_SHA"]="0"*40
            if changed=="digest": b["results"]["images"][0]["digest"]="sha256:"+"c"*64
            self.assertEqual(rejects(guard.attest,[b],digest),86,changed)

    def test_shell_has_strict_owner_source_release_gate_and_rollback(self):
        shell=SHELL.read_text(encoding="utf8")
        for required in (guard.TARGET_SHA,guard.OLD_REV,guard.OLD_DIGEST,
                         "GITHUB_REPOSITORY", "GITHUB_ACTOR", "GITHUB_SHA",
                         "APPROVE_P4_675_B8FA506_DEV_SERVICE_ONLY",
                         "cloudbuild.531.dev-service.yaml",
                         "gcloud builds submit candidate",
                         "python3 \"$guard\" unchanged",
                         "python3 \"$guard\" stage",
                         "--no-traffic", "--to-revisions=", "trap 'rollback' ERR"):
            self.assertIn(required,shell,required)
        self.assertLess(shell.index("if [[ \"$mode\" == preflight ]]"),shell.index("gcloud builds submit"))
        for prohibited in ("gcloud run jobs deploy", "gcloud run jobs execute",
                           "gcloud sql", "run_db_migration.sh",
                           "cloudbuild.promotion.yaml", "scripts/gcp/promote.sh",
                           "add-iam-policy-binding"):
            self.assertNotIn(prohibited,shell,prohibited)

    def test_workflow_identity_uses_owner_issue663_and_no_automatic_deploy(self):
        workflow=WORKFLOW.read_text(encoding="utf8")
        for required in ("github.event.issue.number == 663",
                         "github.actor == 'Shosetzel69'",
                         "'/jscc-p4-675 '",
                         guard.TARGET_SHA,
                         "pulls/675", "check-runs",
                         "environment: dev",
                         "GCP_WIF_PROVIDER", "GCP_WIF_SA",
                         "github.event.comment.body",
                         "gov85_p4_675_dev_release.sh"):
            self.assertIn(required,workflow,required)
        self.assertNotIn("workflow_dispatch:",workflow)
        self.assertNotIn("push:",workflow)
        self.assertNotIn("test_prod",workflow.lower())


if __name__ == "__main__":
    unittest.main()
