"""Source-only guard for ATC-539-M01-DEV-CI-R2 (no provider calls)."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
M01 = (ROOT / "cloudbuild.m01.dev.yaml").read_text(encoding="utf-8")
LEGACY = (ROOT / "cloudbuild.promotion.yaml").read_text(encoding="utf-8")
PROMOTE = (ROOT / "scripts/gcp/promote.sh").read_text(encoding="utf-8")

class M01SourceOnlyContract(unittest.TestCase):
    def test_dedicated_ci_identity(self):
        self.assertIn('serviceAccount: projects/jscc-shared/serviceAccounts/jscc-ci-m01@jscc-shared.iam.gserviceaccount.com', M01)
        self.assertIn('logging: CLOUD_LOGGING_ONLY', M01)
        self.assertNotIn('jscc-build@', M01)
        self.assertNotIn('jscc-ops-build@', M01)

    def test_early_stop_is_first_and_only_step(self):
        ids = re.findall(r'^  - id: (.+)$', M01, re.MULTILINE)
        self.assertEqual(ids, ['authorization-stop'])
        self.assertIn('sys.exit(86)', M01)
        self.assertIn('JSCC539_M01_R2_NOT_AUTHORIZED_FOR_CLOUD_BUILD_EXECUTION', M01)

    def test_no_mutating_provider_or_network_commands(self):
        forbidden = ('gcloud ', 'docker ', 'npm ', 'curl ', 'git ', 'gsutil ',
                     'run deploy', 'builds submit', 'artifacts docker',
                     'storage cp', 'set-iam-policy', 'add-iam-policy-binding',
                     'NILE_DATABASE_URL=', 'DB_MIGRATION_MODE=migrate')
        for word in forbidden:
            with self.subTest(word=word):
                self.assertNotIn(word, M01)

    def test_legacy_guards_unchanged_semantically(self):
        self.assertRegex(LEGACY, r'(?s)id: validate-input.*?exit 86.*?id: regression')
        self.assertRegex(PROMOTE, r'(?s)^#!/usr/bin/env bash.*?exit 86\s+ENVIRONMENT=')

if __name__ == '__main__':
    unittest.main()
