import json
import unittest
from unittest.mock import Mock

import job_search_bamboohr as bamboohr
import job_search_workable as workable


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
    def test_collect_normalizes_public_job(self):
        opener = Mock(return_value=FakeResponse({
            "name": "Example Co",
            "jobs": [{
                "id": "job-1",
                "title": "Project Manager",
                "shortlink": "https://apply.workable.com/j/ABC123",
                "description": "<p>Lead delivery</p>",
                "employment_type": "Full-time",
                "published_on": "2026-09-07T08:00:00Z",
                "department": "PMO",
                "location": {
                    "location_str": "Bucharest, Romania",
                    "country": "Romania",
                    "country_code": "RO",
                    "telecommuting": True,
                    "workplace_type": "remote",
                },
            }],
        }))
        result = workable.collect("example", "Example Co", opener=opener)[0]
        record = result.records[0]
        self.assertEqual(record["id"], "workable:example:job-1")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["date_posted"], "2026-09-07T08:00:00Z")
        self.assertIn("Lead delivery", record["description"])
        request = opener.call_args.args[0]
        self.assertIn("/api/v1/widget/accounts/example?details=true", request.full_url)

    def test_invalid_subdomain_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "subdomain"):
            workable.collect("bad.example", "Example Co")

    def test_missing_jobs_is_rejected(self):
        opener = Mock(return_value=FakeResponse({}))
        with self.assertRaisesRegex(ValueError, "jobs array"):
            workable.collect("example", "Example Co", opener=opener)


class BambooHRTests(unittest.TestCase):
    def test_collect_combines_list_and_detail(self):
        opener = Mock(side_effect=[
            FakeResponse({
                "meta": {"totalCount": 1},
                "result": [{
                    "id": "35",
                    "jobOpeningName": "IT Project Manager",
                    "departmentLabel": "Technology",
                    "employmentStatusLabel": "Employee",
                    "location": {"city": "Bucharest", "state": None},
                    "atsLocation": {"country": "Romania", "city": "Bucharest"},
                    "locationType": "2",
                }],
            }),
            FakeResponse({
                "result": {"jobOpening": {
                    "id": "35",
                    "jobOpeningName": "IT Project Manager",
                    "description": "<p>Own transformation</p>",
                    "datePosted": "2026-09-07T06:00:00Z",
                    "employmentType": "Full-Time",
                    "departmentLabel": "Technology",
                    "atsLocation": {"country": "Romania", "city": "Bucharest"},
                    "locationType": "2",
                    "jobOpeningShareUrl": "https://example.bamboohr.com/careers/35",
                }}
            }),
        ])
        result = bamboohr.collect("example", "Example Co", opener=opener)[0]
        record = result.records[0]
        self.assertEqual(result.total_available, 1)
        self.assertEqual(record["id"], "bamboohr:example:35")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertEqual(record["work_arrangement"], "hybrid")
        self.assertEqual(record["date_posted"], "2026-09-07T06:00:00Z")
        self.assertIn("Own transformation", record["description"])
        self.assertEqual(opener.call_count, 2)
        self.assertTrue(opener.call_args_list[1].args[0].full_url.endswith("/careers/35/detail"))

    def test_remote_location_type_is_normalized(self):
        opener = Mock(side_effect=[
            FakeResponse({"result": [{
                "id": "1", "jobOpeningName": "Remote PM", "locationType": "1"
            }]}),
            FakeResponse({"result": {"jobOpening": {
                "id": "1", "jobOpeningName": "Remote PM", "locationType": "1",
                "description": "Remote delivery"
            }}}),
        ])
        record = bamboohr.collect("example", "Example Co", opener=opener)[0].records[0]
        self.assertTrue(record["remote"])
        self.assertEqual(record["work_arrangement"], "remote")
        self.assertIn("Remote", record["location"])

    def test_malformed_detail_is_rejected(self):
        opener = Mock(side_effect=[
            FakeResponse({"result": [{"id": "1", "jobOpeningName": "PM"}]}),
            FakeResponse({"result": {}}),
        ])
        with self.assertRaisesRegex(ValueError, "detail"):
            bamboohr.collect("example", "Example Co", opener=opener)


if __name__ == "__main__":
    unittest.main()
