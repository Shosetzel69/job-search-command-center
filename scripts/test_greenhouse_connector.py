import json
import unittest
from unittest.mock import Mock

import job_search_greenhouse as greenhouse


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class GreenhouseConnectorTests(unittest.TestCase):
    def test_collect_normalizes_public_board(self):
        opener = Mock(return_value=FakeResponse({
            "jobs": [{
                "id": 123,
                "title": "Senior Project Manager",
                "location": {"name": "Bucharest, Romania / Remote"},
                "updated_at": "2026-09-07T09:00:00Z",
                "absolute_url": "https://job-boards.greenhouse.io/example/jobs/123",
                "content": "<p>Lead complex delivery</p>",
                "departments": [{"name": "Delivery"}],
                "offices": [{"name": "Bucharest"}],
            }],
            "meta": {"total": 1},
        }))

        results = greenhouse.collect("example", "Example Co", opener=opener)

        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].ok)
        self.assertEqual(results[0].total_available, 1)
        record = results[0].records[0]
        self.assertEqual(record["id"], "greenhouse:example:123")
        self.assertEqual(record["job_title"], "Senior Project Manager")
        self.assertEqual(record["company"], "Example Co")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["work_arrangement"], "remote")
        self.assertEqual(record["departments"], ["Delivery"])
        self.assertEqual(record["offices"], ["Bucharest"])
        self.assertIn("Lead complex delivery", record["description"])
        self.assertEqual(opener.call_count, 1)
        request = opener.call_args.args[0]
        self.assertIn("/boards/example/jobs?content=true", request.full_url)

    def test_max_postings_limits_output_but_preserves_total(self):
        opener = Mock(return_value=FakeResponse({
            "jobs": [
                {"id": i, "title": f"Role {i}", "absolute_url": f"https://example/{i}"}
                for i in range(3)
            ],
            "meta": {"total": 3},
        }))

        results = greenhouse.collect(
            "example", "Example Co", max_postings=2, opener=opener
        )

        self.assertEqual(len(results[0].records), 2)
        self.assertEqual(results[0].total_available, 3)

    def test_missing_board_token_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "board_token"):
            greenhouse.collect("", "Example Co")

    def test_missing_company_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "company_name"):
            greenhouse.collect("example", "")

    def test_malformed_payload_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"meta": {"total": 1}}))
        with self.assertRaisesRegex(ValueError, "jobs array"):
            greenhouse.collect("example", "Example Co", opener=opener)

    def test_malformed_job_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"jobs": [{"id": 1}]}))
        with self.assertRaisesRegex(ValueError, "missing id/title/url/company"):
            greenhouse.collect("example", "Example Co", opener=opener)


if __name__ == "__main__":
    unittest.main()
