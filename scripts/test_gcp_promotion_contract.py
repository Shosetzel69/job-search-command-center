import pathlib
import re
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
PROMOTE=(ROOT/"scripts/gcp/promote.sh").read_text()
ENV=(ROOT/"scripts/gcp/environment.sh").read_text()
SEED=(ROOT/"scripts/gcp/seed_runtime.sh").read_text()
LEGACY=(ROOT/"scripts/gcp/deploy_dev_job.sh").read_text()
BUILD=(ROOT/"cloudbuild.promotion.yaml").read_text()
IAM=(ROOT/"scripts/gcp/reconcile_job_invocation_iam.sh").read_text()
RUNTIME=(ROOT/"command-api/src/runtime-gcp.js").read_text()
LIVE=(ROOT/"scripts/gcp/capture_live_promotion_evidence.sh").read_text()
VERIFY_SEED=(ROOT/"scripts/gcp/verify_runtime_seed.sh").read_text()
VERIFY_EVIDENCE=(ROOT/"scripts/gcp/verify_promotion_evidence.py").read_text()
MIGRATE=(ROOT/"scripts/gcp/run_db_migration.sh").read_text()
PROMOTION_STATUS=(ROOT/"scripts/gcp/promotion_status.py").read_text()
PROTECTED=(ROOT/"shared/runtime-data.mjs").read_text()
SECURE=(ROOT/"command-api/src/secure-entry.js").read_text()

class GcpPromotionContractTests(unittest.TestCase):
    def test_supported_environments_are_bounded(self):
        self.assertIn("dev|test", ENV)
        self.assertNotIn("prod)", ENV)

    def test_no_historical_sha_or_digest_is_hard_coded(self):
        for text in (PROMOTE,ENV,SEED,LEGACY,BUILD,LIVE,VERIFY_SEED,VERIFY_EVIDENCE):
            self.assertNotIn("4a8671f60b263a062002e9b3b619170dcc6644cc", text)
            self.assertNotIn("69a486fe75cf082715023e03aa9725358d67b5efb3cc5b8d2e7200c26f96292f", text)

    def test_promotion_resolves_both_immutable_digests(self):
        self.assertIn("JOB_IMAGE_REPO", PROMOTE)
        self.assertIn("SERVICE_IMAGE_REPO", PROMOTE)
        self.assertGreaterEqual(PROMOTE.count("image_summary.digest"),2)

    def test_test_requires_dev_evidence_for_same_candidate_and_digests(self):
        self.assertIn("TEST promotion requires DEV evidence file", PROMOTE)
        self.assertIn("--candidate-sha", PROMOTE)
        self.assertIn("--environment dev", PROMOTE)
        self.assertIn("--job-digest", PROMOTE)
        self.assertIn("--service-digest", PROMOTE)
        self.assertIn('data.get("job_digest")==args.job_digest', VERIFY_EVIDENCE)
        self.assertIn('data.get("service_digest")==args.service_digest', VERIFY_EVIDENCE)

    def test_health_and_db_are_both_gated(self):
        self.assertIn('/health")', PROMOTE)
        self.assertIn('/health/db")', PROMOTE)
        self.assertIn('EXPECTED_DATABASE', PROMOTE)

    def test_job_override_iam_is_reconciled_after_job_deploy_before_service(self):
        deploy = PROMOTE.index('gcloud run jobs deploy')
        reconcile = PROMOTE.index('reconcile_job_invocation_iam.sh')
        service = PROMOTE.index('gcloud run deploy')
        self.assertLess(deploy, reconcile)
        self.assertLess(reconcile, service)

    def test_override_runtime_requires_override_capable_job_role(self):
        self.assertIn('overrides:{', RUNTIME)
        self.assertIn('roles/run.jobsExecutorWithOverrides', IAM)
        self.assertNotIn('roles/run.invoker', IAM)
        self.assertIn('gcloud run jobs add-iam-policy-binding', IAM)
        self.assertIn('gcloud run jobs get-iam-policy', IAM)

    def test_seed_runtime_modes_are_explicit(self):
        self.assertIn('SEED_MODE="${4:-provision}"', PROMOTE)
        self.assertIn('bash "${ROOT}/scripts/gcp/seed_runtime.sh" "${ENVIRONMENT}"', PROMOTE)
        self.assertIn('bash "${ROOT}/scripts/gcp/verify_runtime_seed.sh" "${ENVIRONMENT}"', PROMOTE)
        self.assertIn('verify-existing seed mode is only supported for TEST promotion', PROMOTE)

    def test_cloud_run_service_uses_supported_deploy_command(self):
        self.assertIn('gcloud run deploy "${SERVICE_NAME}"', PROMOTE)
        self.assertNotIn('gcloud run services deploy', PROMOTE)

    def test_cloud_run_service_receives_canonical_data_paths(self):
        expected = {
            'SEARCH_CONFIG_PATH':'data/search-config.json',
            'SOURCES_PATH':'data/sources.json',
            'SOURCE_CATEGORIES_PATH':'data/source-categories.json',
            'NOMENCLATURES_PATH':'data/nomenclatures.json',
            'APPLICATIONS_PATH':'data/applications.json',
        }
        for key, value in expected.items():
            self.assertIn(f'{key}={value}', PROMOTE)


    def test_cloud_run_url_gate_accepts_reported_url_and_probes_canonical_origin(self):
        self.assertIn('reported_service_url=', PROMOTE)
        self.assertIn('https://*.run.app', PROMOTE)
        self.assertIn('"${frontend_origin}/health"', PROMOTE)
        self.assertIn('"${frontend_origin}/health/db"', PROMOTE)
        self.assertNotIn('test "${service_url}" = "${frontend_origin}"', PROMOTE)

    def test_cloudbuild_reuses_artifacts_and_orders_dev_before_test(self):
        self.assertIn("build-job-if-missing", BUILD)
        self.assertIn("build-service-if-missing", BUILD)
        self.assertLess(BUILD.index("promote-dev"), BUILD.index("promote-test"))

    def test_cloudbuild_supports_exactly_dev_test_and_dev_test_chain(self):
        self.assertIn('_TARGET must be dev, test or dev-test', BUILD)
        self.assertIn('"${_TARGET}" == "test"', BUILD)
        self.assertIn('"${_TARGET}" == "dev-test"', BUILD)

    def test_standalone_test_does_not_promote_dev(self):
        promote_dev = BUILD[BUILD.index("- id: promote-dev"):BUILD.index("- id: promote-test")]
        self.assertIn('"${_TARGET}" == "dev" || "${_TARGET}" == "dev-test"', promote_dev)
        self.assertNotIn('"${_TARGET}" == "test"', promote_dev)

    def test_standalone_test_attests_live_dev_before_test_promotion(self):
        promote_test = BUILD[BUILD.index("- id: promote-test"):BUILD.index("- id: summarize")]
        self.assertIn('capture_live_promotion_evidence.sh dev', promote_test)
        self.assertIn('promote.sh test "${_GIT_SHA}" "artifacts/gcp-promotion/dev-${_GIT_SHA}.json" verify-existing', promote_test)
        self.assertLess(
            promote_test.index("capture_live_promotion_evidence.sh dev"),
            promote_test.index('promote.sh test'),
        )

    def test_test_only_allows_control_plane_sha_to_differ_but_dev_does_not(self):
        validation = BUILD[BUILD.index("- id: validate-input"):BUILD.index("- id: regression")]
        self.assertIn('"${_TARGET}" != "test"', validation)
        self.assertIn('"${COMMIT_SHA}" == "${_GIT_SHA}"', validation)
        self.assertIn('TEST_ONLY_CONTROL_PLANE_SHA=', validation)
        self.assertIn('TEST_ONLY_CANDIDATE_SHA=', validation)

    def test_test_only_never_builds_missing_candidate_artifacts(self):
        job = BUILD[BUILD.index("- id: build-job-if-missing"):BUILD.index("- id: build-service-if-missing")]
        service = BUILD[BUILD.index("- id: build-service-if-missing"):BUILD.index("- id: promote-dev")]
        self.assertIn('elif [[ "${_TARGET}" == "test" ]]', job)
        self.assertIn('requires pre-existing immutable Job artifact', job)
        self.assertIn('elif [[ "${_TARGET}" == "test" ]]', service)
        self.assertIn('requires pre-existing immutable Service artifact', service)

    def test_live_dev_attestation_is_read_only_and_exact_sha_gated(self):
        self.assertIn('live promotion evidence is only supported for DEV', LIVE)
        self.assertIn('source_sha") == sha', LIVE)
        self.assertIn('runtime_data_sha") == sha', LIVE)
        self.assertIn('contains_exact_image', LIVE)
        self.assertIn('gcloud run jobs describe', LIVE)
        self.assertIn('gcloud run services describe', LIVE)
        self.assertIn('verify_runtime_seed.sh', LIVE)
        self.assertIn('gcloud storage objects describe', VERIFY_SEED)
        for forbidden in (
            'gcloud run deploy',
            'gcloud run jobs deploy',
            'gcloud run services update',
            'gcloud storage cp',
            'gcloud storage buckets create',
            'add-iam-policy-binding',
        ):
            self.assertNotIn(forbidden, LIVE)
            self.assertNotIn(forbidden, VERIFY_SEED)

    def test_db_migration_is_fail_closed_before_application_deploy(self):
        migration_job = PROMOTE.index('status_step migration-job')
        application_job = PROMOTE.index('status_step application-job')
        service = PROMOTE.index('status_step service')
        self.assertLess(migration_job, application_job)
        self.assertLess(migration_job, service)
        self.assertIn('run_db_migration.sh" deploy', PROMOTE)
        self.assertIn('run_db_migration.sh" execute', PROMOTE)
        self.assertIn('status_pass schema-readiness', PROMOTE)
        self.assertIn('status_pass db-privileges', PROMOTE)

    def test_migration_job_uses_exact_candidate_service_digest_and_environment_secret(self):
        self.assertIn('MIGRATION_JOB_NAME="jscc-db-migrate-${env_name}"', ENV)
        self.assertIn('--image="${SERVICE_IMAGE_REPO}@${SERVICE_DIGEST}"', MIGRATE)
        self.assertIn('NILE_DATABASE_URL=NILE_DATABASE_URL:latest', MIGRATE)
        self.assertIn('NILE_MIGRATION_DATABASE_URL=NILE_DATABASE_URL:latest', MIGRATE)
        self.assertIn('JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE=true', MIGRATE)
        self.assertIn('gcloud run jobs execute "${MIGRATION_JOB_NAME}"', MIGRATE)
        self.assertIn('--wait', MIGRATE)

    def test_migration_execution_verifies_candidate_manifest_and_required_schema(self):
        self.assertIn('npm --prefix command-api run db:migrate', MIGRATE)
        self.assertIn('npm --prefix command-api run db:readiness', MIGRATE)
        self.assertIn('npm --prefix command-api run db:privilege-readiness', MIGRATE)
        self.assertIn("SELECT version, name, checksum FROM schema_migrations ORDER BY version", MIGRATE)
        self.assertIn("SELECT to_regclass($1) AS relation", MIGRATE)
        self.assertIn("system_bootstrap", MIGRATE)

    def test_promotion_checklist_is_machine_readable_and_fail_closed(self):
        self.assertIn('promotion-status.json', PROMOTION_STATUS)
        self.assertIn('"status": "IN_PROGRESS"', PROMOTION_STATUS)
        self.assertIn('Cannot mark promotion PASS with incomplete steps', PROMOTION_STATUS)
        self.assertIn('status_fail_trap', PROMOTE)
        self.assertIn('promotion_status.py" finish', PROMOTE)
        self.assertIn('PROMOTION_STATUS=gs://', PROMOTE)

    def test_promotion_status_is_protected_and_admin_only(self):
        self.assertIn("'promotion-status.json'", PROTECTED)
        self.assertIn("'/data/promotion-status.json'", SECURE)

    def test_deprecated_wrapper_has_no_deploy_implementation(self):
        self.assertIn("DEPRECATED", LEGACY)
        self.assertIn('promote.sh" dev', LEGACY)
        self.assertNotIn("gcloud run jobs deploy", LEGACY)

if __name__=="__main__":
    unittest.main()
