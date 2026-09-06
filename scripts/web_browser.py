"""Bounded browser rendering fallback for public career pages.

The browser is a rendering aid, not an access-control bypass. Initial and final
navigation remain subject to the same public-URL and robots policy as the HTTP
collector, and browser requests are restricted to the source site.
"""

import time
from threading import BoundedSemaphore
from urllib.parse import urlsplit

from web_transport import FetchError, public_addresses, public_url

MAX_RENDER_SECONDS = 8
BROWSER_SLOTS = BoundedSemaphore(2)
ALLOWED_RESOURCE_TYPES = {"document", "script", "stylesheet", "xhr", "fetch"}


def _site_root(host):
    host = (host or "").lower()
    for prefix in ("www.", "jobs.", "careers.", "career."):
        if host.startswith(prefix):
            return host[len(prefix):]
    return host


def _in_scope(host, roots):
    host = (host or "").lower()
    return any(host == root or host.endswith("." + root) for root in roots)


def _validate_target(url, roots):
    url = public_url(url)
    parsed = urlsplit(url)
    if not _in_scope(parsed.hostname, roots):
        raise FetchError("Browser request left source scope", "blocked", requested_url=url, final_url=url)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    public_addresses(parsed.hostname, port)
    return url


def render(url, deadline, client, roots=None):
    """Render one allowed source page and return its post-JavaScript HTML."""
    requested = public_url(url)
    parsed = urlsplit(requested)
    scope = set(roots or ())
    scope.add(_site_root(parsed.hostname))

    # Reuse the collector's robots policy before Chromium is allowed to navigate.
    client.policy(requested)
    remaining = deadline - time.monotonic()
    if remaining <= 1:
        raise FetchError("Source time budget exhausted before browser fallback", "partial", requested_url=requested)
    if not BROWSER_SLOTS.acquire(timeout=max(0.1, remaining - 1)):
        raise FetchError("Browser fallback capacity exhausted", "partial", requested_url=requested)

    started = time.monotonic()
    try:
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise FetchError("Playwright browser fallback unavailable", "error", requested_url=requested) from exc

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
                try:
                    context = browser.new_context()
                    page = context.new_page()

                    def guard(route, request):
                        try:
                            if request.resource_type not in ALLOWED_RESOURCE_TYPES:
                                route.abort("blockedbyclient")
                                return
                            target = _validate_target(request.url, scope)
                            if request.resource_type in {"document", "xhr", "fetch"}:
                                client.policy(target)
                            route.continue_()
                        except (FetchError, ValueError, OSError):
                            route.abort("blockedbyclient")

                    page.route("**/*", guard)
                    timeout_ms = int(min(MAX_RENDER_SECONDS, max(1, deadline - time.monotonic())) * 1000)
                    response = page.goto(requested, wait_until="domcontentloaded", timeout=timeout_ms)
                    if response and response.status in {401, 403, 429}:
                        raise FetchError(
                            f"Browser HTTP {response.status}", "blocked", status_code=response.status,
                            requested_url=requested, final_url=page.url,
                        )
                    if time.monotonic() < deadline:
                        page.wait_for_timeout(min(1200, max(0, int((deadline - time.monotonic()) * 1000))))
                    final_url = _validate_target(page.url, scope)
                    client.policy(final_url)
                    html = page.content()
                    return final_url, html, {
                        "browser_status": "rendered",
                        "browser_http_status": response.status if response else None,
                        "browser_elapsed_ms": int((time.monotonic() - started) * 1000),
                    }
                finally:
                    browser.close()
        except PlaywrightTimeoutError as exc:
            raise FetchError("Browser render timeout", "partial", requested_url=requested) from exc
        except PlaywrightError as exc:
            raise FetchError("Browser render failed: " + str(exc), "error", requested_url=requested) from exc
    finally:
        BROWSER_SLOTS.release()
