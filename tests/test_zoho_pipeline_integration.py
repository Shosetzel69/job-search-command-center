"""Zoho -> actual JSCC orchestration and shared corpus projection regression."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import job_search as engine
import source_orchestration as orchestration
import shared_corpus_repository as corpus

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
RECORD = {
    "id": "zoho_recruit:osf-global.zohorecruit.com:67512000083826044",
    "job_title": "Data Engineer",
    "company": "OSF Digital",
    "description": "Migrate Salesforce data, validate ETL and reconcile data mappings.",
    "description_completeness": "full",
    "description_provenance": "public_embedded_jobDescriptionDetails",
    "location": "India", "countries": ["India"],
    "date_posted": "2026-10-14",
    "source_url": "https://osf-global.zohorecruit.com/careers",
    "sources": [{"provider": "Zoho Recruit", "tenant": "osf-global.zohorecruit.com"}],
}

def item():
    return {
        "connector": "zoho_recruit",
        "source": "OSF Digital",
        "source_id": "src-zoho-osf-digital",
        "url": "https://osf-global.zohorecruit.com/careers",
        "status": "pending",
        "connector_config": {"career_url": "https://osf-global.zohorecruit.com/careers"},
    }

class ZohoIntegrationTests(unittest.TestCase):
    def test_nonempty_orchestration_projection_and_idempotent_identity(self):
        row = item()
        def adapter(url, company, role_family=None):
            self.assertEqual(company, "OSF Digital")
            return [engine.CollectionResult("zoho_recruit:osf-global.zohorecruit.com", "public_postings", True, [dict(RECORD)], 1)]
        with patch.object(orchestration.zoho_recruit, "collect_result", side_effect=adapter):
            results, _, _ = orchestration.collect_api_sources({}, {"usage": {}}, NOW, [row])
        self.assertEqual(row["outcome"], "success")
        self.assertEqual(row["records"], 1)
        self.assertEqual(results[0].records[0]["_jscc_source_id"], "src-zoho-osf-digital")
        postings, skipped, _, _ = corpus.project_collection(results)
        self.assertEqual(len(postings), 1)
        self.assertEqual(skipped, 0)
        self.assertNotIn("digest=", str(postings))
        again, _, _, _ = corpus.project_collection(results)
        self.assertEqual(postings[0].identity_value, again[0].identity_value)

    def test_empty_source_not_failed(self):
        row = item()
        with patch.object(orchestration.zoho_recruit, "collect_result", return_value=[
                engine.CollectionResult("zoho_recruit:osf-global.zohorecruit.com", "public_postings", True, [], 0)]):
            results, _, _ = orchestration.collect_api_sources({}, {"usage": {}}, NOW, [row])
        self.assertEqual(results[0].records, [])
        self.assertEqual(row["outcome"], "success_empty")

    def test_provider_error_is_isolated(self):
        row = item()
        with patch.object(orchestration.zoho_recruit, "collect_result", side_effect=TimeoutError("provider timeout")):
            results, _, _ = orchestration.collect_api_sources({}, {"usage": {}}, NOW, [row])
        self.assertFalse(results[0].ok)
        self.assertEqual(row["outcome"], "failed")
        self.assertEqual(row["error_code"], "TIMEOUT")

    def test_scope_removes_nonmatching_family(self):
        row = item()
        cfg = {"_jscc_retrieve_scope": {"scopes": [{"role_family": "PROJECT_MANAGEMENT"}]}}
        with patch.object(orchestration.zoho_recruit, "collect_result", return_value=[
                engine.CollectionResult("zoho_recruit:osf-global.zohorecruit.com", "public_postings", True, [dict(RECORD)], 1)]):
            results, _, _ = orchestration.collect_api_sources(cfg, {"usage": {}}, NOW, [row])
        self.assertEqual(row["records"], 0)
        self.assertEqual(results[0].total_available, 1)

    def test_mocked_postgresql_persistence_and_replay(self):
        """Exercise actual persist_collection transaction flow without touching DEV DB."""
        from unittest.mock import MagicMock
        row = item()
        result = engine.CollectionResult(
            "zoho_recruit:osf-global.zohorecruit.com", "public_postings",
            True, [dict(RECORD)], 1)
        orchestration.tag_collection_records(row, [result])
        orchestration.record_results(row, [result])
        connection = MagicMock()
        cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ("jobsearch_dev",)
        cursor.rowcount = 0
        connector = MagicMock(return_value=connection)
        env = {"APP_ENV": "dev", "NILE_DATABASE_URL": "postgresql://localhost/jobsearch_dev"}
        with patch.object(corpus, "_upsert_posting", return_value=("synthetic-id", True)) as upsert:
            first = corpus.persist_collection([result], [row], run_id="osf-mock-01",
                now=NOW, env=env, connect=connector, advance_lifecycle=False)
            second = corpus.persist_collection([result], [row], run_id="osf-mock-02",
                now=NOW, env=env, connect=connector, advance_lifecycle=False)
        self.assertEqual(first["status"], "persisted")
        self.assertEqual(first["records_projected"], 1)
        self.assertEqual(second["records_projected"], 1)
        self.assertEqual(upsert.call_count, 2)
        self.assertEqual(upsert.call_args_list[0].args[1].identity_value,
                         upsert.call_args_list[1].args[1].identity_value)
        self.assertTrue(first["lifecycle_suppressed_targeted"])


    def test_missing_description_preserved_in_projection_and_mocked_persistence(self):
        from unittest.mock import MagicMock
        row = item()
        missing = dict(RECORD, id="zoho_recruit:osf-global.zohorecruit.com:999999999",
                       job_title="IT Project Manager", description="",
                       description_completeness="missing",
                       description_provenance="public_listing_metadata_only")
        result = engine.CollectionResult(
            "zoho_recruit:osf-global.zohorecruit.com", "public_postings",
            True, [missing], 1)
        orchestration.tag_collection_records(row, [result])
        orchestration.record_results(row, [result])
        postings, skipped, _, _ = corpus.project_collection([result])
        self.assertEqual(skipped, 0)
        self.assertEqual(len(postings), 1)
        connection = MagicMock()
        cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ("jobsearch_dev",)
        connector = MagicMock(return_value=connection)
        env = {"APP_ENV":"dev", "NILE_DATABASE_URL":"postgresql://localhost/jobsearch_dev"}
        with patch.object(corpus, "_upsert_posting", return_value=("missing-synthetic", True)) as upsert:
            output = corpus.persist_collection([result], [row], run_id="zoho-missing-mock",
                now=NOW, env=env, connect=connector, advance_lifecycle=False)
        self.assertEqual(output["records_projected"], 1)
        self.assertEqual(output["status"], "persisted")
        self.assertEqual(upsert.call_count, 1)

    def test_activation_confined_to_dev_opt_in(self):
        from unittest.mock import patch
        src = {"name":"OSF Digital","id":"src-zoho-osf-digital",
               "url":"https://osf-global.zohorecruit.com/careers",
               "active":False}
        for app_env, opt_in, expected in [
            ("dev","1",True),("dev","0",False),
            ("test","1",False),("prod","1",False),("", "1", False)]:
            with self.subTest(app_env=app_env, opt_in=opt_in):
                with patch.dict("os.environ", {"APP_ENV":app_env,
                                               "JSCC_DEV_OSF_ENABLED":opt_in}):
                    items = orchestration.build_plan({"sources":[src]})
                osf = items[0]
                self.assertEqual(osf["active"], expected)
                self.assertEqual(osf["status"] == "pending", expected)

    def test_all_five_zoho_sources_dev_only(self):
        from unittest.mock import patch
        for name, tenant in [
            ("OSF Digital", "osf-global"), ("HR Plus", "hr-plus"),
            ("MADIFF", "madiffpl"), ("Matritel", "matritel"),
            ("MyEmployment", "myemployment")]:
            src = {"name": name, "id": "src-zoho-" + tenant,
                   "url": "https://" + tenant + ".zohorecruit.com/careers",
                   "active": False}
            for env, expected in [("dev", True), ("test", False), ("prod", False)]:
                with self.subTest(source=name, env=env), patch.dict(
                    "os.environ", {"APP_ENV": env, "JSCC_DEV_ZOHO_ENABLED": "1"}
                ):
                    plan = orchestration.build_plan({"sources": [src]})
                    self.assertEqual(plan[0]["status"] == "pending", expected)
