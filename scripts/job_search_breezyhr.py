"""BreezyHR public careers JSON adapter."""

import hashlib
import json
import re
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000
TENANT = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", re.I)


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value):
    parser = PlainText()
    parser.feed(str(value or ""))
    return " ".join(part.strip() for part in parser.parts if part.strip())


def _request_json(url, opener=urlopen):
    request = Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "job-search-command-center/1.0",
    })
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("BreezyHR response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, list):
        raise ValueError("BreezyHR response must be a JSON array")
    return payload


def _country(value):
    if isinstance(value, dict):
        value = value.get("name") or value.get("code")
    text = str(value or "").strip()
    if not text:
        return None
    code = engine.COUNTRY_NAME_TO_CODE.get(text.lower())
    if code:
        return engine.COUNTRY_NAMES.get(code, text)
    if len(text) == 2:
        return engine.COUNTRY_NAMES.get(text.upper(), text.upper())
    return text


def _location(item):
    raw = item.get("location")
    if isinstance(raw, str):
        label = raw.strip()
        return label, [], bool(re.search(r"\bremote\b", label, re.I))
    if not isinstance(raw, dict):
        return "", [], False

    label = str(raw.get("name") or "").strip()
    if not label:
        parts = [raw.get("city"), raw.get("state")]
        country = _country(raw.get("country"))
        if country:
            parts.append(country)
        label = ", ".join(str(value).strip() for value in parts if str(value or "").strip())
    country = _country(raw.get("country"))
    countries = [country] if country else []
    remote = bool(raw.get("is_remote") or raw.get("remote") or re.search(r"\bremote\b", label, re.I))
    return label, countries, remote


def _stable_id(item, source_url):
    posting_id = item.get("_id") or item.get("id")
    if posting_id:
        return str(posting_id)
    path = urlsplit(str(source_url)).path.rstrip("/")
    match = re.search(r"/p/([^/]+)$", path)
    if match:
        return match.group(1)
    return hashlib.sha256(str(source_url).encode("utf-8")).hexdigest()[:24]


def normalize(item, tenant, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed BreezyHR posting")
    title = item.get("name") or item.get("title")
    source_url = item.get("url")
    if not title or not source_url or not company_name:
        raise ValueError("Malformed BreezyHR posting: missing title/url/company")

    parsed = urlsplit(str(source_url))
    if parsed.scheme != "https" or parsed.hostname not in {f"{tenant}.breezy.hr", "breezy.hr", "www.breezy.hr"}:
        raise ValueError("Malformed BreezyHR posting: unexpected job URL")

    posting_id = _stable_id(item, source_url)
    location, countries, remote = _location(item)
    workplace = str(item.get("workplace_type") or item.get("workplaceType") or "").strip().lower()
    if workplace == "remote":
        remote = True
    arrangement = "hybrid" if workplace == "hybrid" or "hybrid" in location.lower() else ("remote" if remote else "onsite")
    department = item.get("department")
    if isinstance(department, dict):
        department = department.get("name") or department.get("label")

    return {
        "id": f"breezyhr:{tenant}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": plain_text(item.get("description") or item.get("description_html") or item.get("descriptionHtml")),
        "location": location,
        "countries": countries,
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(
            item.get("type") or item.get("employment_type") or item.get("employmentType")
        ),
        "date_posted": item.get("published_date") or item.get("publishedAt") or item.get("created_at"),
        "source_url": str(source_url),
        "sources": [{"provider": "BreezyHR", "tenant": tenant}],
        "department": department,
    }


def collect(tenant, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    tenant = str(tenant or "").strip().lower()
    company_name = str(company_name or "").strip()
    if not TENANT.fullmatch(tenant):
        raise ValueError("BreezyHR tenant is invalid")
    if not company_name:
        raise ValueError("BreezyHR company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    payload = _request_json(
        f"https://{quote(tenant, safe='')}.breezy.hr/json?verbose=true",
        opener=opener,
    )
    records = [normalize(item, tenant, company_name) for item in payload[:max_postings]]
    return [engine.CollectionResult(
        f"breezyhr:{tenant}", "public_board", True, records, len(payload)
    )]
