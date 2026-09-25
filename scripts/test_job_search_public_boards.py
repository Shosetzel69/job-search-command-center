import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import job_search_public_boards as boards

NOW = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)


class PublicBoardAdapterTests(unittest.TestCase):
    def test_remoteok_normalizes_public_json(self):
        payload = [
            {"last_updated": 1},
            {"id":"1","position":"Technical Project Manager","company":"Example",
             "description":"<p>Delivery</p>","date":"2026-09-25T08:00:00+00:00",
             "location":"Europe","url":"https://remoteok.com/remote-jobs/1"},
        ]
        with patch.object(boards, "_get_json", return_value=payload):
            rows = boards._remoteok(NOW)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Technical Project Manager")
        self.assertTrue(rows[0]["remote"])
        self.assertEqual(rows[0]["sources"],[{"provider":"Remote OK"}])

    def test_himalayas_uses_cursor_but_is_bounded(self):
        first = {"jobs":[{
            "title":"Delivery Manager","companyName":"Example","description":"<p>Lead delivery</p>",
            "applicationLink":"https://himalayas.app/jobs/1","guid":"g1","pubDate":1790323200,
            "locationRestrictions":["Romania"],"employmentType":"Contract",
        }],"nextCursor":"next"}
        second = {"jobs":[],"nextCursor":None}
        with patch.object(boards, "_get_json", side_effect=[first,second]) as fetch:
            rows = boards._himalayas(NOW)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["country_codes"],["RO"])
        self.assertEqual(fetch.call_count,2)

    def test_working_nomads_normalizes_exposed_feed(self):
        payload=[{
            "url":"https://www.workingnomads.com/job/go/1/",
            "title":"IT Project Manager","description":"<p>Programme</p>",
            "company_name":"Example","location":"Remote, Europe",
            "pub_date":"2026-09-25T02:36:13-04:00",
        }]
        with patch.object(boards, "_get_json", return_value=payload):
            rows=boards._workingnomads(NOW)
        self.assertEqual(rows[0]["company"],"Example")
        self.assertTrue(rows[0]["remote"])

    def test_jobgether_paginates_without_profile_filters(self):
        payload={"jobs":[{
            "id":"j1","title":"Service Delivery Manager","company":"Example",
            "url":"https://jobgether.com/offer/j1","location":"Romania",
            "remote":"Full Remote","contractType":"Contract",
            "postedAt":"2026-09-25T07:00:00Z","jobFunctions":["Delivery"],
        }],"pagination":{"hasMore":False}}
        with patch.object(boards, "_get_json", return_value=payload) as fetch:
            rows=boards._jobgether(NOW)
        requested=fetch.call_args.args[0]
        self.assertNotIn("project",requested.lower())
        self.assertNotIn("romania",requested.lower())
        self.assertEqual(rows[0]["country_codes"],["RO"])

    def test_rss_adapter_accepts_empty_feed_as_successful_empty(self):
        xml='<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>'
        with patch.object(boards, "_get_text", return_value=xml):
            rows=boards._rss("wwr","We Work Remotely","https://example.test/rss",NOW)
        self.assertEqual(rows,[])

    def test_rss_adapter_normalizes_item(self):
        xml='''<?xml version="1.0"?><rss><channel><item>
          <title>Example: Program Manager</title>
          <link>https://example.test/job/1</link>
          <description><![CDATA[<p>PMO delivery</p>]]></description>
          <pubDate>Thu, 25 Sep 2026 08:00:00 +0000</pubDate>
        </item></channel></rss>'''
        with patch.object(boards, "_get_text", return_value=xml):
            rows=boards._rss("wwr","We Work Remotely","https://example.test/rss",NOW)
        self.assertEqual(rows[0]["company"],"Example")
        self.assertEqual(rows[0]["job_title"],"Program Manager")
        self.assertTrue(rows[0]["remote"])

    def test_landing_jobs_normalizes_public_list(self):
        payload=[{
            "id":7,"title":"Project Manager","company_name":"Example",
            "role_description":"Delivery","published_at":"2026-09-25T08:00:00Z",
            "country_code":"RO","city":"Bucharest","remote":True,
            "url":"https://landing.jobs/jobs/7","type":"contract",
        }]
        with patch.object(boards, "_get_json", return_value=payload):
            rows=boards._landingjobs(NOW)
        self.assertEqual(rows[0]["country_codes"],["RO"])
        self.assertTrue(rows[0]["remote"])

    def test_eures_search_is_broad_and_normalizes_result(self):
        payload={"jvs":[{
            "id":"abc","title":"IT Project Manager","description":"Delivery",
            "creationDate":1790323200000,
            "employer":{"name":"EU Example"},
            "locationMap":{"RO":["RO32"]},
        }]}
        with patch.object(boards, "_post_json", return_value=payload) as post:
            rows=boards._eures(NOW)
        sent=post.call_args.args[1]
        self.assertEqual(sent["keywords"],[])
        self.assertEqual(sent["locationCodes"],[])
        self.assertEqual(rows[0]["country_codes"],["RO"])
        self.assertEqual(rows[0]["company"],"EU Example")

    def test_dispatch_returns_success_empty_collection_result(self):
        with patch.object(boards, "_remoteok", return_value=[]):
            results=boards.collect("remoteok",{"name":"Remote OK"},NOW)
        self.assertTrue(results[0].ok)
        self.assertEqual(results[0].records,[])
        self.assertEqual(results[0].total_available,0)


if __name__ == "__main__":
    unittest.main()
