"""Chromium DOM rendering with no direct browser network access."""

import json
import sys
import time

from web_transport import FetchError, MAX_BYTES, PublicClient, USER_AGENT, public_url

MAX_REQUESTS = 60
MAX_TOTAL_BYTES = 8 * 1024 * 1024
ALLOWED_TYPES = {"document", "script", "stylesheet", "xhr", "fetch"}


class ResourceRouter:
    def __init__(self, client, url, html):
        self.client, self.url, self.html = client, url, html
        self.requests, self.total_bytes = 0, len(html.encode())
        self.errors = []
        self.seeded = False

    def handle(self, route):
        request = route.request
        try:
            target = public_url(request.url)
            if request.method != "GET":
                raise FetchError("Browser non-GET request blocked", "blocked")
            if request.resource_type not in ALLOWED_TYPES:
                route.abort()
                return
            self.requests += 1
            if self.requests > MAX_REQUESTS or time.monotonic() >= self.client.deadline:
                raise FetchError("Browser request/time budget reached", "partial")
            if target == self.url and not self.seeded:
                self.seeded = True
                route.fulfill(status=200, content_type="text/html", body=self.html)
                return
            final_url, headers, body = self.client.get_resource(target)
            self.total_bytes += len(body)
            if self.total_bytes > MAX_TOTAL_BYTES:
                raise FetchError("Browser total resource size exceeded", "partial")
            if final_url != target:
                # Preserve the final origin and relative asset base in Chromium.
                route.fulfill(status=302, headers={"location": final_url}, body="")
            else:
                allowed_headers = {key: value for key, value in headers.items()
                                   if key in {"content-type", "access-control-allow-origin", "content-security-policy"}}
                route.fulfill(status=200, headers=allowed_headers, body=body)
        except (FetchError, OSError, ValueError) as exc:
            if len(self.errors) < MAX_REQUESTS:
                self.errors.append({"url": request.url, "error": str(exc), "status": getattr(exc, "kind", "error")})
            route.abort()


def render_page(payload, client=None):
    from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout

    url = public_url(payload["url"])
    deadline = time.monotonic() + min(20, float(payload["seconds"]))
    client = client or PublicClient(deadline)
    # Recheck navigation policy; the supplied HTML only comes from a successful HTTP fetch.
    client.policy(url)
    router = ResourceRouter(client, url, payload["html"])
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, timeout=max(1, (deadline - time.monotonic()) * 1000),
            proxy={"server": "http://127.0.0.1:9", "bypass": "<-loopback>"},
            args=["--disable-background-networking", "--disable-quic", "--disable-dev-shm-usage",
                  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
        )
        try:
            context = browser.new_context(service_workers="block", accept_downloads=False, user_agent=USER_AGENT)
            context.route("**/*", router.handle)
            context.route_web_socket("**/*", lambda socket: socket.close())
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=max(1, (deadline - time.monotonic()) * 1000))
            # Give asynchronous job lists a bounded opportunity to populate the DOM.
            try:
                page.wait_for_function(
                    """() => [...document.querySelectorAll('script[type="application/ld+json"]')]
                    .some(s => s.textContent.includes('JobPosting'))""",
                    timeout=max(1, min(5000, (deadline - time.monotonic() - 1) * 1000)),
                )
            except BrowserTimeout:
                pass  # A rendered career list can still supply links without JSON-LD.
            html = page.content()
            if len(html.encode()) > MAX_BYTES:
                raise FetchError("Rendered page exceeds 2 MiB limit", "partial")
            return {"url": public_url(page.url), "html": html, "requests": router.requests, "errors": router.errors}
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        result = render_page(json.loads(sys.stdin.read()))
    except Exception as exc:
        result = {"error": "Browser rendering failed: " + type(exc).__name__ + ": " + str(exc)[:500],
                  "kind": getattr(exc, "kind", "error")}
    print(json.dumps(result))
