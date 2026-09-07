import json
import unittest
from unittest.mock import Mock

import job_search_workday as workday


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class WorkdayConnectorTests(unittest.TestCase):
    def test_parse_career_url_with_locale(self):
        board = workday.parse_career_url(
            "https://example.wd3.myworkdayjobs.com/en-US/External"
        )
        self.assertEqual(board["tenant"], "example")
        self.assertEqual(board["site"], "External")
        self.assertEqual(board["locale"], "en-US")
        self.assertEqual(
            board["cxs_base"],
            "https://example.wd3.myworkdayjobs.com/wday/cxs/example/External",
        )

    def test_collect_lists_details_and_normalizes(self):
        opener = Mock(side_effect=[
            FakeResponse({
                "total": 1,
                "jobPostings": [{
                    "title": "IT Project Manager",
                    "externalPath": "/job/Bucharest/IT-Project-Manager_R-100",
                    "locationsText": "Bucharest, Romania",
                    "postedOn": "Posted Today",
                }],
            }),
            FakeResponse({
                "jobPostingInfo": {
                    "jobReqId": "R-100",
                    "title": "IT Project Manager",
                    "jobDescription": "<p>Lead enterprise delivery</p>",
                    "location": "Bucharest, Romania",
                    "startDate": "2026-09-07",
                    "timeType": "Full time",
                    "remoteType": "Remote",
                    "jobRequisitionLocation": {
                        "country": {"alpha2Code": "RO"}
                    },
                }
            }),
        ])

        results = workday.collect(
            "https://example.wd3.myworkdayjobs.com/en-US/External",
            "Example Co",
            opener=opener,
        )

        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].ok)
        self.assertEqual(results[0].total_available, 1)
        record = results[0].records[0]
        self.assertEqual(record["id"], "workday:example:External:R-100")
        self.assertEqual(record["job_title"], "IT Project Manager")
        self.assertEqual(record["company"], "Example Co")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertTrue(record["remote"])
        self.assertEqual(record["work_arrangement"], "remote")
        self.assertEqual(record["date_posted"], "2026-09-07")
        self.assertIn("Lead enterprise delivery", record["description"])
        self.assertEqual(
            record["source_url"],
            "https://example.wd3.myworkdayjobs.com/en-US/External/job/Bucharest/IT-Project-Manager_R-100",
        )
        self.assertEqual(opener.call_count, 2)

        list_request = opener.call_args_list[0].args[0]
        self.assertEqual(list_request.get_method(), "POST")
        payload = json.loads(list_request.data)
        self.assertEqual(payload["limit"], 20)
        self.assertEqual(payload["offset"], 0)

    def test_collect_paginates_in_twenty_item_pages(self):
        first = [
            {"title": f"Role {i}", "externalPath": f"/job/X/Role_{i}"}
            for i in range(20)
        ]
        second = [
            {"title": "Role 20", "externalPath": "/job/X/Role_20"}
        ]
        responses = [
            FakeResponse({"total": 21, "jobPostings": first}),
            FakeResponse({"total": 0, "jobPostings": second}),
        ]
        for i in range(21):
            responses.append(FakeResponse({
                "jobPostingInfo": {
                    "jobReqId": f"R-{i}",
                    "title": f"Role {i}",
                    "jobDescription": "<p>Delivery</p>",
                    "location": "Romania",
                    "country": "RO",
                }
            }))
        opener = Mock(side_effect=responses)

        results = workday.collect(
            "https://example.wd3.myworkdayjobs.com/External",
            "Example Co",
            max_postings=50,
            opener=opener,
        )

        self.assertEqual(results[0].total_available, 21)
        self.assertEqual(opener.call_count, 23)
        second_request = opener.call_args_list[1].args[0]
        self.assertEqual(json.loads(second_request.data)["offset"], 20)

    def test_invalid_host_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "myworkdayjobs"):
            workday.collect("https://example.com/External", "Example Co")

    def test_missing_site_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "site name"):
            workday.collect("https://example.wd3.myworkdayjobs.com/", "Example Co")

    def test_missing_company_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "company_name"):
            workday.collect(
                "https://example.wd3.myworkdayjobs.com/External", ""
            )

    def test_malformed_list_payload_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"total": 1}))
        with self.assertRaisesRegex(ValueError, "jobPostings array"):
            workday.collect(
                "https://example.wd3.myworkdayjobs.com/External",
                "Example Co",
                opener=opener,
            )

    def test_invalid_external_path_is_rejected(self):
        opener = Mock(return_value=FakeResponse({
            "total": 1,
            "jobPostings": [{"title": "Role", "externalPath": "bad"}],
        }))
        with self.assertRaisesRegex(ValueError, "externalPath"):
            workday.collect(
                "https://example.wd3.myworkdayjobs.com/External",
                "Example Co",
                opener=opener,
            )


if __name__ == "__main__":
    unittest.main()
