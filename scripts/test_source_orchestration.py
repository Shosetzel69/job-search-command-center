import copy
import json
import tempfile
import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
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
          "target_regions": [], "target_country_codes": ["RO"],
          "excluded_regions": [], "excluded_country_codes": [],
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
    def test_remote_in_europe_is_provider_alias(self):
        catalog = {"sources": [
            {"id": "wwr", "name": "We Work Remotely", "url": "https://weworkremotely.com/", "active": True},
            {"id": "rie", "name": "Remote in Europe", "url": "https://remoteineurope.com/", "active": True},
        ]}
        plan = orchestration.build_plan(catalog)
        alias = next(item for item in plan if item["source_id"] == "rie")
        self.assertEqual(alias["outcome"], "provider_alias")

    def test_access_control_sources_are_policy_excluded(self):
        for name in ("Arc.dev", "Welcome to the Jungle", "CGI"):
            self.assertTrue(orchestration.policy_excluded({"name": name}))

    def test_generic_ats_roots_are_deferred_providers(self):
        catalog = {"sources": [
            {"id": "r", "name": "Recruitee", "url": "https://recruitee.com/", "active": True},
            {"id": "b", "name": "BambooHR", "url": "https://www.bamboohr.com/", "active": True},
            {"id": "e", "name": "Eightfold", "url": "https://eightfold.ai/", "active": True},
        ]}
        plan = orchestration.build_plan(catalog)
        self.assertEqual([item["outcome"] for item in plan], ["deferred_provider", "deferred_provider", "deferred_provider"])

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
        runner.stamp_jobs_provenance()
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
        results = {item["source"]: item for item in status["source_results"]}
        self.assertEqual(results["JobsPipe"]["outcome"], "success")
        self.assertEqual(results["Jobicy"]["outcome"], "success")
        self.assertEqual(results["Unimplemented"]["outcome"], "failed")
        self.assertEqual(results["Unimplemented"]["error_code"], "CONFIG_ERROR")
        self.assertEqual(results["Unimplemented"]["failure_stage"], "preflight")
        self.assertEqual(results["Inactive"]["outcome"], "disabled_config")
        self.assertTrue(all(len(item["source_execution_id"]) == 24 for item in status["source_results"]))
        self.assertEqual(status["source_outcome_schema_version"], "1.0")
        self.assertEqual(status["status"], "completed_with_errors")
        self.assertEqual(json.loads(engine.JOBS_PATH.read_text())["results"], 1)
        history = json.loads(runner.HISTORY_PATH.read_text())["runs"][0]
        self.assertEqual(history["sources_attempted"], 2)
        self.assertEqual(history["source_strategy"], CONFIG["source_strategy"])
        jobs = json.loads(engine.JOBS_PATH.read_text())
        self.assertEqual(jobs["run_id"], status["run_id"])
        self.assertEqual(jobs["run_status"], status["status"])
        runner.validate_history()
        engine.validate_output()

    def test_shared_corpus_receives_tagged_records_and_status(self):
        evidence = {
            "status": "persisted",
            "records_projected": 2,
            "records_skipped": 0,
            "postings_created": 2,
            "postings_updated": 0,
            "lifecycle_advanced": 0,
            "complete_sources": 2,
        }
        with patch.object(orchestration.shared_corpus, "persist_collection", return_value=evidence) as persist:
            _, status = self.run_search()

        collection, plan = persist.call_args.args[:2]
        tagged = [
            record
            for result in collection
            if result.ok
            for record in result.records
        ]
        self.assertTrue(tagged)
        self.assertTrue(all(record.get("_jscc_source_id") for record in tagged))
        self.assertTrue(all(record.get("_jscc_source_name") for record in tagged))
        self.assertEqual(status["shared_corpus"], evidence)
        self.assertTrue(any(item.get("outcome") == "success" for item in plan))

    def test_failure_is_isolated(self):
        self.apify.side_effect = RuntimeError("provider unavailable")
        code, status = self.run_search()
        self.assertEqual(code, 0)
        self.assertEqual(status["sources_failed"], 1)
        self.assertEqual(status["failed_sources"], ["JobsPipe"])
        jobs_pipe = next(item for item in status["source_results"] if item["source"] == "JobsPipe")
        self.assertEqual(jobs_pipe["outcome"], "failed")
        self.assertEqual(jobs_pipe["error_code"], "CONNECTOR_ERROR")
        self.assertEqual(jobs_pipe["failure_stage"], "fetch")
        self.assertEqual(status["jobs_published"], 1)
        self.assertEqual(json.loads(engine.JOBS_PATH.read_text())["jobs"][0]["source"], "Jobicy")

    def test_partial_queries_preserve_usable_records_without_hard_failure(self):
        self.apify.return_value.append(engine.CollectionResult("jobspipe-apify", "remote", False, [], 0, "timeout"))
        _, status = self.run_search()
        self.assertEqual(status["sources_attempted"], 2)
        self.assertEqual(status["sources_failed"], 0)
        self.assertEqual(status["sources_partial"], 1)
        jobs_pipe = next(item for item in status["source_results"] if item["source"] == "JobsPipe")
        self.assertEqual(jobs_pipe["outcome"], "partial")
        self.assertEqual(jobs_pipe["records"], 1)
        self.assertEqual(status["records_inspected"], 2)

    def test_disabled_jobspipe_does_not_disable_other_sources(self):
        _, status = self.run_search({**CONFIG, "jobspipe_mode": "disabled"})
        self.apify.assert_not_called()
        self.direct.assert_not_called()
        self.jobicy.assert_called_once()
        self.assertEqual(status["sources"], ["Jobicy"])
        self.assertEqual(status["sources_skipped"], 1)
        jobs_pipe = next(item for item in status["source_results"] if item["source"] == "JobsPipe")
        self.assertEqual(jobs_pipe["outcome"], "disabled_config")

    def test_catalog_inactive_and_deleted_provider_do_not_call(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["sources"][0]["active"] = False
        catalog["sources"] = [source for source in catalog["sources"] if source["name"] != "Jobicy"]
        orchestration.SOURCES_PATH.write_text(json.dumps(catalog))
        _, status = self.run_search()
        self.apify.assert_not_called()
        self.jobicy.assert_not_called()
        self.assertEqual(status["sources_attempted"], 0)

    def test_policy_excluded_monster_is_never_attempted_even_if_catalog_active(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["sources"].append({"name": "Monster", "url": "https://www.monster.com/jobs/", "active": True})
        plan = orchestration.build_plan(catalog)
        monster = next(item for item in plan if item["source"] == "Monster")
        self.assertFalse(monster["active"])
        self.assertEqual(monster["status"], "inactive")
        self.assertEqual(monster["outcome"], "excluded_policy")
        self.assertTrue(monster["policy_excluded"])
        self.assertIn("project source policy", monster["error"])

    def test_non_enumerable_matching_platforms_are_policy_excluded(self):
        catalog = {"sources": [
            {"name": "Head Hunting IT", "url": "https://www.headhuntingit.com/", "active": True},
            {"name": "Malt", "url": "https://www.malt.com/", "active": True},
        ]}
        plan = orchestration.build_plan(catalog)
        self.assertEqual([item["outcome"] for item in plan], ["excluded_policy", "excluded_policy"])
        self.assertTrue(all(item["status"] == "inactive" for item in plan))
        self.assertTrue(all(item["policy_excluded"] for item in plan))

    def test_direct_quota_guard_does_not_block_jobicy(self):
        state = optimized.load_state(NOW)
        state["usage"]["provider_quota_exhausted_month"] = "2026-09"
        optimized.save_state(state)
        _, status = self.run_search({**CONFIG, "jobspipe_mode": "direct"})
        self.direct.assert_not_called()
        self.jobicy.assert_called_once()
        self.assertEqual(status["sources_attempted"], 1)
        jobs_pipe = next(item for item in status["source_results"] if item["source"] == "JobsPipe")
        self.assertEqual(jobs_pipe["outcome"], "skipped")

    def test_empty_collection_result_is_structured_failure(self):
        item = {"source": "Example", "source_id": "x", "status": "pending", "records": 0,
                "error": None, "failure_reason": None, "http_status": None}
        orchestration.record_results(item, [])
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["outcome"], "failed")
        self.assertEqual(item["error_code"], "CONNECTOR_ERROR")
        self.assertEqual(item["failure_stage"], "fetch")

    def test_success_empty_is_distinct_from_failure(self):
        self.apify.return_value = [engine.CollectionResult("jobspipe-apify", "target", True, [], 0)]
        self.jobicy.return_value = [engine.CollectionResult("jobicy", "latest_200", True, [], 0)]
        _, status = self.run_search()
        outcomes = {item["source"]: item["outcome"] for item in status["source_results"]}
        self.assertEqual(outcomes["JobsPipe"], "success_empty")
        self.assertEqual(outcomes["Jobicy"], "success_empty")

    def test_generic_web_no_extractable_is_diagnostic_not_hard_error(self):
        item = {"source":"Example","source_id":"x","status":"pending","records":0,
                "error":None,"failure_reason":"HTML accessible but no extractor",
                "http_status":200,"web_outcome":"no_extractable_jobs"}
        result = engine.CollectionResult("web:x","no_extractable_jobs",False,[],0,
                                         "HTML accessible but no extractor",
                                         error_code="CONNECTOR_ERROR",failure_stage="fetch",http_status=200)
        orchestration.record_results(item,[result])
        self.assertEqual(item["status"],"completed")
        self.assertEqual(item["outcome"],"no_extractable_jobs")
        self.assertEqual(item["records"],0)
        self.assertIsNone(item["error_code"])

    def test_blocked_web_retrieve_is_distinct_from_failed_and_zero_jobs(self):
        item = {"source":"Example","source_id":"x","status":"pending","records":0,
                "error":None,"failure_reason":"Disallowed by robots.txt",
                "http_status":403,"web_outcome":"blocked"}
        result = engine.CollectionResult("web:x","blocked",False,[],0,
                                         "Disallowed by robots.txt",
                                         error_code="ACCESS_" + "DENIED",failure_stage="fetch",http_status=403)
        orchestration.record_results(item,[result])
        self.assertEqual(item["status"],"completed")
        self.assertEqual(item["outcome"],"blocked")
        self.assertEqual(item["records"],0)
        self.assertEqual(item["http_status"],403)

    def test_public_board_sources_get_unique_dedicated_routes(self):
        catalog = {"sources":[
            {"id":"a","name":"Remote OK","url":"https://remoteok.com/","active":True},
            {"id":"b","name":"Himalayas","url":"https://himalayas.app/jobs","active":True},
        ]}
        plan = orchestration.build_plan(catalog)
        self.assertEqual([item["connector"] for item in plan],["public_board","public_board"])
        self.assertTrue(all(item["status"]=="pending" for item in plan))

    def test_http_429_is_structured_without_parsing_message(self):
        self.apify.side_effect = HTTPError("https://example.invalid", 429, "quota", {}, None)
        _, status = self.run_search()
        jobs_pipe = next(item for item in status["source_results"] if item["source"] == "JobsPipe")
        self.assertEqual(jobs_pipe["outcome"], "failed")
        self.assertEqual(jobs_pipe["error_code"], "RATE_LIMITED")
        self.assertEqual(jobs_pipe["failure_stage"], "fetch")
        self.assertEqual(jobs_pipe["http_status"], 429)

    def test_explicit_failure_metadata_wins_over_human_message(self):
        item = {"source": "Example", "source_id": "x", "status": "pending", "records": 0,
                "error": None, "failure_reason": None, "http_status": None}
        result = engine.CollectionResult("example", "q", False, [], 0, "HTTP 429 text only",
                                         error_code="TIMEOUT", failure_stage="fetch")
        orchestration.record_results(item, [result])
        self.assertEqual(item["error_code"], "TIMEOUT")
        self.assertEqual(item["outcome"], "failed")

    def test_source_aggregates_separate_outcomes_and_failure_dimensions(self):
        plan = [
            {"outcome": "success"},
            {"outcome": "success_empty"},
            {"outcome": "failed", "error_code": "TIMEOUT", "failure_stage": "fetch"},
            {"outcome": "failed", "error_code": "TIMEOUT", "failure_stage": "fetch"},
            {"outcome": "failed", "error_code": "SCHEMA_ERROR", "failure_stage": "parse"},
            {"outcome": "disabled_config"},
            {"outcome": "deferred_provider"},
        ]
        aggregate = orchestration.aggregate_source_results(plan)
        self.assertEqual(aggregate["source_outcome_counts"]["success"], 1)
        self.assertEqual(aggregate["source_outcome_counts"]["success_empty"], 1)
        self.assertEqual(aggregate["source_outcome_counts"]["failed"], 3)
        self.assertEqual(aggregate["source_outcome_counts"]["disabled_config"], 1)
        self.assertEqual(aggregate["source_outcome_counts"]["deferred_provider"], 1)
        self.assertEqual(aggregate["source_failure_codes"], {"SCHEMA_ERROR": 1, "TIMEOUT": 2})
        self.assertEqual(aggregate["source_failure_stages"], {"fetch": 2, "parse": 1})

    def test_run_history_persists_structured_source_aggregates(self):
        _, status = self.run_search()
        history = json.loads(runner.HISTORY_PATH.read_text())["runs"][0]
        self.assertEqual(history["source_outcome_counts"], status["source_outcome_counts"])
        self.assertEqual(history["source_failure_codes"], status["source_failure_codes"])
        self.assertEqual(history["source_failure_stages"], status["source_failure_stages"])
        self.assertEqual(history["excluded_by_reason"], status["excluded_by_reason"])
        self.assertEqual(history["excluded_by_category"], status["excluded_by_category"])
        self.assertEqual(history["role_filter_audit"], status["role_filter_audit"])

    def test_structured_lifecycle_events_are_correlated(self):
        events = []

        def capture(event_name, level="INFO", **fields):
            events.append((event_name, level, fields))
            return {"event_name": event_name, "level": level, **fields}

        with patch.object(orchestration.diagnostics, "emit_event", side_effect=capture):
            _, status = self.run_search()

        names = [event[0] for event in events]
        self.assertIn("search.run.started", names)
        self.assertIn("search.run.completed", names)
        self.assertIn("source.collection.started", names)
        self.assertIn("source.collection.completed", names)
        self.assertIn("source.collection.failed", names)
        self.assertIn("source.collection.skipped", names)

        run_ids = {
            fields.get("run_id")
            for _, _, fields in events
            if fields.get("run_id")
        }
        self.assertEqual(run_ids, {status["run_id"]})

        source_events = [
            fields for name, _, fields in events
            if name.startswith("source.collection.")
        ]
        self.assertTrue(all(fields.get("source_execution_id") for fields in source_events))
        failed = [
            (level, fields) for name, level, fields in events
            if name == "source.collection.failed"
        ]
        self.assertTrue(failed)
        self.assertTrue(all(level == "WARN" for level, _ in failed))

    def test_persisted_failure_message_is_sanitized(self):
        secret = "abcdefghijklmnopqrstuvwxyz123456"
        self.apify.side_effect = RuntimeError(
            f"Authorization: Bearer {secret} https://provider.test/?api_key=supersecret"
        )
        _, status = self.run_search()
        jobs_pipe = next(item for item in status["source_results"] if item["source"] == "JobsPipe")
        self.assertNotIn(secret, jobs_pipe["error"])
        self.assertNotIn("supersecret", jobs_pipe["error"])
        history = json.loads(runner.HISTORY_PATH.read_text())["runs"][0]
        historical = next(item for item in history["source_results"] if item["source"] == "JobsPipe")
        self.assertNotIn(secret, historical["error"])
        self.assertNotIn("supersecret", historical["error"])

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
        history = json.loads(runner.HISTORY_PATH.read_text())["runs"][0]
        self.assertEqual(history["run_id"], status["run_id"])

    def test_hourly_jobicy_limit_is_not_counted_as_attempt(self):
        self.run_search()
        self.jobicy.reset_mock()
        _, status = self.run_search()
        self.jobicy.assert_not_called()
        self.assertEqual(status["sources_attempted"], 1)
        self.assertTrue(any("hourly" in x for x in status["limitations"]))

    def test_provider_alias_is_not_counted_twice(self):
        catalog = copy.deepcopy(CATALOG)
        catalog["sources"].append({"name": "Alias", "url": "https://www.jobicy.com/jobs"})
        plan = orchestration.build_plan(catalog)
        self.assertEqual(plan[-1]["status"], "skipped")

    def test_remotehunt_is_canonical_provider_alias(self):
        catalog = {"sources": [
            {"name": "We Work Remotely", "url": "https://weworkremotely.com/remote-jobs.rss", "active": True},
            {"name": "RemoteHunt", "url": "https://remotehunt.com/", "active": True},
        ]}
        plan = orchestration.build_plan(catalog)
        remotehunt = next(item for item in plan if item["source"] == "RemoteHunt")
        self.assertEqual(remotehunt["status"], "skipped")
        self.assertEqual(remotehunt["outcome"], "provider_alias")
        self.assertEqual(remotehunt["provider_alias"], "We Work Remotely")

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
