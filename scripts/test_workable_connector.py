import json
import unittest
from unittest.mock import Mock, patch

import job_search as engine
import job_search_workable as workable
import source_orchestration as orchestration


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class WorkableTests(unittest.TestCase):
    def test_collect_normalizes_public_account_jobs(self):
        payload = {
            "name": "QUALCO Group",
            "jobs": [{
                "id": "job-1",
                "shortcode": "ABC123",
                "title": "IT Project Manager",
                "url": "https://apply.workable.com/qualcogroup/j/ABC123/",
                "description": "<p>Lead delivery</p>",
                "published_on": "2026-10-04",
                "employment_type": "Full-time",
                "telecommuting": True,
                "locations": [{
                    "country_code": "RO",
                    "country_name": "Romania",
                    "city": "Bucharest",
                }],
            }],
        }
        opener = Mock(return_value=FakeResponse(payload))
        result = workable.collect("qualcogroup", "Qualco Group / Quento", opener=opener)[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.total_available, 1)
        record = result.records[0]
        self.assertEqual(record["job_title"], "IT Project Manager")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertIn("Lead delivery", record["description"])
        self.assertIn("details=true", opener.call_args.args[0].full_url)

    def test_workable_route_dispatches_public_connector(self):
        source = {
            "id": "qualco",
            "name": "Qualco Group / Quento",
            "url": "https://apply.workable.com/qualcogroup/",
            "active": True,
        }
        item = orchestration.build_plan({"sources": [source]})[0]
        self.assertEqual(item["connector"], "workable")
        self.assertEqual(item["connector_config"]["subdomain"], "qualcogroup")
        expected = [engine.CollectionResult("workable:qualcogroup", "public_account", True, [], 0)]
        with patch.object(orchestration.workable, "collect", return_value=expected) as collect:
            self.assertEqual(orchestration.collect_ats(item), expected)
            collect.assert_called_once_with("qualcogroup", "Qualco Group / Quento")

    def test_invalid_slug_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "subdomain"):
            workable.collect("../bad", "Example", opener=Mock())


if __name__ == "__main__":
    unittest.main()
