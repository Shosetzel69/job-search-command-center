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

    def test_worldline_uses_public_rmk_tile_endpoint_and_paginates(self):
        first_page="<table>" + "".join(
            f'<tr><td><a href="/job/City-Role-{i}/{300000+i}/">Role {i}</a></td>'
            f'<td>Bucharest, RO</td><td>Oct 04, 2026</td></tr>'
            for i in range(10)
        ) + "</table>"
        second_page='''<table><tr>
          <td><a href="/job/Paris-Delivery-Manager/399999/">Delivery Manager</a></td>
          <td>Paris, FR</td><td>Oct 04, 2026</td>
        </tr></table>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",first_page.encode()),
            (200,"text/html",second_page.encode()),
        ]) as fetch:
            rows=boards._worldline("https://jobs.worldline.com/viewalljobs/")
        self.assertEqual(len(rows),11)
        self.assertEqual(fetch.call_count,2)
        self.assertIn("/tile-search-results/",fetch.call_args_list[0].args[0])
        self.assertIn("startrow=10",fetch.call_args_list[1].args[0])
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
        self.assertIn("/tile-search-results/",fetch.call_args.args[0])
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

    def test_orange_softgarden_feed_normalizes_jobs(self):
        payload={
            "@type":"DataFeed",
            "dataFeedElement":[{
                "@type":"JobPosting",
                "identifier":{"value":"orange-1"},
                "title":"IT Project Manager",
                "description":"Lead delivery",
                "datePosted":"2026-10-04",
                "employmentType":"FULL_TIME",
                "url":"https://cariere.orange.ro/job/it-project-manager",
                "hiringOrganization":{"name":"Orange Romania"},
                "jobLocation":{"address":{
                    "addressLocality":"Bucharest",
                    "addressCountry":"RO",
                }},
            }],
        }
        rows=boards._softgarden_feed(payload,"Orange Romania","https://cariere.orange.ro/jobs.feed.json")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT Project Manager")
        self.assertEqual(rows[0]["company"],"Orange Romania")
        self.assertIn("Romania",rows[0]["countries"])
        self.assertEqual(rows[0]["date_posted"],"2026-10-04")

    def test_mantu_rendered_board_extracts_jobs(self):
        html='''<div>
          <a href="/brands/amaris-consulting/jobs/45037">IT & Digital Project Manager</a>
          Barcelona Spain Permanent Job Remote
        </div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://careers.mantu.com/jobs",html,{"browser_status":"rendered"}
        )):
            rows=boards._rendered_career_board(
                "https://careers.mantu.com/jobs","Mantu",r"/brands/[^/?#]+/jobs/\d+"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT & Digital Project Manager")
        self.assertIn("Spania",rows[0]["countries"])
        self.assertTrue(rows[0]["remote"])

    def test_serco_rendered_board_extracts_jobs(self):
        html='''<div>
          <a href="/eu/en/job/309763/Project-Manager">Project Manager</a>
          Brussels Belgium Corporate Operations and ICT Hybrid
        </div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://careers.serco.com/eu/en/search-results",html,{"browser_status":"rendered"}
        )):
            rows=boards._rendered_career_board(
                "https://careers.serco.com/eu/en/search-results","Serco Europe",
                r"/eu/en/job/\d+/[^/?#]+"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")
        self.assertIn("Belgia",rows[0]["countries"])
        self.assertTrue(rows[0]["remote"])

    def test_nextventures_extracts_ref_listings(self):
        html='''<section>
          <div>Ref: #75221</div><h4>Technical Product Owner</h4>
          <div>Amsterdam, Netherlands</div><div>Cloud & Infrastructure</div><div>Contract</div>
          <div>Ref: #75220</div><h4>SailPoint Developer</h4>
          <div>Amsterdam, Netherlands</div><div>Cyber Security</div><div>Contract</div>
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._nextventures("https://next-ventures.com/jobs/")
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["job_title"],"Technical Product Owner")
        self.assertIn("Tarile de Jos",rows[0]["countries"])
        self.assertIn("Contract",rows[0]["employment_statuses"])
        self.assertTrue(rows[0]["source_url"].endswith("#ref-75221"))

    def test_hays_romania_extracts_job_detail_links(self):
        html='''<section>
          <a href="/en/job-detail/noc-lead-bucharest_1200467">NOC Lead</a>
          We are looking for a Network Operations Center Lead. Bucharest Romania Permanent Posted 2 days ago
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://www.hays.ro/en/job-search","Hays Romania",r"/en/job-detail/[^?#]+"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"NOC Lead")
        self.assertIn("Romania",rows[0]["countries"])
        self.assertTrue(rows[0]["source_url"].endswith("_1200467"))

    def test_squareone_fetches_public_job_details(self):
        listing='''<div><a href="/job/linux-programme-manager-133184-1790948751">Read More</a></div>'''
        detail='''<html><h1>Linux Programme Manager</h1>
          <div>Sheffield United Kingdom Posted 2 days ago Work Type Contract Remote Work - No</div>
        </html>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",listing.encode()),
            (200,"text/html",detail.encode()),
        ]):
            rows=boards._squareone("https://www.squareoneresources.com/jobs")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Linux Programme Manager")
        self.assertIn("Contract",rows[0]["employment_statuses"])
        self.assertIn("Regatul Unit",rows[0]["countries"])
        self.assertFalse(rows[0]["remote"])

    def test_proactive_rendered_jobs_extracts_public_job_links(self):
        html='''<div>
          <a href="/job/it-projects-analyst-11879ac/">IT Projects Analyst – 11879AC</a>
          Epsom, UK Permanent Posted 13 hours ago Hybrid
        </div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://www.proactive.it/job-vacancies/",html,{"browser_status":"rendered"}
        )):
            rows=boards._rendered_career_board(
                "https://www.proactive.it/job-vacancies/","Proactive.IT",r"/job/[^/?#]+/?$"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT Projects Analyst – 11879AC")
        self.assertTrue(rows[0]["remote"])

    def test_powertofly_extracts_public_job_links(self):
        html='''<section>
          <a href="/jobs/detail/2530129">Project Manager App Services</a>
          SoftwareOne Madrid Spain Hybrid Posted 12 hours ago
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://powertofly.com/jobs/?only_html=True",
                "PowerToFly",r"/jobs/detail/\d+"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager App Services")
        self.assertIn("Spania",rows[0]["countries"])
        self.assertTrue(rows[0]["remote"])
        self.assertTrue(rows[0]["source_url"].endswith("/jobs/detail/2530129"))

    def test_wellfound_extracts_public_job_links(self):
        html='''<section>
          <a href="/jobs/4804897-remote-project-development-manager">REMOTE PROJECT DEVELOPMENT MANAGER</a>
          Florida Tents & Events Remote only Canada United States Full Time Posted today
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://wellfound.com/jobs","Wellfound",r"/jobs/\d+-[^?#]+"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"REMOTE PROJECT DEVELOPMENT MANAGER")
        self.assertTrue(rows[0]["remote"])
        self.assertTrue(rows[0]["source_url"].endswith("4804897-remote-project-development-manager"))

    def test_skipthedrive_extracts_project_manager_jobs(self):
        html='''<section>
          <a href="/job/cardinal-agile-project-manager-1444485/">Agile Project Manager</a>
          Cardinal 6 days ago Part time Remote
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://www.skipthedrive.com/job-category/remote-project-manager-jobs/",
                "SkipTheDrive",r"/job/[^?#]+-\d+/"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Agile Project Manager")
        self.assertTrue(rows[0]["remote"])

    def test_prohuman_skips_closed_jobs_and_keeps_open_jobs(self):
        listing='''<div>
          <a href="/candidati/jobs/closedRole">Closed</a>
          <a href="/candidati/jobs/ItNetworksupport">Open</a>
        </div>'''
        closed='''<html><h1>Project Manager</h1><div>Rolul este inchis Bucuresti Full time</div></html>'''
        opened='''<html><h1>IT Network Support Specialist</h1>
          <div>Prohuman APT IT Full time Cluj-Napoca Romania Posted 2 weeks ago</div></html>'''
        client=Mock()
        client.get.side_effect=[
            ("https://www.prohuman.ro/candidati/jobs/closedRole",closed),
            ("https://www.prohuman.ro/candidati/jobs/ItNetworksupport",opened),
        ]
        with patch.object(boards.browser,"render",return_value=(
            "https://www.prohuman.ro/locuri-de-munca",listing,{"browser_status":"rendered"}
        )), patch.object(boards,"PublicClient",return_value=client):
            rows=boards._prohuman("https://www.prohuman.ro/locuri-de-munca")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"IT Network Support Specialist")
        self.assertIn("Romania",rows[0]["countries"])
        self.assertTrue(rows[0]["source_url"].endswith("/ItNetworksupport"))

    def test_source_group_international_extracts_jobs(self):
        html='''<section>
          <a href="/jobs/change-transformation-expert-zurich-31844995/">Change & Transformation Expert</a>
          Zürich Switzerland Contract Apply by 31 Oct 2026
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://www.sourcegroupinternational.com/candidate/",
                "Source Group International",r"/jobs/[^?#]+/"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Change & Transformation Expert")
        self.assertIn("Elvetia",rows[0]["countries"])
        self.assertTrue(rows[0]["source_url"].endswith("31844995/"))

    def test_github_careers_rendered_jobs(self):
        html='''<section>
          <a href="/careers-home/jobs/5773">Staff Software Engineer, Git Systems</a>
          United Kingdom Engineering Experienced Professional Full Time Remote
        </section>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://www.github.careers/careers-home/jobs",html,{"browser_status":"rendered"}
        )):
            rows=boards._rendered_career_board(
                "https://www.github.careers/careers-home/jobs",
                "GitHub",r"/careers-home/jobs/\d+"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Staff Software Engineer, Git Systems")
        self.assertIn("Regatul Unit",rows[0]["countries"])

    def test_brains_consulting_skips_filled_jobs(self):
        listing='''<article><h2><a href="/active-job/">Active Job</a></h2></article>
                   <article><h2><a href="/filled-job/">Filled Job</a></h2></article>'''
        active='''<html><h1>Medici Stomatologi - NETHERLANDS</h1><div>Netherlands post disponibil</div></html>'''
        filled='''<html><h1>Sofer camion</h1><div>TOATE LOCURILE DE MUNCA VACANTE AU FOST OCUPATE</div></html>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",listing.encode()),
            (200,"text/html",active.encode()),
            (200,"text/html",filled.encode()),
        ]):
            rows=boards._brains("https://www.brainsconsulting.ro/category/locuri-de-munca/")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Medici Stomatologi - NETHERLANDS")
        self.assertIn("Tarile de Jos",rows[0]["countries"])

    def test_montreal_associates_uses_stable_internal_reference(self):
        listing='''<section>
          <a href="/it/candidates/job/sap-btp-consultant-1564/">SAP BTP Consultant</a>
        </section>'''
        detail='''<html><h1>SAP BTP Consultant</h1>
          <div>006P2000015v7hJIAQ_1789463704 Posted: 15/09/2026</div>
          <div>Bologna Italy Permanent Hybrid</div>
        </html>'''
        client=Mock()
        client.get.return_value=(
            "https://www.montrealassociates.com/it/candidates/job/sap-btp-consultant-1564/",
            detail,
        )
        with patch.object(boards.browser,"render",return_value=(
            "https://www.montrealassociates.com/uk/candidates/job-search/",
            listing,{"browser_status":"rendered"}
        )), patch.object(boards,"PublicClient",return_value=client):
            rows=boards._montreal_associates(
                "https://www.montrealassociates.com/uk/candidates/job-search/"
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["id"],"montreal-associates:006P2000015v7hJIAQ_1789463704")
        self.assertEqual(rows[0]["job_title"],"SAP BTP Consultant")
        self.assertEqual(rows[0]["date_posted"],"2026-09-15T00:00:00+00:00")
        self.assertIn("Italia",rows[0]["countries"])
        self.assertTrue(rows[0]["remote"])

    def test_ejobs_bounded_pagination_extracts_public_jobs(self):
        page1='''<section>
          <div>5 Oct. 2026</div>
          <h2><a href="/user/locuri-de-munca/it-project-manager/99247317">IT Project Manager</a></h2>
          <h3>Example SA</h3><div>Bucuresti</div><div>Hibrid</div>
        </section>'''
        page2='''<section>
          <div>4 Oct. 2026</div>
          <h2><a href="/user/locuri-de-munca/project-management-officer/99247318">Project Management Officer</a></h2>
          <h3>Another SA</h3><div>Bucuresti</div>
        </section>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",page1.encode()),
            (200,"text/html",page2.encode()),
        ]) as fetch:
            rows=boards._ejobs(
                "https://www.ejobs.ro/locuri-de-munca/bucuresti/it-project-manager",
                max_pages=2,
            )
        self.assertEqual(len(rows),2)
        by_title={row["job_title"]:row for row in rows}
        self.assertEqual(by_title["IT Project Manager"]["company"],"Example SA")
        self.assertEqual(by_title["IT Project Manager"]["date_posted"],"2026-10-05T00:00:00+00:00")
        self.assertIn("Romania",by_title["IT Project Manager"]["countries"])
        self.assertTrue(by_title["IT Project Manager"]["remote"])
        self.assertEqual(fetch.call_count,2)
        self.assertIn("/pagina2",fetch.call_args.args[0])

    def test_trasys_filters_keyes_group_jobs(self):
        html='''<section>
          <a href="/o/application-cloud-architect-eu-institution">Application Cloud Architect</a>
          Hybrid Brussels Belgium Trasys International
          <a href="/o/project-manager-mes">Project Manager MES</a>
          Hybrid Herstal Belgium Local managed staffing
        </section>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._trasys_keyes("https://keyescareers.eu/find-my-job")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Application Cloud Architect")
        self.assertEqual(rows[0]["company"],"Trasys International")
        self.assertIn("Belgia",rows[0]["countries"])
        self.assertTrue(rows[0]["source_url"].endswith("/o/application-cloud-architect-eu-institution"))

    def test_dailyremote_preserves_company_and_numeric_identity(self):
        page1='''<section>
          <a href="/remote-job/it-project-manager-eu-5582352">IT Project Manager - EU</a>
          Meta Resources Group Full Time 2 Days Ago Romania, Oman Project Management
        </section>'''
        page2='''<section>
          <a href="/remote-job/technical-project-manager-5684376">Technical Project Manager</a>
          Cloud Computing Consultants Contract 5 Days Ago United States
        </section>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",page1.encode()),
            (200,"text/html",page2.encode()),
        ]) as fetch:
            rows=boards._dailyremote(
                "https://dailyremote.com/remote-project-management-jobs",
                max_pages=2,
            )
        self.assertEqual(len(rows),2)
        by_title={row["job_title"]:row for row in rows}
        self.assertEqual(by_title["IT Project Manager - EU"]["company"],"Meta Resources Group")
        self.assertEqual(by_title["IT Project Manager - EU"]["id"],"dailyremote:5582352")
        self.assertTrue(by_title["IT Project Manager - EU"]["remote"])
        self.assertIn("Romania",by_title["IT Project Manager - EU"]["countries"])
        self.assertEqual(fetch.call_count,2)
        self.assertIn("page=2",fetch.call_args.args[0])

    def test_jobspresso_uses_public_rss_route(self):
        spec=boards.PUBLIC_BOARD_SOURCES["Jobspresso"]
        self.assertEqual(spec["kind"],"rss")
        self.assertEqual(spec["url"],"https://jobspresso.co/?feed=job_feed")
        payload=b"""<?xml version='1.0'?><rss><channel><item>
          <title>Technical Project Manager</title>
          <link>https://jobspresso.co/job/technical-project-manager-current/</link>
          <description>Remote delivery role</description>
          <author>Example Co</author>
          <pubDate>Sun, 04 Oct 2026 10:00:00 +0000</pubDate>
        </item></channel></rss>"""
        rows=boards._rss(payload,"Jobspresso",spec["url"])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Technical Project Manager")
        self.assertEqual(rows[0]["company"],"Example Co")
        self.assertTrue(rows[0]["remote"])

    def test_awork_filters_to_target_roles_and_uses_stable_id(self):
        page1='''<section>
          <a href="/it-project-manager/id-8401">IT Project Manager</a>
          Construcții / Instalații fulltime Botosani, România Agile Project Management
          postat de VESTRA INDUSTRY SRL în 3 Mar 2026
          <a href="/electrician/id-8402">Electrician</a>
          Bucuresti, România postat de Example SRL în 4 Oct 2026
        </section>'''
        page2='''<section>
          <a href="/project-manager-eu-funds/id-8403">Project Manager | EU Funds</a>
          Iasi, România fulltime postat de LIFE IS HARD S.A. în 24 Mar 2026
        </section>'''
        with patch.object(boards,"_fetch",side_effect=[
            (200,"text/html",page1.encode()),
            (200,"text/html",page2.encode()),
        ]):
            rows=boards._awork("https://www.awork.ro/",max_pages=2)
        self.assertEqual(len(rows),2)
        by_title={row["job_title"]:row for row in rows}
        self.assertEqual(by_title["IT Project Manager"]["id"],"awork-ro:8401")
        self.assertEqual(by_title["IT Project Manager"]["company"],"VESTRA INDUSTRY SRL")
        self.assertEqual(by_title["IT Project Manager"]["date_posted"],"2026-03-03T00:00:00+00:00")
        self.assertIn("Romania",by_title["IT Project Manager"]["countries"])
        self.assertNotIn("Electrician",by_title)

    def test_freelancer_api_normalizes_active_projects(self):
        payload={"result":{"projects":[{
            "id":123456,
            "title":"Technical Project Manager",
            "description":"Lead a software delivery programme.",
            "submitdate":1791115200,
            "seo_url":"project-management/technical-project-manager-123456",
            "type":"fixed",
            "budget":{"minimum":500,"maximum":1200},
            "currency":{"code":"EUR"},
            "jobs":[{"name":"Project Management"},{"name":"Agile Development"}],
        }]}}
        rows=boards._freelancer_api(payload)
        self.assertEqual(len(rows),1)
        row=rows[0]
        self.assertEqual(row["id"],"freelancer-com:123456")
        self.assertEqual(row["job_title"],"Technical Project Manager")
        self.assertEqual(row["company"],"Freelancer.com")
        self.assertTrue(row["remote"])
        self.assertIn("Freelance",row["employment_statuses"])
        self.assertIn("Budget 500-1200 EUR",row["description"])
        self.assertIn("Project Management",row["description"])
        self.assertTrue(row["source_url"].startswith("https://www.freelancer.com/projects/"))

    def test_enterprise_public_linked_routes(self):
        cases = [
            (
                "Worldpay / Global Payments",
                "https://jobs.globalpayments.com/jobs",
                r"/en/jobs/r\d+/[^?#]+/?",
                '<a href="/en/jobs/r0070713/customer-service-representative-1/">Customer Service Representative</a> Bucharest Romania',
            ),
            (
                "Luxoft",
                "https://career.luxoft.com/jobs?country[]=Romania&perPage=60",
                r"/jobs/[^/?#]+-\d+",
                '<a href="/jobs/senior-scrum-master-27444">Senior Scrum Master</a> Bucharest Romania',
            ),
            (
                "Stripe",
                "https://stripe.com/careers/search",
                r"/careers/apply/[^/?#]+/\d+",
                '<a href="/careers/apply/ai-solutions-program-manager-finance/7869917">AI Solutions Program Manager, Finance</a> Remote in Romania',
            ),
        ]
        for provider, url, pattern, html in cases:
            with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
                rows = boards._linked_job_board(url, provider, pattern)
            self.assertEqual(len(rows), 1, provider)
            self.assertEqual(rows[0]["company"], provider)
            self.assertTrue(rows[0]["source_url"].startswith("https://"), provider)

    def test_cegeka_and_computacenter_public_routes(self):
        cases = [
            (
                "Cegeka",
                "https://www.cegeka.com/en/ro/jobs/all-jobs",
                r"/en/ro/jobs/all-jobs/[^/?#]+-\d+",
                '<a href="/en/ro/jobs/all-jobs/senior-sql-dba-2-years-fixed-term-contract-8353">Senior SQL DBA</a> Bucharest Romania',
            ),
            (
                "Computacenter",
                "https://careers.computacenter.com/ro/search",
                r"/ro/offer/[^/?#]+/[0-9a-f-]+",
                '<a href="/ro/offer/senior-servicenow-developer-with-ge/44cccd5d-d7b3-4dd5-8a99-17891eb22a75">Senior ServiceNow Developer with German</a> Romania',
            ),
        ]
        for provider, url, pattern, html in cases:
            with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
                rows = boards._linked_job_board(url, provider, pattern)
            self.assertEqual(len(rows), 1, provider)
            self.assertEqual(rows[0]["company"], provider)

    def test_recruitment_public_linked_routes(self):
        cases = [
            (
                "RED Global",
                "https://redglobal.com/jobs",
                r"/jobs/job/[^/?#]+/[A-Za-z0-9]+",
                '<a href="/jobs/job/successfactors-project-manager/BngBdEpS">SuccessFactors Project Manager</a> Belgium Contract',
            ),
            (
                "Salt",
                "https://welovesalt.com/jobs",
                r"/jobs/[^/?#]+-\d+",
                '<a href="/jobs/project-manager-712978">Project Manager</a> London Hybrid Contract',
            ),
            (
                "Lawrence Harvey",
                "https://www.lawrenceharvey.com/jobs",
                r"/jobs/\d+[A-Za-z0-9-]+",
                '<a href="/jobs/327605projectmanager">Project Manager</a> Amsterdam Netherlands Contract',
            ),
        ]
        for provider, url, pattern, html in cases:
            with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
                rows = boards._linked_job_board(url, provider, pattern)
            self.assertEqual(len(rows), 1, provider)
            self.assertEqual(rows[0]["company"], provider)
            self.assertTrue(rows[0]["source_url"].startswith("https://"), provider)

    def test_w_talent_public_route(self):
        html='''<a href="/job/construction-project-manager-client-side/">
          Construction Project Manager (Client-Side)
        </a> England Permanent Remote Regional Role'''
        with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
            rows = boards._linked_job_board(
                "https://www.wtalent.com/uk/job-search/",
                "W Talent",
                r"/job/[^/?#]+/?$",
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["company"], "W Talent")
        self.assertEqual(rows[0]["job_title"], "Construction Project Manager (Client-Side)")

    def test_thaleria_public_route(self):
        html='''<a href="/careers/positions/senior-project-management-specialist-3523">
          Senior Project Management Specialist
        </a> Strasbourg France Near-site PRINCE2 Agile'''
        with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
            rows = boards._linked_job_board(
                "https://www.thaleria.com/careers/open-positions",
                "Thaleria",
                r"/careers/positions/[^/?#]+-\d+",
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["company"], "Thaleria")
        self.assertIn("Franta", rows[0]["countries"])

    def test_fujitsu_belgium_rendered_sap_route(self):
        html='''<div>
          <a href="/job/Senior-Project-Manager/12345-en_US">Senior Project Manager</a>
          Brussels Belgium Hybrid
        </div>'''
        with patch.object(boards.browser, "render", return_value=(
            "https://www.jobs.global.fujitsu.com/search/?locationsearch=Belgium",
            html,
            {"browser_status":"rendered"},
        )):
            rows=boards._rendered_career_board(
                "https://www.jobs.global.fujitsu.com/search/?q=&locationsearch=Belgium&searchResultView=LIST",
                "Fujitsu Belgium",
                r"/job/[^/?#]+/\d+-[A-Za-z_]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"Fujitsu Belgium")
        self.assertEqual(rows[0]["job_title"],"Senior Project Manager")
        self.assertIn("Belgia",rows[0]["countries"])

    def test_no_fluff_jobs_and_flexa_public_routes(self):
        cases = [
            (
                "No Fluff Jobs",
                "https://nofluffjobs.com/remote/project-manager",
                r"/job/[^/?#]+",
                '<a href="/job/project-manager-link-group-remote-11">Project Manager</a> Remote Link Group',
            ),
            (
                "Flexa",
                "https://flexa.careers/jobs",
                r"/jobs/[^/?#]+-[0-9a-f]{16,}",
                '<a href="/jobs/vodafone-project-manager-6a21fc13c705238de69852ac">Project Manager</a> Bucuresti Romania',
            ),
        ]
        for provider, url, pattern, html in cases:
            with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
                rows = boards._linked_job_board(url, provider, pattern)
            self.assertEqual(len(rows), 1, provider)
            self.assertEqual(rows[0]["company"], provider)

    def test_freelancermap_and_dynamite_routes(self):
        with patch.object(
            boards, "_fetch",
            return_value=(200, "text/html", b'<a href="/project/project-manager-m-w-d-anue-bonn-remote">Project Manager</a> Bonn Germany Remote Freelance')
        ):
            rows=boards._linked_job_board(
                "https://www.freelancermap.com/projects",
                "Freelancermap",
                r"/project/[^/?#]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"Freelancermap")
        self.assertTrue(rows[0]["remote"])

        html='<a href="/company/weka/remote-job/technical-project-manager">Technical Project Manager</a> Europe Remote'
        with patch.object(boards.browser,"render",return_value=(
            "https://dynamitejobs.com/remote-jobs/management-operations/project-manager",
            html,
            {"browser_status":"rendered"},
        )):
            rows=boards._rendered_career_board(
                "https://dynamitejobs.com/remote-jobs/management-operations/project-manager",
                "Dynamite Jobs",
                r"/company/[^/?#]+/remote-job/[^/?#]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Technical Project Manager")
        self.assertTrue(rows[0]["remote"])

    def test_keyes_nrb_public_route(self):
        html='''<a href="/o/data-engineer-employee-or-freelance">
          Data Engineer (employee or freelance)
        </a> Herstal Liege Belgium Hybrid'''
        with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
            rows = boards._linked_job_board(
                "https://keyescareers.eu/find-my-job",
                "KEYES / NRB",
                r"/o/[^/?#]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"KEYES / NRB")
        self.assertIn("Belgia",rows[0]["countries"])

    def test_justjoinit_and_crossover_routes(self):
        html='<a href="/job-offer/intent-senior-project-manager-iot-projects--warszawa-pm-1206bee1">Senior Project Manager (IoT projects)</a> Warszawa Remote B2B'
        with patch.object(boards, "_fetch", return_value=(200, "text/html", html.encode())):
            rows=boards._linked_job_board(
                "https://justjoin.it/job-offers/all-locations/pm?from=0",
                "Just Join IT",
                r"/job-offer/[^/?#]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Senior Project Manager (IoT projects)")
        self.assertTrue(rows[0]["remote"])

        rendered='<a href="/jobs/5669/2-hour-learning/vp-of-program-management-office">VP of Program Management Office</a> Remote full-time'
        with patch.object(boards.browser,"render",return_value=(
            "https://www.crossover.com/jobs",
            rendered,
            {"browser_status":"rendered"},
        )):
            rows=boards._rendered_career_board(
                "https://www.crossover.com/jobs",
                "Crossover",
                r"/jobs/\d+/[^/?#]+/[^/?#]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"VP of Program Management Office")
        self.assertTrue(rows[0]["remote"])

    def test_heading_list_sources_extract_records(self):
        justremote_html='''<h2>Mozilla Senior Staff Product Manager, Browser Control Platform</h2>
        <div>permanent 21 Sep Remote</div>
        <h2>Lemon.io Senior Project Manager</h2>
        <div>contract 17 Sep Remote Romania</div>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",justremote_html.encode())):
            rows=boards._heading_list_board(
                "https://justremote.co/remote-project-manager-jobs",
                "JustRemote",
                default_remote=True,
            )
        self.assertEqual(len(rows),2)
        self.assertTrue(all(row["remote"] for row in rows))
        self.assertEqual(rows[0]["company"],"JustRemote")

        techjobs_html='''<h2>Senior IT Project Manager</h2>
        <div>Prince2 Agile Project Manager Smals Remote friendly (hybrid) Multiple locations</div>
        <h2>PMO Manager</h2>
        <div>Prince2 Agile BPMN Project Manager Smals Brussels Belgium</div>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",techjobs_html.encode())):
            rows=boards._heading_list_board(
                "https://techjobs.be/en/ict-jobs",
                "Techjobs.be",
                default_country="Belgia",
            )
        self.assertEqual(len(rows),2)
        self.assertTrue(any(row["job_title"]=="PMO Manager" for row in rows))
        self.assertTrue(all("Belgia" in row["countries"] for row in rows))

    def test_hipo_project_manager_list(self):
        html='''<h2>Project Manager</h2>
        <div>Siemens Energy</div><div>03-10-2026</div><div>BUCURESTI</div>
        <h2>Project Manager with French</h2>
        <div>Societe Generale Global Solution Centre</div><div>03-10-2026</div><div>Hybrid</div>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._hipo(
                "https://www.hipo.ro/locuri-de-munca/cautajob/Toate-Domeniile/Toate-Orasele/project-manager"
            )
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["company"],"Siemens Energy")
        self.assertEqual(rows[0]["date_posted"],"2026-10-03T00:00:00+00:00")
        self.assertIn("Romania",rows[0]["countries"])
        self.assertTrue(rows[1]["remote"])

    def test_float_authoritative_empty_and_open_role(self):
        empty_html='''<h2>Current open roles</h2>
        <p>If you can't see a role that's right for you, send us a general application below.</p>
        <h2>A great hire goes both ways</h2>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",empty_html.encode())):
            rows=boards._float_careers("https://www.float.com/careers")
        self.assertEqual(rows,[])

        open_html='''<h2>Current open roles</h2>
        <a href="/careers/technical-project-manager">Technical Project Manager</a>
        <h2>A great hire goes both ways</h2>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",open_html.encode())):
            rows=boards._float_careers("https://www.float.com/careers")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Technical Project Manager")
        self.assertTrue(rows[0]["remote"])

    def test_eviden_first_party_list(self):
        html='''<div class="job-result">
          Senior IBM HPSS &amp; Tape Storage Systems Engineer H/F
          Oct 2, 2026 Toulouse, France Experienced
        </div>
        <div class="job-result">
          Lead Software Developer (m/f/d)
          May 21, 2026 Wien, Austria Experienced
        </div>'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._eviden("https://eviden.com/careers/")
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["company"],"Eviden")
        self.assertIn("Franta",rows[0]["countries"])
        self.assertEqual(rows[0]["date_posted"],"2026-10-02T00:00:00+00:00")
        self.assertIn("Austria",rows[1]["countries"])

    def test_harman_and_vector_synergy_rendered_routes(self):
        harman_html='''<div>
          <a href="/job/bucharest/technical-program-manager/23226/12345678">
            Technical Program Manager
          </a>
          Bucharest Romania Hybrid
        </div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://jobs.harman.com/search-jobs/?orgIds=23226",
            harman_html,
            {"browser_status":"rendered"},
        )):
            rows=boards._rendered_career_board(
                "https://jobs.harman.com/search-jobs/?orgIds=23226",
                "HARMAN",
                r"/job/[^/?#]+/[^/?#]+/23226/\d+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["company"],"HARMAN")
        self.assertEqual(rows[0]["job_title"],"Technical Program Manager")
        self.assertIn("Romania",rows[0]["countries"])

        vector_html='''<h3>Project Support Officer</h3>
        <div>Brussels Belgium NATO Secret Contract</div>
        <h3>Service Delivery Manager</h3>
        <div>The Hague Netherlands Hybrid Contract</div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://www.vectorsynergy.com/job-board",
            vector_html,
            {"browser_status":"rendered"},
        )):
            rows=boards._rendered_heading_list_board(
                "https://www.vectorsynergy.com/job-board",
                "Vector Synergy",
            )
        self.assertEqual(len(rows),2)
        self.assertTrue(all(row["company"]=="Vector Synergy" for row in rows))
        self.assertTrue(any("Belgia" in row["countries"] for row in rows))
        self.assertTrue(any("Tarile de Jos" in row["countries"] for row in rows))

    def test_wttj_peopleperhour_and_arc_routes(self):
        wttj_html='''<div>
          <a href="/en/companies/solveo-energie/jobs/construction-project-manager-romania-f-m_bucarest">
            Construction Project Manager Romania (F/M)
          </a>
          Bucuresti Romania Freelance A few days at home
        </div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://www.welcometothejungle.com/en/jobs?query=project%20manager",
            wttj_html,
            {"browser_status":"rendered"},
        )):
            rows=boards._rendered_career_board(
                "https://www.welcometothejungle.com/en/jobs?query=project%20manager",
                "Welcome to the Jungle",
                r"/en/companies/[^/?#]+/jobs/[^/?#]+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Construction Project Manager Romania (F/M)")
        self.assertIn("Romania",rows[0]["countries"])

        pph_html='''<a href="/freelance-jobs/technology-programming/website-development/project-manager-4494868">
          Project Manager
        </a> Remote Open for Proposals $60/hr'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",pph_html.encode())):
            rows=boards._linked_job_board(
                "https://www.peopleperhour.com/freelance-jobs?keyword=project%20manager",
                "PeoplePerHour",
                r"/freelance-jobs/(?:[^/?#]+/)*[^/?#]+-\d+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")
        self.assertTrue(rows[0]["remote"])

        arc_html='''<div>Jobgether</div>
        <h3>Program Manager</h3>
        <div>Full-time Manager Project management Remote - Romania 2 days ago</div>
        <div>Search for Hire</div>
        <h3>Search Engine Optimization Project Manager</h3>
        <div>Full-time Manager Remote anywhere 2 days ago</div>'''
        with patch.object(boards.browser,"render",return_value=(
            "https://arc.dev/remote-jobs?jobRoles=project_manager",
            arc_html,
            {"browser_status":"rendered"},
        )):
            rows=boards._arc("https://arc.dev/remote-jobs?jobRoles=project_manager")
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["company"],"Jobgether")
        self.assertIn("Romania",rows[0]["countries"])
        self.assertTrue(all(row["remote"] for row in rows))

    def test_efinancialcareers_public_route(self):
        html='''<a href="/jobs-Romania-Bucharest-Technical_Business_Analyst__Project_Manager.id24278261">
          Technical Business Analyst & Project Manager
        </a> London Stock Exchange Group Bucharest Romania Permanent 3 days ago'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://www.efinancialcareers.com/jobs/project-manager/in-europe",
                "eFinancialCareers",
                r"/jobs-[^?#]+\.id\d+",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Technical Business Analyst & Project Manager")
        self.assertIn("Romania",rows[0]["countries"])

    def test_upwork_public_project_management_route(self):
        html='''<a href="/freelance-jobs/apply/Project-Manager_~022106063606007628224/">
          Project Manager
        </a> Worldwide Remote 3-6 months Intermediate'''
        with patch.object(boards,"_fetch",return_value=(200,"text/html",html.encode())):
            rows=boards._linked_job_board(
                "https://www.upwork.com/freelance-jobs/project-management/",
                "Upwork",
                r"/freelance-jobs/apply/[^/?#]+_~\d+/",
            )
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["job_title"],"Project Manager")
        self.assertTrue(rows[0]["remote"])

    def test_supported_sources_are_explicit(self):
        for name in ["EURES","Remote OK","Himalayas","Working Nomads","Jobgether",
                     "Landing.Jobs","We Work Remotely","NoDesk","EU Remote Jobs","Remote in Europe",
                     "EU Careers / EPSO","Remote.co","Remotive","Atos","Worldline","NATO Careers","UpcoMinds",
                     "EuroBrussels","Societe Generale","SoftServe","EPAM","Orange Romania","Mantu","Serco Europe",
                     "Next Ventures","Hays Romania","Square One Resources","Proactive.IT","PowerToFly","Wellfound",
                     "SkipTheDrive","Prohuman","Source Group International","GitHub","Brains Consulting","Montreal Associates","eJobs","Trasys International","DailyRemote","Jobspresso","awork.ro","Freelancer.com"]:
            self.assertTrue(boards.source_supported(name))
        self.assertFalse(boards.source_supported("Unknown Board"))


if __name__ == "__main__":
    unittest.main()
