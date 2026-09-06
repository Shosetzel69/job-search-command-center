import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import job_search as engine
import job_search_public_api as public_api
import source_orchestration as orchestration

NOW = datetime(2026, 9, 6, 19, tzinfo=timezone.utc)
CONFIG = {
    "freshness_hours": 24,
    "collection_freshness_hours": 120,
    "role_groups": {
        "pm": {"enabled": True, "titles": ["Project Manager", "IT Project Manager"]},
        "delivery": {"enabled": True, "titles": ["Delivery Manager"]},
    },
}


class NormalizationTests(unittest.TestCase):
    def source(self, name, url="https://example.com/jobs"):
        return {"name": name, "url": url}

    def test_jobgether_normalizes_hybrid_and_publication_date(self):
        item = {
            "id": "j1", "title": "IT Project Manager", "company": "Acme",
            "url": "https://jobgether.com/offer/j1", "location": "Romania, Belgium",
            "remote": "Hybrid", "contractType": "Full time",
            "jobFunctions": ["Project Manager"], "postedAt": "2026-09-06T10:00:00.000Z",
        }
        record = public_api._normalize_jobgether(item, self.source("Jobgether"))
        self.assertTrue(record["hybrid"])
        self.assertFalse(record["remote"])
        self.assertEqual(record["country_codes"], ["RO", "BE"])
        self.assertEqual(record["date_posted"], item["postedAt"])

    def test_himalayas_accepts_epoch_ms_and_country_restrictions(self):
        item = {
            "guid": "h1", "title": "Project Manager", "companyName": "Acme",
            "description": "Delivery", "employmentType": "Contractor",
            "locationRestrictions": [{"alpha2": "RO", "name": "Romania"}],
            "pubDate": 1788703200000, "applicationLink": "https://himalayas.app/jobs/h1",
        }
        record = public_api._normalize_himalayas(item, self.source("Himalayas"))
        self.assertTrue(record["remote"])
        self.assertEqual(record["country_codes"], ["RO"])
        self.assertIsNotNone(engine.parse_posted_datetime(record["date_posted"]))

    def test_working_nomads_strips_html(self):
        item = {
            "url": "https://workingnomads.com/jobs/1", "title": "Delivery Manager",
            "company_name": "Acme", "description": "<p>Plan &amp; deliver</p>",
            "location": "Europe", "pub_date": "2026-09-06T09:00:00Z",
        }
        record = public_api._normalize_workingnomads(item, self.source("Working Nomads"))
        self.assertEqual(record["description"], "Plan & deliver")
        self.assertTrue(record["remote"])

    def test_remoteok_ignores_metadata_record(self):
        payload = [
            {"legal": "meta"},
            {"id": "r1", "position": "Project Manager", "company": "Acme",
             "description": "Delivery", "location": "Worldwide",
             "date": "2026-09-06T08:00:00Z", "url": "https://remoteok.com/jobs/r1"},
        ]
        with patch.object(public_api, "fetch_json", return_value=payload):
            results = public_api.collect("remoteok", self.source("Remote OK"), CONFIG, NOW)
        self.assertEqual(len(results[0].records), 1)
        self.assertEqual(results[0].records[0]["job_title"], "Project Manager")

    def test_ashby_uses_structured_workplace_type(self):
        item = {
            "title": "Technical Project Manager", "location": "Remote; EMEA",
            "isListed": True, "isRemote": True, "workplaceType": "Remote",
            "descriptionPlain": "Delivery", "publishedAt": "2026-09-06T12:00:00Z",
            "employmentType": "Contract", "jobUrl": "https://jobs.ashbyhq.com/acme/j1",
        }
        record = public_api._normalize_ashby(item, self.source("Acme", "https://jobs.ashbyhq.com/acme"))
        self.assertTrue(record["remote"])
        self.assertEqual(record["work_arrangement"], "remote")
        self.assertEqual(record["employment_statuses"], ["Contract"])

    def test_required_date_prevents_freshness_bypass(self):
        item = {"id": "j1", "title": "Project Manager", "company": "Acme",
                "url": "https://jobgether.com/offer/j1", "remote": "Full Remote"}
        with self.assertRaises(ValueError):
            public_api._normalize_jobgether(item, self.source("Jobgether"))


class CollectionTests(unittest.TestCase):
    def test_smartrecruiters_filters_by_released_after_and_fetches_detail(self):
        source = {"name": "Endava", "url": "https://careers.smartrecruiters.com/Endava"}
        listing = {
            "offset": 0, "limit": 100, "totalFound": 1,
            "content": [{
                "id": "s1", "name": "Project Manager", "releasedDate": "2026-09-06T10:00:00Z",
                "company": {"name": "Endava"},
                "location": {"city": "Bucharest", "country": "ro", "remote": False, "hybrid": True},
            }],
        }
        detail = {
            "id": "s1", "name": "Project Manager", "releasedDate": "2026-09-06T10:00:00Z",
            "company": {"name": "Endava"},
            "location": {"city": "Bucharest", "country": "ro", "remote": False, "hybrid": True},
            "postingUrl": "https://jobs.smartrecruiters.com/Endava/s1",
            "jobAd": {"sections": {"jobDescription": {"text": "Delivery"}}},
        }
        with patch.object(public_api, "fetch_json", side_effect=[listing, detail]) as fetch:
            records = public_api._collect_smartrecruiters(source, CONFIG, NOW)
        self.assertEqual(len(records), 1)
        self.assertTrue(records[0]["hybrid"])
        self.assertIn("releasedAfter=", fetch.call_args_list[0].args[0])
        self.assertIn("destination=PUBLIC", fetch.call_args_list[0].args[0])

    def test_greenhouse_fetches_detail_only_for_recent_updates_and_uses_first_published(self):
        source = {"name": "Xebia CEE", "url": "https://job-boards.greenhouse.io/xebiacee"}
        listing = {"jobs": [
            {"id": 1, "updated_at": "2026-08-01T00:00:00Z"},
            {"id": 2, "updated_at": "2026-09-06T10:00:00Z"},
        ]}
        detail = {
            "id": 2, "title": "IT Project Manager", "company_name": "Xebia",
            "content": "Delivery", "location": {"name": "Bucharest, Romania"},
            "first_published": "2026-09-06T09:00:00Z",
            "absolute_url": "https://job-boards.greenhouse.io/xebiacee/jobs/2",
        }
        with patch.object(public_api, "fetch_json", side_effect=[listing, detail]) as fetch:
            records = public_api._collect_greenhouse(source, CONFIG, NOW)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["date_posted"], detail["first_published"])
        self.assertEqual(fetch.call_count, 2)

    def test_ashby_schema_failure_is_explicit(self):
        source = {"name": "Camunda", "url": "https://jobs.ashbyhq.com/camunda"}
        with patch.object(public_api, "fetch_json", return_value={"error": "bad"}):
            with self.assertRaisesRegex(ValueError, "jobs array"):
                public_api.collect("ashby", source, CONFIG, NOW)


class RoutingTests(unittest.TestCase):
    def test_concrete_ats_boards_route_independently_and_generic_root_stays_deferred(self):
        catalog = {"sources": [
            {"name": "Camunda", "url": "https://camunda.com/career/", "active": True},
            {"name": "Kong", "url": "https://konghq.com/company/careers", "active": True},
            {"name": "Ashby", "url": "https://jobs.ashbyhq.com/", "active": True},
        ]}
        plan = orchestration.build_plan(catalog)
        self.assertEqual(plan[0]["connector"], "ashby")
        self.assertEqual(plan[1]["connector"], "ashby")
        self.assertEqual(plan[0]["status"], "pending")
        self.assertEqual(plan[1]["status"], "pending")
        self.assertEqual(plan[2]["connector"], "deferred")
        self.assertEqual(plan[2]["status"], "skipped")

    def test_blocked_public_job_boards_now_use_dedicated_connectors(self):
        catalog = {"sources": [
            {"name": "Jobgether", "url": "https://jobgether.com/", "active": True},
            {"name": "Himalayas", "url": "https://himalayas.app/jobs", "active": True},
            {"name": "Remote OK", "url": "https://remoteok.com/", "active": True},
        ]}
        plan = orchestration.build_plan(catalog)
        self.assertEqual([item["connector"] for item in plan], ["jobgether", "himalayas", "remoteok"])

    def test_operational_route_preserves_catalog_url_for_diagnostics(self):
        plan = orchestration.build_plan({"sources": [
            {"name": "Endava", "url": "https://careers.endava.com/", "active": True},
        ]})[0]
        self.assertEqual(plan["url"], "https://careers.endava.com/")
        self.assertEqual(plan["operational_url"], "https://careers.smartrecruiters.com/Endava")
        self.assertEqual(plan["connector"], "smartrecruiters")


if __name__ == "__main__":
    unittest.main()
