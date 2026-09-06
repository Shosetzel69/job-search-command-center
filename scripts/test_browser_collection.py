import json
import os
import subprocess
import time
import unittest
from unittest.mock import MagicMock, patch

import browser_render
import browser_worker
import job_search_web as web
from test_web_collection import FakeClient, SOURCE, JOB, NOW, html
from web_transport import FetchError, PublicClient


class BrowserTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"WEB_BROWSER_ENABLED": "1"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.network = patch("socket.create_connection", side_effect=AssertionError("No real HTTP in tests"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_dynamic_job_enters_common_collection(self):
        client = FakeClient({SOURCE["url"]: '<script src="/app.js"></script>', JOB["url"]: html(JOB)})
        with patch.object(browser_render, "render", return_value={"url": SOURCE["url"], "html": html(JOB)}) as render:
            results, details = web.collect(SOURCE, {}, NOW, client)
        render.assert_called_once()
        self.assertEqual(details["browser_records"], 1)
        self.assertEqual(details["browser_successes"], 1)
        self.assertTrue(any(r.records for r in results))

    def test_no_browser_for_static_job_or_blocked_source(self):
        for content in (html(JOB), FetchError("Disallowed by robots.txt", "blocked"), '<h1>Careers</h1>'):
            client = FakeClient({SOURCE["url"]: content, JOB["url"]: html(JOB)})
            with patch.object(browser_render, "render") as render:
                web.collect(SOURCE, {}, NOW, client)
            render.assert_not_called()

    def test_timeout_keeps_static_links_and_jobs(self):
        client = FakeClient({SOURCE["url"]: '<script src="app.js"></script><a href="/jobs/123">Project Manager</a>', JOB["url"]: html(JOB)})
        with patch.object(browser_render, "render", side_effect=FetchError("Timed out", "partial")):
            results, details = web.collect(SOURCE, {}, NOW, client)
        self.assertTrue(any(r.records for r in results))
        self.assertEqual(details["web_outcome"], "partial")
        self.assertEqual(details["page_results"][0]["browser"]["error"], "Timed out")

    def test_browser_page_budget(self):
        pages = {SOURCE["url"]: '<script></script><a href="/jobs/a">job</a><a href="/jobs/b">job</a>',
                 "https://example.com/jobs/a": '<script></script>', "https://example.com/jobs/b": '<script></script>'}
        with patch.object(browser_render, "render", side_effect=FetchError("failed")) as render:
            _, details = web.collect(SOURCE, {}, NOW, FakeClient(pages))
        self.assertEqual(render.call_count, 2)
        self.assertEqual(details["browser_attempts"], 2)

    def test_worker_environment_excludes_provider_credentials(self):
        with patch.dict(os.environ, {"JOBSPIPE_API_KEY": "test-placeholder", "APIFY_TOKEN": "test-placeholder", "GITHUB_TOKEN": "test-placeholder"}):
            env = browser_render.safe_environment()
        self.assertFalse(set(env) & {"JOBSPIPE_API_KEY", "APIFY_TOKEN", "GITHUB_TOKEN"})

    def test_subprocess_timeout_kills_process_group(self):
        proc = MagicMock(pid=12345)
        proc.communicate.side_effect = subprocess.TimeoutExpired("worker", 1)
        with patch.object(browser_render.subprocess, "Popen", return_value=proc), patch.object(browser_render.os, "killpg") as kill:
            with self.assertRaisesRegex(FetchError, "timed out"):
                browser_render.render(SOURCE["url"], "", time.monotonic() + 3)
        kill.assert_called_once()
        proc.wait.assert_called_once()

    def route(self, url, method="GET", kind="script"):
        route = MagicMock()
        route.request.url, route.request.method, route.request.resource_type = url, method, kind
        return route

    def test_router_blocks_private_urls_and_non_get(self):
        client = MagicMock(deadline=time.monotonic() + 10)
        router = browser_worker.ResourceRouter(client, SOURCE["url"], "")
        for url, method in [("http://127.0.0.1/", "GET"), ("http://169.254.169.254/", "GET"), ("file:///etc/passwd", "GET"), (SOURCE["url"], "POST")]:
            route = self.route(url, method)
            router.handle(route)
            route.abort.assert_called_once()
        client.get_resource.assert_not_called()

    def test_router_uses_pinned_transport_and_honors_robots(self):
        client = MagicMock(deadline=time.monotonic() + 10)
        client.get_resource.side_effect = FetchError("Disallowed by robots.txt", "blocked")
        router = browser_worker.ResourceRouter(client, SOURCE["url"], "")
        route = self.route("https://example.com/app.js")
        router.handle(route)
        route.abort.assert_called_once()
        route.continue_.assert_not_called()
        self.assertEqual(router.errors[0]["status"], "blocked")

    def test_browser_assets_accept_javascript_after_policy(self):
        client = PublicClient(time.monotonic() + 10)
        with patch.object(client, "policy", return_value=0.5) as policy, patch("web_transport.request_once", return_value=(200, {"content-type": "application/javascript"}, b"let x=1")):
            url, headers, body = client.get_resource("https://example.com/app.js")
        policy.assert_called_once()
        self.assertEqual(body, b"let x=1")

    @unittest.skipUnless(os.environ.get("BROWSER_SMOKE_TEST") == "1", "Chromium fixture runs in CI")
    def test_real_chromium_renders_javascript_with_fake_network(self):
        job_json = json.dumps(JOB)
        fixture = '<html><body><script>setTimeout(() => {const s=document.createElement("script");s.type="application/ld+json";s.textContent=JSON.stringify(' + job_json + ');document.body.appendChild(s)}, 50);</script></body></html>'
        client = MagicMock(deadline=time.monotonic() + 20)
        client.get_resource.side_effect = FetchError("Fixture has no external resources", "blocked")
        rendered = browser_worker.render_page({"url": SOURCE["url"], "html": fixture, "seconds": 20}, client)
        page = web.Page(rendered["html"])
        self.assertTrue(any(web.is_type(n, "JobPosting") for doc in page.documents for n in web.objects(doc)))
        self.assertEqual(rendered["errors"], [])


if __name__ == "__main__":
    unittest.main()
