import importlib.util
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/gcp/gov85_dev_scoped_exception.py"
spec = importlib.util.spec_from_file_location("gov85_dev_scope", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

VALID = dict(
    environment="dev",
    candidate_sha="121f88e212013d2c4665bb70f881a3bcee365d21",
    tickets="515,520,535",
    action="preflight",
)


class Gov85ExceptionAdmissionTests(unittest.TestCase):
    def test_exact_preflight_is_admitted_but_not_build_or_deploy(self):
        result = gate.admit(**VALID)
        self.assertEqual(result["decision"], "GOV85_DEV_SCOPED_PREFLIGHT_ADMITTED")
        self.assertFalse(result["build_authorized"])
        self.assertFalse(result["deploy_authorized"])
        self.assertFalse(result["legacy_exit86_override"])
        self.assertFalse(result["database_migration_authorized"])
        self.assertFalse(result["iam_change_authorized"])
        self.assertFalse(result["test_prod_authorized"])

    def test_exact_build_requires_additional_explicit_owner_gate(self):
        with self.assertRaisesRegex(ValueError, "DENIED"):
            gate.admit(**{**VALID, "action": "build-images"})
        with self.assertRaisesRegex(ValueError, "DENIED"):
            gate.admit(**{**VALID, "action": "build-images", "owner_gate": "APPROVED"})
        accepted = gate.admit(**{
            **VALID, "action": "build-images",
            "owner_gate": "APPROVE_GOV85_DEV_IMAGES_121F88",
        })
        self.assertTrue(accepted["build_authorized"])
        self.assertFalse(accepted["deploy_authorized"])
        self.assertFalse(accepted["legacy_exit86_override"])
        with self.assertRaisesRegex(ValueError, "DENIED"):
            gate.admit(**{**VALID, "owner_gate": "APPROVE_GOV85_DEV_IMAGES_121F88"})

    def test_out_of_scope_is_denied(self):
        mutations = [
            {"environment": "test"}, {"environment": "prod"},
            {"environment": "DEV"}, {"candidate_sha": "f"*40},
            {"candidate_sha": "121f88e212013d2c4665bb70f881a3bcee365d2"},
            {"tickets": "515,520,535,591"}, {"tickets": "535,520,515"},
            {"tickets": "515,520"}, {"tickets": "515,520,535 "},
            {"action": "build"}, {"action": "deploy"},
            {"action": "migrate"}, {"action": "dev-test"},
        ]
        for delta in mutations:
            with self.subTest(delta=delta), self.assertRaisesRegex(ValueError, "DENIED"):
                gate.admit(**{**VALID, **delta})

    def test_cli_denial_uses_original_guard_exit_code(self):
        cmd = [
            sys.executable, str(SCRIPT), "--environment", "test",
            "--candidate-sha", VALID["candidate_sha"], "--tickets",
            VALID["tickets"], "--action", "preflight",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 86)
        self.assertIn("GOV85_DEV_EXCEPTION_DENIED", result.stderr)

    def test_manual_github_lane_is_owner_and_sha_bound(self):
        workflow = (ROOT / ".github/workflows/gov85-dev-paired-images.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("\\n  push:", workflow)
        self.assertNotIn("\\n  schedule:", workflow)
        self.assertIn("121f88e212013d2c4665bb70f881a3bcee365d21", workflow)
        self.assertIn('test "$ACTOR" = Shosetzel69', workflow)
        self.assertIn("gov85_dev_scoped_exception.py", workflow)
        self.assertIn('--action "$INPUT_ACTION"', workflow)
        self.assertIn('--owner-gate "$INPUT_GATE"', workflow)
        self.assertIn("GOV85_PARTIAL_PAIR_MANUAL_REVIEW_REQUIRED", workflow)
        self.assertIn("GOV85_EXISTING_GCP_WIF_CONFIGURATION_REQUIRED", workflow)
        self.assertIn("gcloud builds submit candidate", workflow)
        self.assertIn("control/cloudbuild.gov85.dev-paired-images.yaml", workflow)
        self.assertNotIn("gcloud run jobs execute", workflow)
        self.assertNotIn("gcloud run services update", workflow)
        self.assertNotIn("gcloud run deploy", workflow)
        self.assertNotIn("gcloud run jobs deploy", workflow)
        self.assertNotIn("run_db_migration.sh", workflow)

    def test_image_build_contract_cannot_promote_or_migrate(self):
        recipe = (ROOT / "cloudbuild.gov85.dev-paired-images.yaml").read_text(encoding="utf-8")
        self.assertIn("121f88e212013d2c4665bb70f881a3bcee365d21", recipe)
        self.assertIn("_CONTROL_SHA", recipe)
        self.assertIn("GOV85_IMMUTABLE_TAGS_REQUIRED", recipe)
        self.assertIn("GOV85_EXISTING_IMAGE_NO_REBUILD", recipe)
        self.assertIn("GOV85_IMAGE_ONLY_COMPLETE_NO_DEPLOY", recipe)
        self.assertIn("Dockerfile.service", recipe)
        self.assertIn("jscc-service:${_GIT_SHA}", recipe)
        self.assertIn("jscc:${_GIT_SHA}", recipe)
        self.assertNotIn('gcloud run jobs deploy', recipe)
        self.assertNotIn('gcloud run deploy', recipe)
        self.assertNotIn('bash scripts/gcp/promote.sh ', recipe)
        self.assertNotIn('run_db_migration.sh', recipe)
        self.assertNotIn('reconcile_job_invocation_iam.sh', recipe)
        self.assertNotIn('target=dev-test', recipe)

    def test_legacy_mutation_guards_still_active(self):
        cloudbuild = (ROOT / "cloudbuild.promotion.yaml").read_text(encoding="utf-8")
        promote = (ROOT / "scripts/gcp/promote.sh").read_text(encoding="utf-8")
        self.assertIn('exit 86', cloudbuild.split('  - id: regression')[0])
        self.assertIn('exit 86', promote.split('ENVIRONMENT=')[0])


if __name__ == "__main__":
    unittest.main()
