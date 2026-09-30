import pathlib
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
PROMOTE=(ROOT/"scripts/gcp/promote.sh").read_text()
ENV=(ROOT/"scripts/gcp/environment.sh").read_text()
SEED=(ROOT/"scripts/gcp/seed_runtime.sh").read_text()
LEGACY=(ROOT/"scripts/gcp/deploy_dev_job.sh").read_text()
BUILD=(ROOT/"cloudbuild.promotion.yaml").read_text()

class GcpPromotionContractTests(unittest.TestCase):
    def test_supported_environments_are_bounded(self):
        self.assertIn("dev|test", ENV)
        self.assertNotIn("prod)", ENV)

    def test_no_historical_sha_or_digest_is_hard_coded(self):
        for text in (PROMOTE,ENV,SEED,LEGACY,BUILD):
            self.assertNotIn("4a8671f60b263a062002e9b3b619170dcc6644cc", text)
            self.assertNotIn("69a486fe75cf082715023e03aa9725358d67b5efb3cc5b8d2e7200c26f96292f", text)

    def test_promotion_resolves_both_immutable_digests(self):
        self.assertIn("JOB_IMAGE_REPO", PROMOTE)
        self.assertIn("SERVICE_IMAGE_REPO", PROMOTE)
        self.assertGreaterEqual(PROMOTE.count("image_summary.digest"),2)

    def test_test_requires_dev_evidence_for_same_candidate(self):
        self.assertIn("TEST promotion requires DEV evidence file", PROMOTE)
        self.assertIn("--candidate-sha", PROMOTE)
        self.assertIn("--environment dev", PROMOTE)

    def test_health_and_db_are_both_gated(self):
        self.assertIn('/health")', PROMOTE)
        self.assertIn('/health/db")', PROMOTE)
        self.assertIn('EXPECTED_DATABASE', PROMOTE)

    def test_job_invoker_binding_is_applied_after_job_deploy(self):
        deploy = PROMOTE.index('gcloud run jobs deploy')
        bind = PROMOTE.index('gcloud run jobs add-iam-policy-binding')
        service = PROMOTE.index('gcloud run services deploy')
        self.assertLess(deploy, bind)
        self.assertLess(bind, service)
        self.assertIn('roles/run.invoker', PROMOTE)

    def test_seed_runtime_is_invoked_through_bash(self):
        self.assertIn('bash "${ROOT}/scripts/gcp/seed_runtime.sh" "${ENVIRONMENT}"', PROMOTE)

    def test_cloud_run_service_uses_supported_deploy_command(self):
        self.assertIn('gcloud run deploy "${SERVICE_NAME}"', PROMOTE)
        self.assertNotIn('gcloud run services deploy', PROMOTE)

    def test_cloudbuild_reuses_artifacts_and_promotes_dev_first(self):
        self.assertIn("build-job-if-missing", BUILD)
        self.assertIn("build-service-if-missing", BUILD)
        self.assertLess(BUILD.index("promote-dev"), BUILD.index("promote-test"))

    def test_deprecated_wrapper_has_no_deploy_implementation(self):
        self.assertIn("DEPRECATED", LEGACY)
        self.assertIn('promote.sh" dev', LEGACY)
        self.assertNotIn("gcloud run jobs deploy", LEGACY)

if __name__=="__main__":
    unittest.main()
