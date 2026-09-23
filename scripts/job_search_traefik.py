"""Bounded Traefik Labs careers collector.

This is an explicit source-specific exception. It reuses the hardened public
web transport for DNS, robots, redirects, content-size and time-budget safety.
"""

import re
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import job_search as engine
import web_transport as transport

CAREERS_URL = "https://traefik.io/careers"
ALLOWED_HOSTS = {"traefik.io", "www.traefik.io"}
JOB_PATH = re.compile(r"^/careers/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/?$", re.I)
MAX_POSTINGS = 50
TIME_BUDGET_SECONDS = 60


class CareersLinks(HTMLParser):
    def __init__(self, base_url):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        href = next((value for key, value in attrs if key.lower() == "href"), None)
        if not href:
            return
        candidate = urljoin(self.base_url, href)
        parsed = urlsplit(candidate)
        if parsed.scheme != "https" or (parsed.hostname or "").lower() not in ALLOWED_HOSTS:
            return
        match = JOB_PATH.fullmatch(parsed.path or "")
        if not match:
            return
        canonical = f"https://traefik.io/careers/{match.group(1).lower()}"
        if canonical not in self.links:
            self.links.append(canonical)


class JobDetail(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_h1 = False
        self.title_parts = []
        self.after_h1 = False
        self.stopped = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "footer":
            self.stopped = True
        elif tag == "h1" and not self.title_parts:
            self.in_h1 = True

    def handle_endtag(self, tag):
        if tag.lower() == "h1" and self.in_h1:
            self.in_h1 = False
            self.after_h1 = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        if self.in_h1:
            self.title_parts.append(text)
        elif self.after_h1 and not self.stopped:
            self.parts.append(text)

    @property
    def title(self):
        return " ".join(self.title_parts).strip()

    @property
    def description(self):
        return " ".join(self.parts).strip()


def _validate_root(url):
    parsed = urlsplit(transport.public_url(url))
    host = (parsed.hostname or "").lower()
    path = (parsed.path or "/").rstrip("/")
    if parsed.scheme != "https" or host not in ALLOWED_HOSTS or path != "/careers":
        raise ValueError("Traefik careers URL is outside the bounded collector scope")
    return CAREERS_URL


def _job_record(url, html, company_name):
    parsed = urlsplit(url)
    match = JOB_PATH.fullmatch(parsed.path or "")
    if not match:
        raise ValueError("Traefik job URL is outside the bounded collector scope")
    parser = JobDetail()
    parser.feed(html)
    if not parser.title:
        raise ValueError("Malformed Traefik job page: missing h1 title")

    description = parser.description
    remote = bool(re.search(r"\bremote\b", description, re.I))
    hybrid = bool(re.search(r"\bhybrid\b", description, re.I))
    location = "Remote" if remote and not hybrid else ("Hybrid" if hybrid else "")
    return {
        "id": f"traefik:{match.group(1).lower()}",
        "job_title": parser.title,
        "company": company_name,
        "description": description,
        "location": location,
        "countries": [],
        "remote": remote,
        "work_arrangement": "hybrid" if hybrid else ("remote" if remote else "onsite"),
        "employment_statuses": [],
        "date_posted": None,
        "source_url": url,
        "sources": [{"provider": "Traefik careers", "slug": match.group(1).lower()}],
    }


def collect(careers_url=CAREERS_URL, company_name="Traefik Labs", max_postings=MAX_POSTINGS, client=None):
    careers_url = _validate_root(careers_url)
    company_name = str(company_name or "").strip()
    if not company_name:
        raise ValueError("Traefik company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    client = client or transport.PublicClient(time.monotonic() + TIME_BUDGET_SECONDS)
    final_url, landing_html = client.get(careers_url)
    landing = CareersLinks(final_url)
    landing.feed(landing_html)

    records = []
    for job_url in landing.links[:max_postings]:
        final_job_url, detail_html = client.get(job_url)
        parsed = urlsplit(final_job_url)
        if parsed.scheme != "https" or (parsed.hostname or "").lower() not in ALLOWED_HOSTS:
            raise ValueError("Traefik job redirect left the bounded collector scope")
        records.append(_job_record(final_job_url, detail_html, company_name))

    return [engine.CollectionResult(
        "traefik:careers", "bounded_careers", True, records, len(landing.links)
    )]
