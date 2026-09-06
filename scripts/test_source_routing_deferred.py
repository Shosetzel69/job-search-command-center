import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import job_search as engine
import source_orchestration as orchestration

NOW = datetime(2026, 9, 6, 16, tzinfo=timezone.utc)


class DeferredProviderRoutingTests(unittest.TestCase):
    def test_documented_provider_roots_are_not_sent_to_generic_crawler(self):
        catalog = {"sources": [
            {"name": "LinkedIn Jobs", "url": "https://www.linkedin.com/jobs/"},
            {"name": "Indeed", "url": "https://www.indeed.com/"},
            {"name": "Workday", "url": "https://www.workday.com/"},
            {"name": "Greenhouse", "url": "https://www.greenhouse.com/"},
            {"name": "Workable", "url": "https://jobs.workable.com/"},
            {"name": "SmartRecruiters", "url": "https://www.smartrecruiters.com/"},
            {"name": "Ashby", "url": "https://jobs.ashbyhq.com/"},
            {"name": "Lever", "url": "https://www.lever.co/"},
        ]}
        plan = orchestration.build_plan(catalog)
        self.assertTrue(all(item["status"] == "skipped" for item in plan))
        self.assertTrue(all(item["connector"] == "deferred" for item in plan))
        self.assertEqual({item["deferred_provider"] for item in plan},
                         {"LinkedIn", "Indeed", "Workday", "Greenhouse", "Workable", "SmartRecruiters", "Ashby", "Lever"})
        with patch.object(orchestration.web, "collect") as crawler:
            results, _, mode = orchestration.collect_sources({"jobspipe_mode": "disabled"}, {}, NOW, plan)
        crawler.assert_not_called()
        self.assertEqual(results, [])
        self.assertEqual(mode, "disabled")

    def test_concrete_ashby_employer_board_can_still_use_web_collector(self):
        plan = orchestration.build_plan({"sources": [{"name": "Example", "url": "https://jobs.ashbyhq.com/example"}]})
        self.assertEqual(plan[0]["connector"], "web")
        self.assertEqual(plan[0]["status"], "pending")

    def test_jobspipe_remains_disabled_without_affecting_web_source(self):
        catalog = {"sources": [
            {"name": "JobsPipe", "url": "https://jobspipe.dev/"},
            {"name": "Example", "url": "https://example.com/careers"},
        ]}
        plan = orchestration.build_plan(catalog)

        def collect(source, config, now):
            return [engine.CollectionResult("web:example", "q", True, [], 0)], {"web_outcome": "no_active_jobs"}

        with patch.object(orchestration.web, "collect", side_effect=collect) as crawler, \
             patch.object(orchestration.apify, "collect") as apify, \
             patch.object(orchestration.optimized, "collect_incremental") as direct:
            results, _, mode = orchestration.collect_sources({"jobspipe_mode": "disabled"}, {}, NOW, plan)
        self.assertEqual(mode, "disabled")
        crawler.assert_called_once()
        apify.assert_not_called()
        direct.assert_not_called()
        self.assertEqual(plan[0]["status"], "skipped")
        self.assertEqual(plan[1]["status"], "completed")
        self.assertEqual(len(results), 1)


if __name__ == "__main__":
    unittest.main()
