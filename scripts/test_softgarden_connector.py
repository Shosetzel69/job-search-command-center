import json
import unittest

import job_search_softgarden as softgarden


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def read(self, _size=-1):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class SoftgardenConnectorTests(unittest.TestCase):
    def test_schema_org_datafeed_normalizes_jobs(self):
        payload={
            "@context":"https://schema.org",
            "@type":"DataFeed",
            "dataFeedElement":[{
                "@type":"DataFeedItem",
                "item":{
                    "@type":"JobPosting",
                    "identifier":{"@type":"PropertyValue","value":"orange-123"},
                    "title":"IT Project Manager",
                    "description":"Lead delivery",
                    "datePosted":"2026-10-01",
                    "employmentType":"FULL_TIME",
                    "url":"https://cariere.orange.ro/job/123",
                    "hiringOrganization":{"@type":"Organization","name":"Orange Romania"},
                    "jobLocation":{
                        "@type":"Place",
                        "address":{
                            "@type":"PostalAddress",
                            "addressLocality":"Bucuresti",
                            "addressCountry":"RO"
                        }
                    }
                }
            }]
        }
        opener=lambda *_args,**_kwargs: FakeResponse(json.dumps(payload).encode())
        result=softgarden.collect(
            "https://cariere.orange.ro/jobs.feed.json","Orange Romania",opener=opener
        )[0]
        self.assertTrue(result.ok)
        self.assertEqual(result.total_available,1)
        row=result.records[0]
        self.assertEqual(row["id"],"softgarden:orange-123")
        self.assertEqual(row["job_title"],"IT Project Manager")
        self.assertEqual(row["company"],"Orange Romania")
        self.assertEqual(row["countries"],["Romania"])
        self.assertEqual(row["source_url"],"https://cariere.orange.ro/job/123")

    def test_remote_jobposting_is_preserved(self):
        payload={"dataFeedElement":[{"item":{
            "@type":"JobPosting","title":"Delivery Manager",
            "url":"https://example.career.softgarden.de/job/456",
            "jobLocationType":"TELECOMMUTE",
            "applicantLocationRequirements":{"@type":"Country","name":"Romania"},
        }}]}
        opener=lambda *_args,**_kwargs: FakeResponse(json.dumps(payload).encode())
        row=softgarden.collect(
            "https://example.career.softgarden.de/jobs.feed.json","Example",opener=opener
        )[0].records[0]
        self.assertTrue(row["remote"])
        self.assertEqual(row["work_arrangement"],"remote")

    def test_invalid_feed_shape_fails_closed(self):
        opener=lambda *_args,**_kwargs: FakeResponse(b'{"dataFeedElement":"bad"}')
        with self.assertRaises(ValueError):
            softgarden.collect(
                "https://example.career.softgarden.de/jobs.feed.json","Example",opener=opener
            )


if __name__ == "__main__":
    unittest.main()
