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
        "metadata": {"annotations": {"run.googleapis.com/ingress": "internal-and-cloud-load-balancing"}},
        "spec": {"template": {"metadata": {"annotations": {
            "run.googleapis.com/vpc-access-connector": "projects/jscc-dev/locations/europe-west1/connectors/existing",
            "autoscaling.knative.dev/maxScale": "3",
            "run.googleapis.com/cloudsql-instances": "jscc-dev:europe-west1:existing",
        }}, "spec": {
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
        for mutation in ("secret", "scale", "sa", "source", "traffic", "vpc", "ingress"):
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
            elif mutation == "vpc":
                candidate["spec"]["template"]["metadata"]["annotations"]["run.googleapis.com/vpc-access-connector"] = "another"
            elif mutation == "ingress":
                candidate["metadata"]["annotations"]["run.googleapis.com/ingress"] = "all"
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

    def test_actual_github_job_names_exact_sha_and_app_identity(self):
        # Minimal projection of real GET /commits/b8fa506/check-runs evidence.
        # Workflow titles like "Validate Command API" are intentionally absent.
        names = ["snapshot", "validate", "gitleaks",
                 "Nile-only native provider CI", "api-version-policy"]
        checks = {"total_count": len(names), "check_runs": [
            {"name": name, "head_sha": guard.TARGET_SHA,
             "status": "completed", "conclusion": "success",
             "app": {"slug": "github-actions"}} for name in names
        ]}
        with contextlib.redirect_stdout(io.StringIO()):
            guard.postmerge_ci(checks, guard.TARGET_SHA)
        self.assertEqual(rejects(guard.postmerge_ci, checks, "0"*40), 86)
        for change in ("missing", "wrong_app", "wrong_sha", "failure", "pending"):
            stale = copy.deepcopy(checks)
            if change == "missing":
                stale["check_runs"].pop()
            elif change == "wrong_app":
                stale["check_runs"][0]["app"]["slug"] = "third-party"
            elif change == "wrong_sha":
                stale["check_runs"][0]["head_sha"] = "0"*40
            elif change == "failure":
                stale["check_runs"][0]["conclusion"] = "failure"
            elif change == "pending":
                stale["check_runs"][0]["status"] = "in_progress"
            self.assertEqual(rejects(guard.postmerge_ci, stale, guard.TARGET_SHA), 86, change)

    def test_last_modifier_metadata_is_not_sensitive_but_vpc_is(self):
        original = fixture()
        original["metadata"]["annotations"]["serving.knative.dev/lastModifier"] = "alice"
        original["spec"]["template"]["metadata"]["annotations"]["run.googleapis.com/lastModifier"] = "alice"
        candidate = staged(original)
        candidate["metadata"]["annotations"]["serving.knative.dev/lastModifier"] = "builder"
        candidate["spec"]["template"]["metadata"]["annotations"]["run.googleapis.com/lastModifier"] = "builder"
        with contextlib.redirect_stdout(io.StringIO()):
            guard.stage(original, candidate)
        candidate["metadata"]["annotations"]["run.googleapis.com/ingress"] = "all"
        self.assertEqual(rejects(guard.stage, original, candidate), 86)

    def test_safe_cleanup_only_own_staged_tag_after_old_traffic_restored(self):
        original = fixture()
        with contextlib.redirect_stdout(io.StringIO()):
            guard.cleanup_tag_revision(original)  # no tag => no action
        stage = staged(original)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            guard.cleanup_tag_revision(stage)
        self.assertIn("jscc-command-api-dev-00101-p4w", output.getvalue())
        for violation in ("new_serving", "foreign_source", "live_tag", "duplicate"):
            bad = copy.deepcopy(stage)
            if violation == "new_serving":
                bad["status"]["traffic"][0]["revisionName"] = "jscc-command-api-dev-00102-new"
            elif violation == "foreign_source":
                next(x for x in guard.template(bad)["containers"][0]["env"]
                     if x["name"] == "SOURCE_SHA")["value"] = "wrong"
            elif violation == "live_tag":
                bad["status"]["traffic"][1]["percent"] = 5
            elif violation == "duplicate":
                bad["status"]["traffic"].append(copy.deepcopy(bad["status"]["traffic"][1]))
            self.assertEqual(rejects(guard.cleanup_tag_revision, bad), 86, violation)
        with contextlib.redirect_stdout(io.StringIO()):
            guard.verify_rollback(original)
        rolled = copy.deepcopy(original)
        rolled["status"]["traffic"][0]["revisionName"] = "jscc-command-api-dev-00102-new"
        self.assertEqual(rejects(guard.verify_rollback, rolled), 86)

    def test_owner_scoped_github_only_dispatch_without_new_environment_policy(self):
        workflow = WORKFLOW.read_text(encoding="utf8")
        self.assertNotIn("environment-protection", workflow)
        self.assertNotIn("DEV_REQUIRED_REVIEWERS_MISSING", workflow)
        self.assertNotIn("gh api \"repos/$GITHUB_REPOSITORY/environments/dev\"", workflow)
        self.assertIn("postmerge-ci", workflow)
        self.assertNotIn('for name in "Validate Command API"', workflow)
        self.assertLess(workflow.index("postmerge-ci"),
                        workflow.index("Authenticate using existing DEV WIF"))
        self.assertIn("github.actor == 'Shosetzel69'",workflow)
        self.assertIn("github.event.issue.number == 663",workflow)
        self.assertIn("concurrency:", workflow)
        self.assertNotIn("\\nconcurrency:\\n", workflow)
        self.assertIn("environment: dev",workflow)

    def test_shell_has_strict_owner_source_release_gate_and_rollback(self):
        shell=SHELL.read_text(encoding="utf8")
        for required in (guard.TARGET_SHA,guard.OLD_REV,guard.OLD_DIGEST,
                         "GITHUB_REPOSITORY", "GITHUB_ACTOR", "GITHUB_SHA",
                         "APPROVE_P4_675_B8FA506_DEV_SERVICE_ONLY",
                         "cloudbuild.531.dev-service.yaml",
                         "gcloud builds submit candidate",
                         "python3 \"$guard\" unchanged",
                         "python3 \"$guard\" stage",
                         "--no-traffic", "--to-revisions=", "--remove-tags=p4w1",
                         "trap 'release_exit' EXIT", "trap 'exit 130' INT",
                         "trap 'exit 143' TERM",
                         "python3 \"$guard\" verify-rollback",
                         "python3 \"$guard\" cleanup-tag"):
            self.assertIn(required,shell,required)
        self.assertLess(shell.index("if [[ \"$mode\" == preflight ]]"),shell.index("gcloud builds submit"))
        for prohibited in ("gcloud run jobs deploy", "gcloud run jobs execute",
                           "gcloud sql", "run_db_migration.sh",
                           "cloudbuild.promotion.yaml", "scripts/gcp/promote.sh",
                           "add-iam-policy-binding"):
            self.assertNotIn(prohibited,shell,prohibited)

    def test_rollback_digest_accepts_only_expected_image_identity(self):
        import subprocess
        shell = SHELL.read_text(encoding="utf8")
        function = shell[shell.index("normalize_revision_digest(){"):
                         shell.index("\numask 077", shell.index("normalize_revision_digest(){"))]
        self.assertEqual(shell.count('normalize_revision_digest "$actual_old"'), 1)
        self.assertEqual(shell.count('normalize_revision_digest "$staged_digest"'), 1)
        self.assertEqual(shell.count('normalize_revision_digest "$rev_digest"'), 1)
        digest = guard.OLD_DIGEST
        repo = guard.IMAGE_REPO
        candidates = ((digest, 0, digest), (repo + "@" + digest, 0, digest),
                      ("other.example/image@" + digest, 1, ""),
                      (repo + "@sha256:" + "0" * 64, 0, "sha256:" + "0" * 64),
                      (repo + ":latest", 1, ""), ("", 1, ""))
        for actual, expected_code, expected_output in candidates:
            result = subprocess.run(
                ["bash", "-c", 'image_repo="$1"; ' + function +
                 '\nnormalize_revision_digest "$2"', "test", repo, actual],
                capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, expected_code, actual)
            self.assertEqual(result.stdout.strip(), expected_output, actual)
        for actual, accepted in (
            (digest, True), (repo + "@" + digest, True),
            ("other.example/image@" + digest, False),
            (repo + "@sha256:" + "0" * 64, False),
            (repo + ":latest", False), ("", False),
        ):
            for field in ("actual_old", "staged_digest", "rev_digest"):
                command = ('image_repo="$1"; ' + function +
                           '\nvalue="$(normalize_revision_digest "$2")" || exit 86; ' +
                           '[[ "$value" == "$3" ]] || exit 86')
                result = subprocess.run(
                    ["bash", "-c", command, field, repo, actual, digest],
                    capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0 if accepted else 86,
                                 (field, actual))
        for name, expected, error in (
            ("actual_old", "old_digest", "JSCC_P4_ROLLBACK_DIGEST_CHANGED"),
            ("staged_digest", "digest", "JSCC_P4_TAG_CLEANUP_DIGEST_UNVERIFIED"),
            ("rev_digest", "digest", "JSCC_P4_STAGED_DIGEST_INVALID"),
        ):
            self.assertIn(f'normalize_revision_digest "${name}"', shell)
            self.assertIn(f'[[ "${name}" == "${expected}" ]]', shell)
            self.assertIn(error, shell)

    def test_auth_diagnostic_is_redacted_and_fail_closed(self):
        shell = SHELL.read_text(encoding="utf8")
        self.assertIn("JSCC_P4_INVOCATION_DENIED_CLASS=IAM_PERMISSION", shell)
        self.assertIn("JSCC_P4_INVOCATION_DENIED_CLASS=AUDIENCE", shell)
        self.assertIn("JSCC_P4_INVOCATION_DENIED_CLASS=CREDENTIALS", shell)
        self.assertIn("JSCC_P4_INVOCATION_DENIED_CLASS=OTHER_REDACTED", shell)
        self.assertIn("echo JSCC_P4_INVOCATION_DENIED\\n  exit 86", shell)
        self.assertNotIn("cat /tmp/jscc-p4-auth-error", shell)

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
        self.assertIn("environment: dev",workflow)
        self.assertNotIn("environment: prod",workflow.lower())
        self.assertNotIn("environment: test",workflow.lower())


if __name__ == "__main__":
    unittest.main()
