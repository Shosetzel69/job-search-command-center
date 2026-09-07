import json
import unittest
from unittest.mock import Mock

import job_search_eightfold as eightfold
import job_search_phenom as phenom
import job_search_successfactors as successfactors


class FakeResponse:
    def __init__(self, payload, raw=False):
        self.body = payload if raw else json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class SuccessFactorsTests(unittest.TestCase):
    def test_collect_parses_public_xml_feed(self):
        xml = b"""<?xml version='1.0' encoding='UTF-8'?>
        <Job-Listing><Job><ReqId>123</ReqId><JobTitle>Project Manager</JobTitle>
        <Location>Bucharest, Romania</Location>
        <Job-Description><![CDATA[<p>Lead delivery</p>]]></Job-Description>
        <Posted-Date>2026-09-07</Posted-Date></Job></Job-Listing>"""
        opener = Mock(return_value=FakeResponse(xml, raw=True))
        result = successfactors.collect(
            "https://career4.successfactors.com/career", "EXAMPLE", "Example Co", opener=opener
        )[0]
        self.assertEqual(result.total_available, 1)
        record = result.records[0]
        self.assertEqual(record["id"], "successfactors:EXAMPLE:123")
        self.assertEqual(record["location"], "Bucharest, Romania")
        self.assertIn("Lead delivery", record["description"])
        self.assertEqual(record["date_posted"], "2026-09-07")
        request = opener.call_args.args[0]
        self.assertIn("resultType=XML", request.full_url)
        self.assertIn("company=EXAMPLE", request.full_url)

    def test_legacy_lowercase_xml_is_tolerated(self):
        xml = b"<jobs><job><jobId>1</jobId><title>PM</title><country>RO</country></job></jobs>"
        opener = Mock(return_value=FakeResponse(xml, raw=True))
        record = successfactors.collect(
            "https://career4.successfactors.com/career", "EXAMPLE", "Example Co", opener=opener
        )[0].records[0]
        self.assertEqual(record["countries"], ["Romania"])

    def test_invalid_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            successfactors.collect("http://example.com/career", "X", "Example")


class PhenomTests(unittest.TestCase):
    def test_collect_requires_token(self):
        with self.assertRaisesRegex(RuntimeError, "PHENOM_API_TOKEN"):
            phenom.collect("", "Example Co")

    def test_collect_normalizes_jobs_api(self):
        opener = Mock(return_value=FakeResponse({
            "hits": 1,
            "data": [{
                "jobId": "P-1", "title": "Delivery Manager", "city": "Bucharest",
                "country": "Romania", "employmentType": "Full-time",
                "description": "Own delivery", "applyUrl": "https://careers.example/jobs/P-1",
                "postedDate": "2026-09-07T08:00:00Z"
            }]
        }))
        result = phenom.collect("token", "Example Co", opener=opener)[0]
        record = result.records[0]
        self.assertEqual(record["id"], "phenom:P-1")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertEqual(record["date_posted"], "2026-09-07T08:00:00Z")
        request = opener.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer token")

    def test_invalid_payload_is_rejected(self):
        opener = Mock(return_value=FakeResponse({"data": {}}))
        with self.assertRaisesRegex(ValueError, "jobs array"):
            phenom.collect("token", "Example Co", opener=opener)


class EightfoldTests(unittest.TestCase):
    def test_collect_requires_token(self):
        with self.assertRaisesRegex(RuntimeError, "EIGHTFOLD_API_TOKEN"):
            eightfold.collect("example", "", "Example Co")

    def test_collect_normalizes_positions(self):
        opener = Mock(return_value=FakeResponse({
            "count": 1,
            "positions": [{
                "positionId": "E-1", "name": "Senior Project Manager",
                "jobDescription": "Lead transformation", "location": "Bucharest, Romania",
                "country": "RO", "employmentType": "Full-time",
                "jobUrl": "https://example.ai/careers/job/E-1",
                "postedDate": "2026-09-07T09:00:00Z"
            }]
        }))
        result = eightfold.collect("example", "token", "Example Co", opener=opener)[0]
        record = result.records[0]
        self.assertEqual(record["id"], "eightfold:example:E-1")
        self.assertEqual(record["countries"], ["Romania"])
        self.assertEqual(record["source_url"], "https://example.ai/careers/job/E-1")
        request = opener.call_args.args[0]
        self.assertIn("/api/v2/core/positions?", request.full_url)
        self.assertEqual(request.get_header("Authorization"), "Bearer token")

    def test_invalid_domain_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "domain"):
            eightfold.collect("bad domain", "token", "Example Co")


if __name__ == "__main__":
    unittest.main()
