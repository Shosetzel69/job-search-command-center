"""Bounded public HTTP transport with pinned DNS and per-origin robots rules."""

import http.client
import ipaddress
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, urlunsplit, urljoin
from urllib.robotparser import RobotFileParser

USER_AGENT = "JobSearchCollector/1.0"
MAX_BYTES = 2 * 1024 * 1024
HOST_LOCKS = {}
HOST_LAST = {}
LOCK = threading.Lock()


class FetchError(Exception):
    def __init__(self, message, kind="error"):
        super().__init__(message)
        self.kind = kind


def public_url(url):
    try:
        value = urlsplit(url)
        if value.scheme not in {"https", "http"} or not value.hostname:
            raise ValueError("HTTP(S) URL required")
        if value.username or value.password or value.port not in {None, 80 if value.scheme == "http" else 443}:
            raise ValueError("Credentials and nonstandard ports are forbidden")
        if any(ord(char) < 32 for char in url) or "\\" in url:
            raise ValueError("Invalid URL characters")
        host = value.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError("Non-public host")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address and not address.is_global:
            raise ValueError("Non-public IP")
        host_text = f"[{host}]" if ":" in host else host
        return urlunsplit((value.scheme, host_text, value.path or "/", value.query, ""))
    except (ValueError, UnicodeError) as exc:
        raise FetchError(str(exc), "blocked") from exc


def public_addresses(host, port):
    addresses = list(dict.fromkeys(info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise FetchError("DNS resolved to non-public address", "blocked")
    return addresses


class PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host, address, port, timeout, secure):
        super().__init__(host, port, timeout=timeout)
        self.address, self.secure = address, secure

    def connect(self):
        self.sock = socket.create_connection((self.address, self.port), self.timeout)
        if self.secure:
            # TLS still validates the original hostname, while TCP uses only the checked IP.
            self.sock = ssl.create_default_context().wrap_socket(self.sock, server_hostname=self.host)


def request_once(url, deadline, delay=0.5):
    url = public_url(url)
    parsed = urlsplit(url)
    host, port = parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = public_addresses(host, port)
    with LOCK:
        gate = HOST_LOCKS.setdefault(host, threading.Lock())
    remaining = deadline - time.monotonic()
    if remaining <= 0 or not gate.acquire(timeout=remaining):
        raise FetchError("Source time budget exhausted", "partial")
    try:
        pause = max(0, delay - (time.monotonic() - HOST_LAST.get(host, 0)))
        if time.monotonic() + pause >= deadline:
            raise FetchError("Source time budget exhausted", "partial")
        time.sleep(pause)
        HOST_LAST[host] = time.monotonic()
        connection = PinnedHTTP(host, addresses[0], port, min(8, max(0.1, deadline - time.monotonic())), parsed.scheme == "https")
        try:
            connection.request("GET", urlunsplit(("", "", parsed.path or "/", parsed.query, "")),
                               headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/json,text/plain", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            headers = {key.lower(): value for key, value in response.getheaders()}
            chunks, length = [], 0
            while True:
                if time.monotonic() >= deadline:
                    raise FetchError("Source time budget exhausted", "partial")
                if connection.sock:
                    connection.sock.settimeout(min(8, max(0.1, deadline - time.monotonic())))
                chunk = response.read1(65536)
                if not chunk:
                    break
                length += len(chunk)
                if length > MAX_BYTES:
                    raise FetchError("Page exceeds 2 MiB limit", "partial")
                chunks.append(chunk)
            return response.status, headers, b"".join(chunks)
        finally:
            connection.close()
    except (OSError, http.client.HTTPException) as exc:
        raise FetchError(type(exc).__name__ + ": " + str(exc)) from exc
    finally:
        gate.release()


class PublicClient:
    def __init__(self, deadline):
        self.deadline = deadline
        self.robots = {}

    def policy(self, url):
        parsed = urlsplit(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self.robots:
            robots_url = origin + "/robots.txt"
            # Robots redirects use the same public-IP validation as page requests.
            for _ in range(4):
                status, headers, body = request_once(robots_url, self.deadline)
                if status not in {301, 302, 303, 307, 308}:
                    break
                target = public_url(urljoin(robots_url, headers.get("location", "")))
                robots_url = target
            parser = RobotFileParser()
            if status in {404, 410}:
                parser.parse([])
            elif status == 200:
                if b"<html" in body[:500].lower() or b"<!doctype" in body[:500].lower():
                    raise FetchError("robots.txt returned HTML instead of rules", "blocked")
                parser.parse(body.decode("utf-8", errors="replace").splitlines())
            else:
                raise FetchError(f"robots.txt HTTP {status}; access not established", "blocked")
            self.robots[origin] = parser
        parser = self.robots[origin]
        if not parser.can_fetch(USER_AGENT, url):
            raise FetchError("Disallowed by robots.txt", "blocked")
        delay = parser.crawl_delay(USER_AGENT) or 0
        rate = parser.request_rate(USER_AGENT)
        return max(0.5, delay, rate.seconds / rate.requests if rate and rate.requests else 0)

    def get(self, url):
        url = public_url(url)
        for _ in range(6):
            delay = self.policy(url)
            status, headers, body = request_once(url, self.deadline, delay)
            if status in {301, 302, 303, 307, 308}:
                if not headers.get("location"):
                    raise FetchError("Redirect without location")
                url = public_url(urljoin(url, headers["location"]))
                continue
            if status != 200:
                raise FetchError(f"HTTP {status}", "blocked" if status in {401, 403, 429} else "error")
            kind = headers.get("content-type", "").lower()
            if kind and not any(token in kind for token in ("html", "json", "text/plain")):
                raise FetchError("Unsupported page content type: " + kind, "unsupported")
            return url, body.decode("utf-8", errors="replace")
        raise FetchError("Too many redirects", "blocked")
