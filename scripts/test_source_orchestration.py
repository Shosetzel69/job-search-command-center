import copy
import json
import tempfile
import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

import job_search as engine
import job_search_jobicy as jobicy
import job_search_optimized as optimized
import job_search_runner as runner
import source_orchestration as orchestration
from job_identity import deduplicate

NOW = datetime(2026, 9, 6, 16, tzinfo=timezone.utc)
CONFIG = {"schema_version": "1.0", "source_strategy": "all active sources equally",
          "jobspipe_mode": "apify", "freshness_hours": 24,
          "role_groups": {"pm": {"enabled": True, "titles": ["IT Project Manager"]}}}
CATALOG = {"sources": [
    {"name": "JobsPipe", "url": "https://jobspipe.dev/", "active": True},
    {"name": "Jobicy", "url": "https://jobicy.com/", "active": True},
    {"name": "Unimplemented", "url": "ftp://example.com/jobs", "active": True},
    {"name": "Inactive", "url": "https://inactive.example/", "active": False},
]}


def record(provider="jobspipe", id="1"):
    return {"id": id, "title": "IT Project Manager", "company": "Example",
            "location": "Worldwide", "remote": True, "description": "IT delivery",
            "date_posted": NOW.isoformat(), "sources": [{"provider": provider}],
            "source_url": f"https://{provider}.example/jobs/{id}"}


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for module, name, filename in [(engine, "JOBS_PATH", "jobs.json"),
            (engine, "STATUS_PATH", "run-status.json"), (engine, "CONFIG_PATH", "search-config.json"),
            (optimized, "STATE_PATH", "state.json"), (runner, "HISTORY_PATH", "run-history.json"),
            (orchestration, "SOURCES_PATH", "sources.json")]:
            self.stack.enter_context(patch.object(module, name, root / filename))
        engine.CONFIG_PATH.write_text(json.dumps(CONFIG))
        orchestration.SOURCES_PATH.write_text(json.dumps(CATALOG))
        self.apify = self.stack.enter_context(patch.object(orchestration.apify, "collect", return_value=[engine.CollectionResult("jobspipe-apify", "target", True, [record()], 1)]))
        self.jobicy = self.stack.enter_context(patch.object(orchestration.jobicy, "collect", return_value=[engine.CollectionResult("jobicy", "latest_200", True, [record("Jobicy", "2")], 1)]))
        self.direct = self.stack.enter_context(patch.object(orchestration.optimized, "collect_incremental"))

    def run_search(self, config=None):
        code = orchestration.run(config or CONFIG, NOW)
        runner.append_run_history()
        return code, json.loads(engine.STATUS_PATH.read_text())

    def test_all_active_sources_run_and_history_reports_real_coverage(self):
        code, status = self.run_search()
        self.assertEqual(code, 0)
        self.apify.assert_called_once()
        self.jobicy.assert_called_once()
        self.assertEqual(status["sources_configured"], 4)
        self.assertEqual(status["sources_active"], 3)
        self.assertEqual(status["sources_processed"], 2)
        self.assertEqual(status["sources_attempted"], 2)
        self.assertEqual(status["sources_succeeded"], 2)
        self.assertEqual(status["sources_unsupported"], 1)
        self.assertEqual(status["sources_inactive"], 1)
        self.assertEqual(status["status"], "completed_with_errors")
        self.assertEqual(json.loads(engine.JOBS_PATH.read_text())["results"], 1)
        history = json.loads(runner.HISTORY_PATH.read_text())["runs"][0]
        self.assertEqual(history["sources_attempted"], 2)
        self.assertEqual(history["source_strategy"], CONFIG["source_strategy"])
        engine.validate_output()

    def test_failure_is_isolated(self):
        self.apify.side_effect = RuntimeError("provider unavailable")
        code, status = self.run_search()
        self.assertEqual(code, 0)
        self.assertEqual(status["sources_failed"], 1)
        self.assertEqual(status["failed_sources"], ["JobsPipe"])
        self.assertEqual(status["jobs_published"], 1)
        self.assertEqual(json.loads(engine.JOBS_PATH.read_text())["jobs"][0]["source"], "Jobicy")

    def test_partial_queries_count_provider_once_as_failed(self):
        self.apify.return_value.append(engine.CollectionResult("jobspipe-apify", "remote", False, [], 0, "timeout"))
        _, status = self.run_search()
        self.assertEqual(status["sources_attempted"], 2)
        self.assertEqual(status["sources_failed"], 1)
        self.assertEqual(status["records_inspected"], 2)

    def test_disabled_jobspipe_does_not_disable_other_sources(self):
        _, status = self.run_search({**CONFIG, "jobspipe_mode": "disabled"})
        self.apify.assert_not_called()
        self.direct.assert_not_called()
        self.jobicy.assert_called_once()
        self.assertEqual(status["sources"], ["Jobicy"])
        self.assertEqual(status["sources_skipped"], 1)

    def test_catalog_inactive_and_deleted_provider_do_not_call(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["sources"][0]["active"] = False
        catalog["sources"] = [source for source in catalog["sources"] if source["name"] != "Jobicy"]
        orchestration.SOURCES_PATH.write_text(json.dumps(catalog))
        _, status = self.run_search()
        self.apify.assert_not_called()
        self.jobicy.assert_not_called()
        self.assertEqual(status["sources_attempted"], 0)

    def test_direct_quota_guard_does_not_block_jobicy(self):
        state = optimized.load_state(NOW)
        state["usage"]["provider_quota_exhausted_month"] = "2026-09"
        optimized.save_state(state)
        _, status = self.run_search({**CONFIG, "jobspipe_mode": "direct"})
        self.direct.assert_not_called()
        self.jobicy.assert_called_once()
        self.assertEqual(status["sources_attempted"], 1)

    def test_direct_transport_preserves_incremental_metadata(self):
        self.direct.return_value = ([engine.CollectionResult("jobspipe", "target", True, [], 0)], 0, {"target": 0}, 14)
        _, status = self.run_search({**CONFIG, "jobspipe_mode": "direct"})
        self.direct.assert_called_once()
        self.apify.assert_not_called()
        self.assertEqual(status["jobspipe_optimization"]["run_budget"], 14)

    def test_all_failures_preserve_existing_jobs_byte_for_byte(self):
        engine.JOBS_PATH.write_text('{"jobs": [{"title": "existing"}]}')
        before = engine.JOBS_PATH.read_bytes()
        self.apify.side_effect = RuntimeError("outage")
        self.jobicy.side_effect = RuntimeError("outage")
        code, status = self.run_search()
        self.assertEqual(code, 2)
        self.assertEqual(status["jobs_published"], 1)
        self.assertEqual(engine.JOBS_PATH.read_bytes(), before)

    def test_hourly_jobicy_limit_is_not_counted_as_attempt(self):
        self.run_search()
        self.jobicy.reset_mock()
        _, status = self.run_search()
        self.jobicy.assert_not_called()
        self.assertEqual(status["sources_attempted"], 1)
        self.assertTrue(any("polling cooldown (1h)" in x for x in status["limitations"]))

    def test_provider_alias_is_not_counted_twice(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["sources"].append({"name": "Alias", "url": "https://www.jobicy.com/jobs"})
        plan = orchestration.build_plan(catalog)
        self.assertEqual(plan[-1]["status"], "skipped")

    def test_spoofed_hosts_and_connector_flags_are_not_trusted(self):
        for url in ("https://jobicy.com.evil.example/", "https://jobicy.com@evil.example/", "http://jobicy.com/", "https://jobicy.com:444/"):
            self.assertIsNone(orchestration.connector_for({"url": url, "connector_available": True}))
        self.assertEqual(orchestration.connector_for({"url": "https://jobicy.com/", "connector_available": False}), "jobicy")

    def test_provider_local_ids_do_not_drop_unrelated_jobs(self):
        other = record("Jobicy")
        other["company"] = "Different"
        result = engine.process_records(CONFIG, [engine.CollectionResult("jobspipe", "q", True, [record()], 1), engine.CollectionResult("jobicy", "q", True, [other], 1)], NOW)
        self.assertEqual(result["results"], 2)


class AdapterTests(unittest.TestCase):
    def fixture(self, geo="Anywhere"):
        return {"id": 1, "jobTitle": "IT Project Manager", "companyName": "Example",
                "url": "https://jobicy.com/jobs/1", "jobDescription": "<p>IT delivery &amp; planning</p>",
                "jobGeo": geo, "pubDate": NOW.isoformat(), "jobType": ["contract"]}

    def test_adapter_geography_and_plain_text(self):
        for geo, eligible in [("Anywhere", True), ("Europe", True), ("Romania", True), ("USA", False), ("Canada", False)]:
            item = jobicy.normalize(self.fixture(geo))
            self.assertEqual(engine.normalize_job_geography(item, True)[3], eligible)
            self.assertEqual(item["description"], "IT delivery & planning")
            self.assertEqual(item["source_url"], "https://jobicy.com/jobs/1")

    def test_empty_feed_is_success_and_bad_schema_is_failure(self):
        with patch.object(jobicy, "urlopen") as fetch:
            fetch.return_value.__enter__.return_value.read.return_value = b'{"jobs": []}'
            self.assertTrue(jobicy.collect(CONFIG)[0].ok)
            fetch.return_value.__enter__.return_value.read.return_value = b'{"error": "unavailable"}'
            with self.assertRaises(ValueError):
                jobicy.collect(CONFIG)

    def test_http_response_normalizes_to_pipeline(self):
        with patch.object(jobicy, "urlopen") as fetch:
            fetch.return_value.__enter__.return_value.read.return_value = json.dumps({"jobs": [self.fixture()]}).encode()
            output = engine.process_records(CONFIG, jobicy.collect(CONFIG), NOW)
            self.assertEqual(output["results"], 1)
            self.assertEqual(output["jobs"][0]["source"], "Jobicy")

    def test_tracking_urls_deduplicate_but_distinct_locations_remain(self):
        base = {"title": "PM", "company": "Example", "source": "a", "location": "RO", "url": "https://jobs.example/1?utm_source=a"}
        other = {**base, "source": "b", "url": "https://jobs.example/1?utm_source=b"}
        separate = {**base, "source": "b", "location": "BE", "url": "https://jobs.example/2"}
        self.assertEqual(len(deduplicate([base, other, separate])), 2)


if __name__ == "__main__":
    unittest.main()
