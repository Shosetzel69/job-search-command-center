import unittest
from unittest.mock import Mock, patch

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

    def test_landing_jobs_api_paginates_public_json(self):
        page=[{"id":1,"title":"Project Manager","country_name":"Portugal",
               "city":"Lisbon","published_at":"2026-09-27T08:00:00Z"}]
        with patch.object(boards,"_fetch",return_value=(200,"application/json",__import__("json").dumps(page).encode())):
            rows=boards._landing_jobs_api("https://landing.jobs/api/v1/jobs")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")

    def test_landing_jobs_api_falls_back_to_json_suffix(self):
        page=[{"id":1,"title":"Project Manager","country_name":"Portugal",
               "city":"Lisbon","published_at":"2026-09-27T08:00:00Z"}]
        def fake_fetch(url, accept):
            if "/jobs?" in url:
                raise RuntimeError("HTTP 403")
            return (200,"application/json",__import__("json").dumps(page).encode())
        with patch.object(boards,"_fetch",side_effect=fake_fetch) as fetch:
            rows=boards._landing_jobs_api("https://landing.jobs/api/v1/jobs")
        self.assertEqual(len(rows),1)
        self.assertTrue(any("/jobs.json?" in call.args[0] for call in fetch.call_args_list))

    def test_eu_remote_uses_202_feed_when_it_contains_jobs(self):
        xml=b'''<?xml version="1.0"?><rss><channel><item>
          <title>Remote Project Manager</title><link>https://euremotejobs.com/job/remote-project-manager/</link>
          <pubDate>Sun, 27 Sep 2026 08:00:00 +0000</pubDate></item></channel></rss>'''
        with patch.object(boards,"_fetch",return_value=(202,"application/rss+xml",xml)):
            rows=boards._eu_remote_jobs("https://euremotejobs.com/","https://euremotejobs.com/feed/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Remote Project Manager")

    def test_eu_remote_accepts_202_html_fallback(self):
        html='''<div><a href="/job/pm-202/">Project Manager</a>
        Example Europe Full Time Project Management Posted 2 hours ago</div>'''
        with patch.object(boards,"_fetch",side_effect=[
            (202,"text/html",b"<html>pending</html>"),
            (202,"text/html",html.encode()),
        ]):
            rows=boards._eu_remote_jobs("https://euremotejobs.com/","https://euremotejobs.com/feed/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")

    def test_eu_remote_falls_back_to_public_html_jobs(self):
        html='''<div><a href="/job/pm-123/">Technical Project Manager</a>
        Example Co Europe Full Time Project Management Posted 6 hours ago</div>'''
        with patch.object(boards,"_fetch",side_effect=[
            (202,"application/rss+xml",b"<html>pending</html>"),
            (200,"text/html",html.encode()),
        ]):
            rows=boards._eu_remote_jobs("https://euremotejobs.com/","https://euremotejobs.com/feed/")
        self.assertEqual(len(rows),1)
        self.assertTrue(rows[0]["remote"])
        self.assertIsNotNone(rows[0]["date_posted"])

    def test_worldline_uses_rmk_public_job_table(self):
        html='''<table><tr>
          <td><a href="/job/Paris-Technical-Project-Manager/789/">Technical Project Manager</a></td>
          <td>Paris, FR</td><td>Sep 27, 2026</td>
        </tr></table>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",html.encode()),
            (200,"text/html",html.encode()),
        ]):
            rows=boards._worldline("https://jobs.worldline.com/viewalljobs/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"Worldline")
        self.assertIn("Franta",rows[0]["countries"])

    def test_worldline_falls_back_to_rendered_rmk_and_paginates(self):
        static_html=b"<html><body><div>Results 1 - 50 of 51</div></body></html>"
        first_page="<table>" + "".join(
            f'<tr><td><a href="/job/City-Role-{i}/{300000+i}/">Role {i}</a></td>'
            f'<td>Bucharest, RO</td><td>Oct 04, 2026</td></tr>'
            for i in range(50)
        ) + "</table>"
        second_page='''<table><tr>
          <td><a href="/job/Paris-Delivery-Manager/399999/">Delivery Manager</a></td>
          <td>Paris, FR</td><td>Oct 04, 2026</td>
        </tr></table>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",static_html)), \
             patch.object(boards.browser,"render",side_effect=[
                 ("https://jobs.worldline.com/viewalljobs/",first_page,{"browser_status":"rendered"}),
                 ("https://jobs.worldline.com/viewalljobs/50/",second_page,{"browser_status":"rendered"}),
             ]) as render:
            rows=boards._worldline("https://jobs.worldline.com/viewalljobs/")
        self.assertEqual(len(rows),51)
        self.assertEqual(render.call_count,2)
        self.assertTrue(any(row["job_title"]=="Delivery Manager" for row in rows))
        self.assertTrue(any("Romania" in row["countries"] for row in rows))
        self.assertTrue(any("Franta" in row["countries"] for row in rows))

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
        self.assertIn("Belgia",rows[0]["countries"])
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
        self.assertIn("Romania",rows[0]["countries"])

    def test_rmk_anchor_fallback_and_path_pagination(self):
        html='''<section>
          <a class="jobTitle-link" href="/job/Bucharest-Delivery-Manager/987654/">Delivery Manager</a>
          Bucharest, RO Sep 26, 2026
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())) as fetch:
            rows=boards._worldline("https://jobs.worldline.com/viewalljobs/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Delivery Manager")
        self.assertIn("Romania",rows[0]["countries"])
        self.assertEqual(rows[0]["date_posted"],"2026-09-26T00:00:00+00:00")
        self.assertIn("sortColumn=referencedate",fetch.call_args.args[0])
        self.assertIn("/viewalljobs/",fetch.call_args.args[0])
        self.assertEqual(
            boards._rmk_page_url("https://jobs.worldline.com/viewalljobs/",50),
            "https://jobs.worldline.com/viewalljobs/50/?q=&sortColumn=referencedate&sortDirection=desc",
        )

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
        self.assertIn("Grecia",by_title["IT Project Manager"]["countries"])
        self.assertTrue(by_title["IT Project Manager"]["source_url"].endswith("/job/it-project-manager-26/"))

    def test_eurobrussels_extracts_public_job_list(self):
        html='''<section>
          <h3><a href="/job_display/297045/Bid_Manager_M_F_Suez_Consulting_Brussels_Belgium">Bid Manager (M/F)</a></h3>
          <div>Suez Consulting</div><div>Brussels, Belgium</div>
          <p>Manage international tenders and project delivery.</p>
          <div>Posted 5 days ago</div>
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._eurobrussels("https://www.eurobrussels.com/job_search")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Bid Manager (M/F)")
        self.assertEqual(rows[0]["company"],"Suez Consulting")
        self.assertIn("Belgia",rows[0]["countries"])
        self.assertIn("/job_display/297045/",rows[0]["source_url"])

    def test_societe_generale_extracts_complete_public_job_links(self):
        html='''<section>
          <a href="/en/job-offers/project-manager-with-french-26000CM7-en">Project Manager with French</a>
          <div>Bucuresti, Romania Permanent contract Innovation / Project / Organization Hybrid</div>
          <a href="/en/job-offers/data-engineer-26000IP3-en">Data Engineer</a>
          <div>Bucuresti, Romania Permanent contract IT (Information Technology)</div>
        </section>'''
        fake_client=Mock()
        fake_client.get.return_value=("https://careers.societegenerale.com/en/Technical/all-job-offers",html)
        with patch.object(boards,"PublicClient",return_value=fake_client):
            rows=boards._socgen("https://careers.societegenerale.com/en/Technical/all-job-offers")
        self.assertEqual(len(rows),2)
        by_title={row["job_title"]:row for row in rows}
        self.assertIn("Romania",by_title["Project Manager with French"]["countries"])
        self.assertTrue(by_title["Project Manager with French"]["remote"])
        self.assertIn("26000CM7",by_title["Project Manager with French"]["source_url"])

    def test_softserve_paginates_public_romania_jobs(self):
        page1='''<div><a href="/en-us/vacancies/nvidia-program-manager-90001">NVIDIA Program Manager</a>
          Project Management Director Romania</div>'''
        page2='''<div><a href="/en-us/vacancies/cloud-delivery-manager-90002">Cloud Delivery Manager</a>
          Project Management Manager Romania Remote</div>'''
        fake_client=Mock()
        fake_client.get.side_effect=[
            ("https://career.softserveinc.com/en-us/vacancies/country-romania",page1),
            ("https://career.softserveinc.com/en-us/vacancies/country-romania/page-2",page2),
            ("https://career.softserveinc.com/en-us/vacancies/country-romania/page-3","<html></html>"),
        ]
        with patch.object(boards,"PublicClient",return_value=fake_client):
            rows=boards._softserve("https://career.softserveinc.com/en-us/vacancies/country-romania")
        self.assertEqual(len(rows),2)
        self.assertTrue(any(row["job_title"]=="NVIDIA Program Manager" for row in rows))
        self.assertTrue(any(row["remote"] for row in rows))

    def test_epam_uses_rendered_public_romania_page(self):
        html='''<section>
          <a href="/en/vacancy/ai-delivery-manager-blt123_en">AI Delivery Manager</a>
          <div>Remote in Romania Delivery Management.AI</div>
          <a href="/en/vacancy/data-delivery-manager-blt456_en">Data Delivery Manager</a>
          <div>Hybrid in Romania Data Delivery Management</div>
        </section>'''
        fake_client=Mock()
        with patch.object(boards,"PublicClient",return_value=fake_client), \
             patch.object(boards.browser,"render",return_value=(
                 "https://careers.epam.com/en/jobs/romania",html,{"browser_status":"rendered"}
             )):
            rows=boards._epam("https://careers.epam.com/en/jobs/romania")
        self.assertEqual(len(rows),2)
        self.assertIn("Romania",rows[0]["countries"])
        self.assertTrue(any(row["remote"] for row in rows))

    def test_supported_sources_are_explicit(self):
        for name in ["EURES","Remote OK","Himalayas","Working Nomads","Jobgether",
                     "Landing.Jobs","We Work Remotely","NoDesk","EU Remote Jobs","Remote in Europe",
                     "EU Careers / EPSO","Remote.co","Remotive","Atos","Worldline","NATO Careers","UpcoMinds","EuroBrussels","Societe Generale","SoftServe","EPAM"]:
            self.assertTrue(boards.source_supported(name))
        self.assertFalse(boards.source_supported("Unknown Board"))


if __name__ == "__main__":
    unittest.main()
