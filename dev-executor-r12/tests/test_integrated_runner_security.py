"""Safety regression checks against the actually integrated Cloud Run runner."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "ops" / "dev-executor" / "runner"
GATEWAY = ROOT / "ops" / "src" / "gateway.mjs"

class IntegratedRunnerSafety(unittest.TestCase):
    def test_fail_closed_flags(self):
        text = (RUNNER / "executor.py").read_text()
        self.assertIn("JSCC_DEV_ENABLE_", text)
        self.assertIn("ops_lockfile_missing", text)
        self.assertIn("npm','ci','--ignore-scripts'", text)
    def test_no_subprocess_stderr_in_evidence(self):
        text = (RUNNER / "executor.py").read_text()
        self.assertNotIn("p.stderr[-1000:]", text)
        self.assertNotIn("result['error']=str(e)", text)
        self.assertIn("result['error_code']=type(e).__name__", text)
    def test_gateway_off_by_default(self):
        self.assertIn("JSCC_DEV_EXECUTOR_API_ENABLED !== 'true'", GATEWAY.read_text())
    def test_runner_deployment_separated(self):
        docker = (ROOT / "ops" / "dev-executor" / "Dockerfile").read_text()
        self.assertIn('USER runner', docker)
        self.assertIn('/app/job-entrypoint.py', docker)

if __name__ == "__main__":
    unittest.main()
