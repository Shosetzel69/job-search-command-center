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
    "source_url_kind": "careers_board_fallback",
    "source_url_label": "Careers board (not a direct job link)",
    "missing_fields": ["remote", "work_arrangement"],
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
        self.assertEqual(postings[0].payload["source_url_kind"], "careers_board_fallback")
        self.assertEqual(postings[0].payload["source_url_label"], "Careers board (not a direct job link)")
        self.assertIn("remote", postings[0].payload["missing_fields"])
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

    def test_unsupported_html_is_provider_failure_not_success_empty(self):
        import io
        row = item()
        class Page(io.BytesIO):
            def __init__(self, content, url):
                super().__init__(content)
                self.url = url
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
            def geturl(self): return self.url
        def mock_opener(req, timeout):
            return Page(b"<html><h1>Sign in</h1></html>", req.full_url)
        with patch.object(orchestration.zoho_recruit, "_safe_opener", side_effect=mock_opener):
            results, _, _ = orchestration.collect_api_sources({}, {"usage": {}}, NOW, [row])
        self.assertFalse(results[0].ok)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["outcome"], "failed")
        self.assertNotEqual(row["outcome"], "success_empty")
        self.assertEqual(row["records"], 0)

    def test_discordant_scoped_listing_isolated_and_marked_failed(self):
        import io, json
        from html import escape
        row = item()
        config = {"_jscc_retrieve_scope": {"scopes": [{"role_family": "PROJECT_MANAGEMENT"}]}}
        board = (b'<a href="/recruit/PortalDetail.na?jobid=123456'
                 b'&digest=tok_1&widgetid=123456">IT Project Manager</a>')
        modern = ('<input id="jobs" value="' + escape(json.dumps([]), quote=True) + '">').encode()
        class Page(io.BytesIO):
            def __init__(self, content, url):
                super().__init__(content)
                self.url = url
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
            def geturl(self): return self.url
        def mock_opener(req, timeout):
            return Page(board if req.full_url.endswith("/careers") else modern, req.full_url)
        with patch.object(orchestration.zoho_recruit, "_safe_opener", side_effect=mock_opener):
            results, _, _ = orchestration.collect_api_sources(config, {"usage": {}}, NOW, [row])
        self.assertFalse(results[0].ok)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["records"], 0)
        self.assertNotIn("digest=", str(results))

    def test_r3_failing_zoho_tenant_does_not_abort_healthy_tenant(self):
        import io
        bad = item()
        good = item()
        good.update(source="HR Plus", source_id="src-zoho-hr-plus",
                    url="https://hr-plus.zohorecruit.com/careers",
                    connector_config={"career_url": "https://hr-plus.zohorecruit.com/careers"})
        portal = (b'<a href="/recruit/PortalDetail.na?jobid=234567'
                  b'&digest=pub_1&widgetid=234567">Operations Manager</a>')
        detail = (b'<h1>Operations Manager</h1><h3>Job Description</h3>'
                  b'<p>Lead workforce projects.</p>')
        class Page(io.BytesIO):
            def __init__(self, data, url):
                super().__init__(data)
                self.url = url
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
            def geturl(self): return self.url
        def mock_opener(req, timeout):
            url = req.full_url
            if "osf-global.zohorecruit.com" in url:
                body = b"<html><h1>Sign in</h1></html>"
            elif url.endswith("/careers"):
                body = portal
            else:
                body = detail
            return Page(body, url)
        with patch.object(orchestration.zoho_recruit, "_safe_opener", side_effect=mock_opener):
            results, _, _ = orchestration.collect_api_sources(
                {}, {"usage": {}}, NOW, [bad, good])
        self.assertEqual(len(results), 2)
        self.assertFalse(results[0].ok)
        self.assertTrue(results[1].ok)
        self.assertEqual(bad["status"], "failed")
        self.assertEqual(good["status"], "completed")
        self.assertEqual(good["records"], 1)
        self.assertEqual(results[1].records[0]["_jscc_source_id"], "src-zoho-hr-plus")

    def test_r4_login_detail_never_reaches_corpus_projection(self):
        import io
        row = item()
        board = (b'<a href="/recruit/PortalDetail.na?jobid=123456'
                 b'&digest=tok_1&widgetid=123456">IT Project Manager</a>')
        gated = (b'<meta name="description" content="' +
                 b'Zoho Recruit sign in. Please sign in to view this job. ' * 3 +
                 b'"><h1>Sign in</h1><input type="password">')
        class Page(io.BytesIO):
            def __init__(self, body, url):
                super().__init__(body)
                self.url = url
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
            def geturl(self): return self.url
        def mock_opener(req, timeout):
            return Page(board if req.full_url.endswith("/careers") else gated, req.full_url)
        with patch.object(orchestration.zoho_recruit, "_safe_opener", side_effect=mock_opener):
            results, _, _ = orchestration.collect_api_sources({}, {"usage": {}}, NOW, [row])
        self.assertFalse(results[0].ok)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["records"], 0)
        projected, _, _, _ = corpus.project_collection(results)
        self.assertEqual(projected, [])

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
        self.assertEqual(upsert.call_args.args[1].payload["source_url_kind"], "careers_board_fallback")
        self.assertIn("remote", upsert.call_args.args[1].payload["missing_fields"])


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
        self.assertEqual(postings[0].payload["description_completeness"], "missing")
        self.assertEqual(postings[0].payload["description"], "")
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

    def test_option_a_only_osf_can_activate_even_with_broad_flag(self):
        from unittest.mock import patch
        tenants = [
            ("OSF Digital", "osf-global", "src-zoho-osf-digital"),
            ("HR Plus", "hr-plus", "src-zoho-hr-plus"),
            ("MADIFF", "madiffpl", "src-zoho-madiffpl"),
            ("Matritel", "matritel", "src-zoho-matritel"),
            ("MyEmployment", "myemployment", "src-zoho-myemployment"),
        ]
        cases = [
            ("dev", "0", "1"),  # legacy broad flag must not enable anything
            ("dev", "1", "0"),  # only OSF permitted
            ("dev", "1", "1"),  # broad flag cannot expand OSF-only scope
            ("test", "1", "1"),
            ("prod", "1", "1"),
            ("", "1", "1"),
        ]
        for name, tenant, source_id in tenants:
            src = {"name": name, "id": source_id,
                   "url": "https://" + tenant + ".zohorecruit.com/careers",
                   "active": False}
            for env, osf_opt, broad_opt in cases:
                expected = env == "dev" and name == "OSF Digital" and osf_opt == "1"
                with self.subTest(source=name, env=env, osf=osf_opt, broad=broad_opt), patch.dict(
                    "os.environ", {"APP_ENV": env,
                                   "JSCC_DEV_OSF_ENABLED": osf_opt,
                                   "JSCC_DEV_ZOHO_ENABLED": broad_opt},
                    clear=True,
                ):
                    plan = orchestration.build_plan({"sources": [src]})
                    self.assertEqual(plan[0]["active"], expected)
                    self.assertEqual(plan[0]["status"] == "pending", expected)

    def test_spoofed_osf_catalog_identity_cannot_activate(self):
        from unittest.mock import patch
        src = {"name": "OSF Digital", "id": "src-zoho-incorrect",
               "url": "https://osf-global.zohorecruit.com/careers",
               "active": False}
        with patch.dict("os.environ", {"APP_ENV": "dev",
                                       "JSCC_DEV_OSF_ENABLED": "1"}, clear=True):
            plan = orchestration.build_plan({"sources": [src]})
        self.assertEqual(plan[0]["status"], "inactive")
        self.assertFalse(plan[0]["active"])
