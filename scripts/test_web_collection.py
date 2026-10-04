import copy
import json
import socket
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import job_search as engine
import job_search_web as web
import source_orchestration as orchestration
import web_transport as transport

NOW = datetime(2026, 9, 6, 16, tzinfo=timezone.utc)
SOURCE = {"name": "Example careers", "url": "https://example.com/careers", "id": "example"}
JOB = {"@type": "JobPosting", "title": "IT Project Manager", "hiringOrganization": {"name": "Example"},
       "description": "<p>Delivery &amp; governance.</p>", "datePosted": NOW.isoformat(),
       "url": "https://example.com/jobs/123", "jobLocationType": "TELECOMMUTE",
       "applicantLocationRequirements": {"@type": "Country", "name": "Romania"}}


def html(node):
    return '<script type="application/ld+json">' + json.dumps(node) + '</script>'


class FakeClient:
    def __init__(self, pages):
        self.pages, self.called = pages, []
        self.last_status = None
        self.last_robots_status = 200
        self.last_url = None

    def policy(self, url):
        return 0.5

    def get(self, url):
        self.called.append(url)
        value = self.pages.get(url, transport.FetchError("HTTP 404", status_code=404, requested_url=url, final_url=url))
        if isinstance(value, Exception):
            raise value
        self.last_status = 200
        self.last_url = url
        return url, value


class WebTests(unittest.TestCase):
    def test_null_html_attributes_do_not_abort_collection(self):
        page = web.Page('<script type></script><a rel href="/jobs/1">PM</a><link rel href="/jobs">')
        self.assertEqual(len(page.links), 1)

    def test_list_addresses_and_organizations_are_normalized(self):
        job = {**JOB, "jobLocationType": None, "hiringOrganization": [{"name": "Example"}],
               "jobLocation": {"address": [{"addressCountry": "RO", "addressLocality": "Bucharest"}]}}
        record = web.normalize(job, SOURCE["url"], SOURCE, NOW)
        self.assertEqual(record["company"], "Example")
        self.assertEqual(record["country_codes"], ["RO"])

    def test_embedded_login_form_does_not_block_public_career_links(self):
        client = FakeClient({SOURCE["url"]: '<input type="password"><a href="/jobs/123">Project Manager</a>', JOB["url"]: html(JOB)})
        results, details = web.collect(SOURCE, {}, NOW, client)
        self.assertEqual(details["web_outcome"], "extracted")
        self.assertTrue(any(result.records for result in results))

    def setUp(self):
        self.network = patch("socket.create_connection", side_effect=AssertionError("Tests must not access network"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_follows_career_detail_and_pagination(self):
        second = {**JOB, "url": "https://example.com/jobs/456", "identifier": "456"}
        client = FakeClient({SOURCE["url"]: '<a href="/jobs/123">IT Project Manager</a><a rel="next" href="/careers?page=2">Next</a>',
                             JOB["url"]: html(JOB), "https://example.com/careers?page=2": html(second),
                             second["url"]: html(second)})
        results, details = web.collect(SOURCE, {}, NOW, client)
        records = [record for result in results if result.ok for record in result.records]
        self.assertEqual(len(records), 2)
        self.assertIn("https://example.com/careers?page=2", client.called)
        self.assertEqual(records[0]["description"], "Delivery & governance.")
        self.assertEqual(records[0]["country_codes"], ["RO"])
        self.assertEqual(details["web_outcome"], "extracted")
        self.assertFalse(details["coverage_complete"])

    def test_plain_homepage_is_not_successful_collection(self):
        results, details = web.collect(SOURCE, {}, NOW, FakeClient({SOURCE["url"]: "<h1>Welcome</h1>"}))
        self.assertFalse(any(result.ok for result in results))
        self.assertEqual(details["web_outcome"], "no_extractable_jobs")
        self.assertEqual(details["collection_method"], "http")

    def test_browser_fallback_renders_dynamic_page_once(self):
        client = FakeClient({SOURCE["url"]: '<div id="root"></div><script src="/app.js"></script>'})
        with patch.object(web.browser, "render", return_value=(SOURCE["url"], html(JOB), {"browser_status": "rendered"})) as render:
            results, details = web.collect(SOURCE, {}, NOW, client)
        records = [record for result in results if result.ok for record in result.records]
        self.assertEqual(len(records), 1)
        render.assert_called_once()
        self.assertTrue(details["browser_attempted"])
        self.assertEqual(details["browser_status"], "rendered")
        self.assertEqual(details["collection_method"], "http+browser")
        self.assertEqual(details["requested_url"], SOURCE["url"])
        self.assertEqual(details["http_status"], 200)

    def test_browser_fallback_never_runs_after_access_block(self):
        client = FakeClient({SOURCE["url"]: transport.FetchError("Disallowed by robots.txt", "blocked")})
        with patch.object(web.browser, "render") as render:
            _, details = web.collect(SOURCE, {}, NOW, client)
        render.assert_not_called()
        self.assertEqual(details["web_outcome"], "blocked")
        self.assertFalse(details["browser_attempted"])

    def test_jsonld_graph_nested_item_and_multiple_types(self):
        job = {**JOB, "@type": ["Thing", "https://schema.org/JobPosting"]}
        page = web.Page(html({"@graph": [{"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "item": job}]}]}))
        postings = [node for doc in page.documents for node in web.objects(doc) if web.is_type(node, "JobPosting")]
        self.assertEqual(len(postings), 1)

    def test_partial_collection_preserves_records_and_error(self):
        client = FakeClient({SOURCE["url"]: html(JOB) + '<a href="/jobs/unavailable">Project Manager</a>', JOB["url"]: html(JOB)})
        results, details = web.collect(SOURCE, {}, NOW, client)
        self.assertTrue(any(result.ok and result.records for result in results))
        self.assertTrue(any(not result.ok for result in results))
        self.assertEqual(details["web_outcome"], "partial")

    def test_page_budget_is_explicit_not_full_coverage(self):
        client = FakeClient({SOURCE["url"]: html(JOB)})
        with patch.object(web, "MAX_PAGES", 1):
            results, details = web.collect(SOURCE, {}, NOW, client)
        self.assertEqual(details["web_outcome"], "extracted")
        self.assertTrue(any(result.ok and result.records for result in results))
        self.assertFalse(details["coverage_complete"])
        self.assertFalse(details["discovered_pages_complete"])
        self.assertIsNone(details["failure_reason"])
        self.assertIn("bounded crawl limit reached", details["limitations"][0])

    def test_tracking_handoff_links_are_not_crawled(self):
        roots = {"eurobrussels.com"}
        self.assertIsNone(web.candidate(
            {"url": "/job/track_click?job_id=296271&url_count=1", "text": "Apply now"},
            "https://www.eurobrussels.com/job/296271",
            roots,
        ))

    def test_expired_missing_and_malformed_records(self):
        expired = {**JOB, "validThrough": "2020-01-01"}
        self.assertIsNone(web.normalize(expired, SOURCE["url"], SOURCE, NOW))
        with self.assertRaises(ValueError):
            web.normalize({"title": "Jobs"}, SOURCE["url"], SOURCE, NOW)
        results, details = web.collect(SOURCE, {}, NOW, FakeClient({SOURCE["url"]: '<script type="application/ld+json">{bad}</script>'}))
        self.assertEqual(details["web_outcome"], "no_extractable_jobs")
        self.assertFalse(results[0].ok)

    def test_no_date_is_not_invented_or_published_as_fresh(self):
        job = {**JOB, "datePosted": None}
        record = web.normalize(job, SOURCE["url"], SOURCE, NOW)
        self.assertIsNone(record["date_posted"])
        result = engine.process_records({}, [engine.CollectionResult("web:example", "q", True, [record], 1)], NOW)
        self.assertEqual(result["results"], 0)
        self.assertEqual(result["excluded_sample"][0]["reason"], "web publication date unavailable")

    def test_applicant_territory_overrides_office_location(self):
        job = {**JOB, "jobLocation": {"address": {"addressCountry": "US", "addressLocality": "New York"}}}
        record = web.normalize(job, SOURCE["url"], SOURCE, NOW)
        self.assertTrue(engine.normalize_job_geography(record, True)[3])
        job["applicantLocationRequirements"] = {"name": "Canada"}
        record = web.normalize(job, SOURCE["url"], SOURCE, NOW)
        self.assertFalse(engine.normalize_job_geography(record, True)[3])

    def test_captcha_and_robots_are_blocked_without_bypass(self):
        for page in [transport.FetchError("Disallowed by robots.txt", "blocked"), "<title>Just a moment...</title>"]:
            results, details = web.collect(SOURCE, {}, NOW, FakeClient({SOURCE["url"]: page}))
            self.assertEqual(details["web_outcome"], "blocked")
            self.assertFalse(any(result.ok for result in results))

    def test_links_remain_in_scope_and_ats_links_can_be_followed(self):
        roots = {"example.com"}
        self.assertIsNone(web.candidate({"url": "https://unrelated.example/jobs", "text": "jobs"}, SOURCE["url"], roots))
        self.assertIsNotNone(web.candidate({"url": "https://boards.greenhouse.io/example", "text": "careers"}, SOURCE["url"], roots))
        self.assertIsNone(web.candidate({"url": "https://boards.greenhouse.io.evil.example/jobs", "text": "jobs"}, SOURCE["url"], roots))

    def test_non_job_navigation_is_not_crawled(self):
        roots = {"example.com"}
        for path in ("/pricing", "/products/post-a-job", "/resources/job-descriptions", "/webinars/latest", "/status/history", "/career-advice"):
            self.assertIsNone(web.candidate({"url": path, "text": "jobs and careers"}, SOURCE["url"], roots), path)
        self.assertIsNotNone(web.candidate({"url": "/careers/project-manager", "text": "Project Manager"}, SOURCE["url"], roots))

    def test_all_web_sources_are_scheduled_individually(self):
        catalog = {"sources": [{"name": f"Source {i}", "url": f"https://site{i}.example/jobs"} for i in range(6)]}
        plan = orchestration.build_plan(catalog)
        self.assertEqual([item["connector"] for item in plan], ["web"] * 6)

        def collect(source, config, now):
            return [engine.CollectionResult("web:" + source["id"], "q", True, [], 0)], {"web_outcome": "no_active_jobs"}

        with patch.object(orchestration.web, "collect", side_effect=collect) as collector:
            results, _, _ = orchestration.collect_sources({"jobspipe_mode": "disabled"}, {}, NOW, plan)
        self.assertEqual(collector.call_count, 6)
        self.assertEqual(len(results), 6)
        self.assertTrue(all(item["status"] == "completed" for item in plan))


class TransportTests(unittest.TestCase):
    def test_robots_wildcard_end_anchor_and_longest_allow(self):
        policy = transport.RobotsPolicy()
        policy.parse(['User-agent: *', 'Disallow: /*?private=', 'Disallow: /jobs/*/apply$',
                      'Allow: /jobs/public/apply'])
        self.assertFalse(policy.can_fetch(transport.USER_AGENT, 'https://example.com/jobs/1/apply'))
        self.assertTrue(policy.can_fetch(transport.USER_AGENT, 'https://example.com/jobs/1/apply/info'))
        self.assertTrue(policy.can_fetch(transport.USER_AGENT, 'https://example.com/jobs/public/apply'))
        self.assertFalse(policy.can_fetch(transport.USER_AGENT, 'https://example.com/jobs?private=1'))

    def test_specific_agent_groups_combine_without_using_wildcard_group(self):
        policy = transport.RobotsPolicy()
        policy.parse(['User-agent: *', 'Disallow: /', '', 'User-agent: JobSearchCollector',
                      'Disallow: /private', '', 'User-agent: JobSearchCollector', 'Disallow: /secret'])
        self.assertTrue(policy.can_fetch(transport.USER_AGENT, 'https://example.com/jobs'))
        self.assertFalse(policy.can_fetch(transport.USER_AGENT, 'https://example.com/private'))
        self.assertFalse(policy.can_fetch(transport.USER_AGENT, 'https://example.com/secret'))

    def test_unsafe_url_and_dns_addresses_are_rejected(self):
        for url in ("http://127.0.0.1/", "http://169.254.169.254/latest", "https://localhost/", "http://[::1]/", "https://user:pass@example.com/", "file:///etc/passwd", "https://example.com:8080/"):
            with self.assertRaises(transport.FetchError):
                transport.public_url(url)
        for address in ("10.1.2.3", "127.0.0.1", "169.254.169.254", "::1"):
            with patch.object(socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]):
                with self.assertRaises(transport.FetchError):
                    transport.public_addresses("example.com", 443)

    def test_redirect_to_private_address_is_never_requested(self):
        client = transport.PublicClient(time.monotonic() + 30)
        with patch.object(client, "policy", return_value=0.5), patch.object(transport, "request_once", return_value=(302, {"location": "http://127.0.0.1/"}, b"")) as request:
            with self.assertRaises(transport.FetchError):
                client.get("https://example.com/")
            self.assertEqual(request.call_count, 1)

    def test_robots_disallow_prevents_page_request(self):
        client = transport.PublicClient(time.monotonic() + 30)
        with patch.object(transport, "request_once", return_value=(200, {}, b"User-agent: *\nDisallow: /private\n")) as request:
            with self.assertRaises(transport.FetchError):
                client.get("https://example.com/private/jobs")
            self.assertEqual(request.call_count, 1)
            self.assertTrue(request.call_args[0][0].endswith("robots.txt"))

    def test_missing_robots_allows_and_target_redirect_checks_new_robots(self):
        client = transport.PublicClient(time.monotonic() + 30)
        values = [(404, {}, b""), (302, {"location": "https://careers.example.com/jobs"}, b""),
                  (200, {}, b"User-agent: *\nDisallow: /" )]
        with patch.object(transport, "request_once", side_effect=values) as request:
            with self.assertRaises(transport.FetchError):
                client.get("https://example.com/jobs")
            self.assertEqual(request.call_count, 3)
            self.assertEqual(request.call_args[0][0], "https://careers.example.com/robots.txt")

    def test_http_error_keeps_diagnostic_status_and_urls(self):
        client = transport.PublicClient(time.monotonic() + 30)
        with patch.object(client, "policy", return_value=0.5), patch.object(transport, "request_once", return_value=(403, {}, b"")):
            with self.assertRaises(transport.FetchError) as caught:
                client.get("https://example.com/jobs")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.requested_url, "https://example.com/jobs")
        self.assertEqual(caught.exception.final_url, "https://example.com/jobs")
        self.assertEqual(client.last_status, 403)

    def test_tcp_uses_validated_ip_and_tls_uses_original_hostname(self):
        sock, context = MagicMock(), MagicMock()
        with patch.object(socket, "create_connection", return_value=sock) as connect, patch.object(transport.ssl, "create_default_context", return_value=context):
            connection = transport.PinnedHTTP("example.com", "93.184.216.34", 443, 8, True)
            connection.connect()
            connect.assert_called_once_with(("93.184.216.34", 443), 8)
            context.wrap_socket.assert_called_once_with(sock, server_hostname="example.com")

    def test_body_limit_is_enforced(self):
        connection = MagicMock()
        response = connection.getresponse.return_value
        response.getheaders.return_value = [("Content-Type", "text/html")]
        response.read1.return_value = b"12345"
        with patch.object(transport, "public_addresses", return_value=["93.184.216.34"]), patch.object(transport, "PinnedHTTP", return_value=connection), patch.object(transport, "MAX_BYTES", 4):
            with self.assertRaises(transport.FetchError):
                transport.request_once("https://example.com/", time.monotonic() + 30, delay=0)
            connection.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
