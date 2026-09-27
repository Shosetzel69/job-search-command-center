import unittest
from unittest.mock import patch

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

    def test_himalayas_normalizes_jobs_array(self):
        rows = boards._himalayas({"jobs":[{
            "guid":"h-1","title":"Program Manager","companyName":"Example",
            "description":"Coordinate programs","pubDate":1790330400,
            "applicationLink":"https://example.com/jobs/1",
            "locationRestrictions":["Romania"],"employmentType":"Full Time",
        }]})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["countries"],["Romania"])

    def test_working_nomads_normalizes_array(self):
        rows = boards._workingnomads([{
            "url":"https://workingnomads.com/jobs/123",
            "title":"Delivery Manager","company_name":"NomadCo",
            "description":"Delivery","category_name":"Management",
            "location":"Europe","pub_date":"2026-09-25T08:00:00Z",
        }])
        self.assertEqual(rows[0]["job_title"],"Delivery Manager")

    def test_jobgether_validates_shape(self):
        with self.assertRaises(ValueError):
            boards._jobgether([])
        rows = boards._jobgether({"jobs":[{
            "id":"j1","title":"Project Manager","company":"Co",
            "url":"https://jobgether.com/job/j1","location":"Romania",
            "remote":"Remote","contractType":"Contract","postedAt":"2026-09-25T08:00:00Z",
        }]})
        self.assertTrue(rows[0]["remote"])

    def test_rss_empty_feed_is_valid_empty_result(self):
        xml=b'<?xml version="1.0"?><rss><channel><title>Jobs</title></channel></rss>'
        self.assertEqual(boards._rss(xml,"Example","https://example.com/feed"),[])

    def test_rss_skips_malformed_item_and_decodes_html_named_entity(self):
        xml=b'''<?xml version="1.0"?><rss><channel>
          <item><title>Broken</title><link>   </link></item>
          <item><title>Scrum Master &hellip;</title><link>https://example.com/jobs/7</link>
          <description>Agile &amp; delivery</description><guid>7</guid>
          <pubDate>Thu, 25 Sep 2026 10:00:00 +0000</pubDate></item>
        </channel></rss>'''
        rows=boards._rss(xml,"Example","https://example.com/feed")
        self.assertEqual(len(rows),1)
        self.assertIn("Scrum Master",rows[0]["job_title"])
        self.assertEqual(rows[0]["source_url"],"https://example.com/jobs/7")

    def test_eu_careers_table_parser_extracts_public_vacancy(self):
        html='''<table><tr><th>Title</th></tr><tr>
          <td><a href="/en/job/123">IT Service Manager</a></td>
          <td>Information Technology</td><td>AD 7</td><td>EU Agency</td>
          <td>Brussels (Belgium)</td><td>25/09/2026</td><td>15/10/2026 - 12:00</td>
        </tr></table>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",html.encode()),
            (200,"text/html",b"<html><body>No rows</body></html>"),
        ]):
            rows=boards._eu_careers("https://eu-careers.europa.eu/en/job-opportunities/open-vacancies/cast")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT Service Manager")
        self.assertEqual(rows[0]["company"],"EU Agency")
        self.assertIn("Belgia",rows[0]["countries"])
        self.assertEqual(rows[0]["date_posted"],"2026-09-25T00:00:00+00:00")

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

    def test_atos_table_parser_extracts_public_job_rows(self):
        html='''<table><tr>
          <td><a href="/job/Timisoara-Project-Manager/123456/">Project Manager</a></td>
          <td>Timisoara, RO</td><td>Sep 27, 2026</td>
        </tr></table>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",html.encode()),
            (200,"text/html",html.encode()),
        ]):
            rows=boards._atos("https://jobs.atos.net/viewalljobs/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")
        self.assertEqual(rows[0]["company"],"Atos")
        self.assertEqual(rows[0]["date_posted"],"2026-09-27T00:00:00+00:00")
        self.assertIn("Romania",rows[0]["countries"])

    def test_remote_co_list_parser_extracts_job_detail_links(self):
        html='''<div>New! Today <h3><a href="/job-details/project-manager-abc">Project Manager</a></h3>
          <h4>Example Inc</h4></div>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._remote_co("https://remote.co/remote-jobs")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")
        self.assertEqual(rows[0]["company"],"Example Inc")
        self.assertTrue(rows[0]["remote"])
        self.assertIsNotNone(rows[0]["date_posted"])

    def test_supported_sources_are_explicit(self):
        for name in ["Remote OK","Himalayas","Working Nomads","Jobgether",
                     "Landing.Jobs","We Work Remotely","NoDesk","EU Remote Jobs",
                     "EU Careers / EPSO","Remote.co","Remotive","Atos"]:
            self.assertTrue(boards.source_supported(name))
        for name in ["EURES","Remote in Europe","Unknown Board"]:
            self.assertFalse(boards.source_supported(name))


if __name__ == "__main__":
    unittest.main()
