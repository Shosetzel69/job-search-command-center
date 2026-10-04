import unittest
from unittest.mock import patch

import job_search_public_boards as boards


class PublicBoardAdapterTests(unittest.TestCase):
    def test_eures_normalizes_public_search_response(self):
        rows=boards._eures({"numberRecords":1,"jvs":[{
            "id":"abc123","title":"IT Project Manager","description":"Coordinate delivery",
            "creationDate":1790330400000,
            "locationMap":{"RO":["RO321"]},
            "positionScheduleCodes":["fulltime"],
            "employer":{"name":"Example SA"},
            "translations":{},
        }]})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"Example SA")
        self.assertEqual(rows[0]["countries"],["Romania"])
        self.assertIn("abc123",rows[0]["source_url"])

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

    def test_remotive_public_api_normalizes_jobs(self):
        rows = boards._remotive({"jobs":[{
            "id":123,"title":"IT Project Manager","company_name":"Example",
            "description":"Lead delivery","candidate_required_location":"Europe",
            "url":"https://remotive.com/remote-jobs/project-management/it-project-manager-123",
            "publication_date":"2026-09-27T08:00:00Z","job_type":"full_time",
        }]})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT Project Manager")
        self.assertTrue(rows[0]["remote"])

    def test_nato_taleo_parser_extracts_public_vacancy_rows(self):
        payload={
            "requisitionList":[{
                "jobId":"261453",
                "contestNo":"261453",
                "column":["Support Analyst (CapDev)", "[\"Belgium-Mons\"]", "Sep 27, 2026"],
            }],
            "pagingData":{"currentPageNo":1,"pageSize":25,"totalCount":1},
        }
        with patch.object(boards,"_taleo_post_json",return_value=payload) as post:
            rows=boards._nato_taleo(
                "https://nato.taleo.net/careersection/2/jobsearch.ftl?lang=en",
                "101430233",
                "2",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Support Analyst (CapDev)")
        self.assertEqual(rows[0]["company"],"NATO")
        self.assertTrue(rows[0]["countries"])
        self.assertIn("job=261453",rows[0]["source_url"])
        self.assertIn("portal=101430233",post.call_args.args[0])

    def test_atos_table_parser_extracts_public_job_rows(self):
        html='''<table><tr>
          <td><a href="/job/Timisoara-Project-Manager/123456/">Project Manager</a></td>
          <td>Timisoara, RO</td><td>Sep 27, 2026</td>
        </tr></table>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",html.encode()),
            (200,"text/html",html.encode()),
        ]):
            rows=boards._atos("https://jobs.atos.net/go/Jobs-in-Romania/3686501/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")
        self.assertEqual(rows[0]["company"],"Atos")
        self.assertEqual(rows[0]["date_posted"],"2026-09-27T00:00:00+00:00")
        self.assertTrue(rows[0]["countries"])

    def test_jobs4it_parser_extracts_recent_public_jobs(self):
        html='''<section>
          <div><a href="/job/scrum-master-project-manager/">Scrum Master/Project Manager</a>
          Industry: European Institution Remote Freelance Full Time September 24, 2026</div>
          <div><a href="/job/it-project-manager-26/">IT Project Manager</a>
          Athens, Greece Hybrid Full Time September 26, 2026</div>
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._jobs4it("https://jobs4it.gr/")
        self.assertEqual(len(rows),2)
        by_title={row["job_title"]:row for row in rows}
        self.assertTrue(by_title["Scrum Master/Project Manager"]["remote"])
        self.assertEqual(by_title["Scrum Master/Project Manager"]["date_posted"],"2026-09-24T00:00:00+00:00")
        self.assertTrue(by_title["IT Project Manager"]["countries"])
        self.assertTrue(by_title["IT Project Manager"]["source_url"].endswith("/job/it-project-manager-26/"))

    def test_supported_sources_are_explicit(self):
        for name in ["EURES","Remote OK","Himalayas","Working Nomads","Jobgether",
                     "Landing.Jobs","We Work Remotely","NoDesk",
                     "EU Remote Jobs","Remote in Europe","Remotive","Atos","UpcoMinds","NATO Careers"]:
            self.assertTrue(boards.source_supported(name))
        self.assertFalse(boards.source_supported("Unknown Board"))


if __name__ == "__main__":
    unittest.main()
