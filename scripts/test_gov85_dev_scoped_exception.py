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

    def test_legacy_mutation_guards_still_active(self):
        cloudbuild = (ROOT / "cloudbuild.promotion.yaml").read_text(encoding="utf-8")
        promote = (ROOT / "scripts/gcp/promote.sh").read_text(encoding="utf-8")
        self.assertIn('exit 86', cloudbuild.split('  - id: regression')[0])
        self.assertIn('exit 86', promote.split('ENVIRONMENT=')[0])


if __name__ == "__main__":
    unittest.main()
