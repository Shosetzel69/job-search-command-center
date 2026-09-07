import json
import unittest
from unittest.mock import Mock

import job_search_ashby as ashby
import job_search_lever as lever
import job_search_recruitee as recruitee


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class AshbyTests(unittest.TestCase):
    def test_collect_normalizes_listed_job(self):
        opener = Mock(return_value=FakeResponse({
            "apiVersion": "1",
            "jobs": [{
                "title": "Project Manager",
                "location": "Bucharest",
                "isListed": True,
                "isRemote": True,
                "workplaceType": "Remote",
                "descriptionPlain": "Lead delivery",
                "publishedAt": "2026-09-07T08:00:00+00:00",
                "employmentType": "FullTime",
                "address": {"postalAddress": {"addressCountry": "Romania"}},
                "jobUrl": "https://jobs.ashbyhq.com/example/job-123",
                "applyUrl": "https://jobs.ashbyhq.com/example/job-123/application",
                "department": "Delivery",
            }],
        }))
        result = ashby.collect("example", "Example Co", opener=opener)[0]
        self.assertEqual(result.total_available, 1)
        record = result.records[0]
        self.assertEqual(record["id"], "ashby:example:job-123")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["date_posted"], "2026-09-07T08:00:00+00:00")
        self.assertEqual(record["department"], "Delivery")

    def test_unlisted_jobs_are_not_emitted(self):
        opener = Mock(return_value=FakeResponse({"jobs": [{
            "title": "Hidden",
            "location": "Romania",
            "isListed": False,
            "jobUrl": "https://jobs.ashbyhq.com/example/hidden",
        }]}))
        result = ashby.collect("example", "Example Co", opener=opener)[0]
        self.assertEqual(result.records, [])
        self.assertEqual(result.total_available, 0)

    def test_invalid_payload_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"apiVersion": "1"}))
        with self.assertRaisesRegex(ValueError, "jobs array"):
            ashby.collect("example", "Example Co", opener=opener)


class LeverTests(unittest.TestCase):
    def test_collect_normalizes_eu_posting(self):
        opener = Mock(return_value=FakeResponse([{
            "id": "abc",
            "text": "Delivery Manager",
            "categories": {
                "location": "Bucharest",
                "allLocations": ["Bucharest"],
                "commitment": "Full-time",
                "department": "Delivery",
                "team": "PMO",
            },
            "country": "RO",
            "descriptionPlain": "Own delivery",
            "lists": [{"text": "Requirements", "content": "<li>5 years</li>"}],
            "additionalPlain": "Apply now",
            "hostedUrl": "https://jobs.eu.lever.co/example/abc",
            "applyUrl": "https://jobs.eu.lever.co/example/abc/apply",
            "workplaceType": "hybrid",
        }]))
        result = lever.collect("example", "Example Co", region="eu", opener=opener)[0]
        record = result.records[0]
        self.assertEqual(record["id"], "lever:eu:example:abc")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertEqual(record["work_arrangement"], "hybrid")
        self.assertIn("Requirements 5 years", record["description"])
        request = opener.call_args.args[0]
        self.assertTrue(request.full_url.startswith("https://api.eu.lever.co/"))

    def test_invalid_region_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "global or eu"):
            lever.collect("example", "Example Co", region="us")

    def test_non_list_payload_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"data": []}))
        with self.assertRaisesRegex(ValueError, "JSON array"):
            lever.collect("example", "Example Co", opener=opener)


class RecruiteeTests(unittest.TestCase):
    def test_collect_normalizes_offer_and_optional_token(self):
        opener = Mock(return_value=FakeResponse({
            "offers": [{
                "id": 10,
                "title": "IT Project Manager",
                "slug": "it-project-manager",
                "description": "<p>Lead transformation</p>",
                "requirements": "<p>PMP preferred</p>",
                "locations": [{"name": "Bucharest", "country": "Romania"}],
                "remote": True,
                "workplace_type": "remote",
                "employment_type": "Full-time",
                "published_at": "2026-09-07T07:00:00Z",
                "department": {"name": "Technology"},
            }],
        }))
        result = recruitee.collect(
            "example", "Example Co", token="secret", opener=opener
        )[0]
        record = result.records[0]
        self.assertEqual(record["id"], "recruitee:example:10")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["department"], "Technology")
        self.assertEqual(
            record["source_url"],
            "https://example.recruitee.com/o/it-project-manager",
        )
        request = opener.call_args.args[0]
        self.assertEqual(request.get_header("X-careers-sites-token"), "secret")

    def test_invalid_subdomain_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "subdomain"):
            recruitee.collect("bad.example", "Example Co")

    def test_missing_offers_is_rejected(self):
        opener = Mock(return_value=FakeResponse({}))
        with self.assertRaisesRegex(ValueError, "offers array"):
            recruitee.collect("example", "Example Co", opener=opener)


if __name__ == "__main__":
    unittest.main()
