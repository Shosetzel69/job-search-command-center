import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "gcp" / "runtime_seed_files.txt"
DEPLOY = ROOT / "scripts" / "gcp" / "deploy_dev_job.sh"

EXPECTED = {
    "applications.json",
    "jobs.json",
    "run-history.json",
    "run-status.json",
    "search-config.json",
    "search-state.json",
}

class RuntimeSeedManifestTests(unittest.TestCase):
    def test_manifest_is_exact_and_complete(self):
        files = {line.strip() for line in MANIFEST.read_text().splitlines() if line.strip()}
        self.assertEqual(files, EXPECTED)

    def test_dev_provisioning_uses_manifest_and_applications(self):
        script = DEPLOY.read_text()
        self.assertIn('SEED_MANIFEST="scripts/gcp/runtime_seed_files.txt"', script)
        self.assertIn('cp data/applications.json "${seed_dir}/applications.json"', script)
        self.assertIn('done < "${SEED_MANIFEST}"', script)
        self.assertIn('Missing mandatory runtime seed file', script)
        self.assertIn('Runtime seed verification failed', script)

if __name__ == "__main__":
    unittest.main()
