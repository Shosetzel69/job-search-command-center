import json
import unittest

import job_search_remoteok as remoteok


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _size=-1):
        return self.body


class RemoteOkConnectorTests(unittest.TestCase):
    def fixture(self, location="Europe"):
        return {
            "id": "123",
            "position": "IT Project Manager",
            "company": "Example",
            "description": "<p>Lead delivery &amp; governance</p>",
            "location": location,
            "date": "2026-09-20T10:00:00+00:00",
            "url": "https://remoteok.com/remote-jobs/123",
        }

    def test_collect_skips_metadata_and_normalizes_jobs(self):
        payload = [
            {"last_updated": 1, "legal": "link back"},
            self.fixture(),
        ]

        def opener(_request, timeout):
            self.assertEqual(timeout, 30)
            return FakeResponse(payload)

        result = remoteok.collect(opener=opener)[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.total_available, 1)
        record = result.records[0]
        self.assertEqual(record["id"], "remoteok:123")
        self.assertEqual(record["job_title"], "IT Project Manager")
        self.assertEqual(record["company"], "Example")
        self.assertEqual(record["location"], "Europe")
        self.assertTrue(record["remote"])
        self.assertTrue(record["romania_eligible"])
        self.assertEqual(record["source_url"], "https://remoteok.com/remote-jobs/123")
        self.assertEqual(record["sources"], [{"provider": "Remote OK"}])

    def test_restricted_non_target_location_is_not_marked_eligible(self):
        record = remoteok.normalize(self.fixture("United States"))
        self.assertFalse(record["romania_eligible"])

    def test_empty_metadata_only_feed_is_success_empty(self):
        result = remoteok.collect(opener=lambda *_args, **_kwargs: FakeResponse([
            {"last_updated": 1, "legal": "link back"}
        ]))[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.records, [])
        self.assertEqual(result.total_available, 0)

    def test_malformed_job_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "missing id/position/company/url"):
            remoteok.normalize({"id": "1", "position": "PM"})


if __name__ == "__main__":
    unittest.main()
