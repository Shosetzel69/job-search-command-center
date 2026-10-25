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
        def adapter(url, company):
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
