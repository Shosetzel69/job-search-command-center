import unittest

import job_search_public_boards as boards


class PublicBoardAdapterTests(unittest.TestCase):
    def test_remoteok_normalizes_public_api(self):
        rows = boards._remoteok([
            {"legal":"meta"},
            {"id":"42","position":"Technical Project Manager","company":"Acme",
             "description":"Delivery role","location":"Europe",
             "url":"https://remoteok.com/remote-jobs/42","date":"2026-09-25T10:00:00+00:00",
             "tags":["project-management"]},
        ])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Technical Project Manager")
        self.assertTrue(rows[0]["remote"])
        self.assertEqual(rows[0]["sources"],[{"provider":"Remote OK"}])

    def test_himalayas_normalizes_jobs_array(self):
        rows = boards._himalayas({"jobs":[{
            "guid":"h-1","title":"Program Manager","companyName":"Example",
            "description":"Coordinate programs","pubDate":1790330400,
            "applicationLink":"https://example.com/jobs/1",
            "locationRestrictions":["Romania"],"employmentType":"Full Time",
        }]})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"Example")
        self.assertEqual(rows[0]["countries"],["Romania"])
        self.assertTrue(rows[0]["remote"])

    def test_working_nomads_normalizes_array(self):
        rows = boards._workingnomads([{
            "url":"https://workingnomads.com/jobs/123",
            "title":"Delivery Manager","company_name":"NomadCo",
            "description":"Delivery","category_name":"Management",
            "location":"Europe","pub_date":"2026-09-25T08:00:00Z",
        }])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Delivery Manager")

    def test_jobgether_validates_shape(self):
        with self.assertRaises(ValueError):
            boards._jobgether([])
        rows = boards._jobgether({"jobs":[{
            "id":"j1","title":"Project Manager","company":"Co",
            "url":"https://jobgether.com/job/j1","location":"Romania",
            "remote":"Remote","contractType":"Contract","postedAt":"2026-09-25T08:00:00Z",
        }]})
        self.assertEqual(len(rows),1)
        self.assertTrue(rows[0]["remote"])

    def test_rss_empty_feed_is_valid_empty_result(self):
        xml=b'<?xml version="1.0"?><rss><channel><title>Jobs</title></channel></rss>'
        self.assertEqual(boards._rss(xml,"Example","https://example.com/feed"),[])

    def test_rss_normalizes_item(self):
        xml=b'''<?xml version="1.0"?><rss><channel>
          <item><title>Scrum Master</title><link>https://example.com/jobs/7</link>
          <description>Agile delivery</description><guid>7</guid>
          <pubDate>Thu, 25 Sep 2026 10:00:00 +0000</pubDate></item>
        </channel></rss>'''
        rows=boards._rss(xml,"Example","https://example.com/feed")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Scrum Master")
        self.assertEqual(rows[0]["source_url"],"https://example.com/jobs/7")

    def test_supported_sources_are_explicit(self):
        for name in ["Remote OK","Himalayas","Working Nomads","Jobgether",
                     "Landing.Jobs","We Work Remotely","NoDesk",
                     "EU Remote Jobs","Remote in Europe"]:
            self.assertTrue(boards.source_supported(name))
        self.assertFalse(boards.source_supported("Unknown Board"))


if __name__ == "__main__":
    unittest.main()
