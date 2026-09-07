"""Workable public account jobs API adapter."""

import json
import re
from html.parser import HTMLParser
from urllib.parse import quote
from urllib.request import Request, urlopen

import job_search as engine

BASE_URL = "https://www.workable.com/api/accounts"
MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$", re.I)


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
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "job-search-command-center/1.0"})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Workable response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Workable response must be a JSON object")
    return payload


def _country(item):
    code = str(item.get("country_code") or "").strip().upper()
    name = str(item.get("country") or item.get("country_name") or "").strip()
    if code:
        return engine.COUNTRY_NAMES.get(code, name or code)
    mapped = engine.COUNTRY_NAME_TO_CODE.get(name.lower()) if name else None
    return engine.COUNTRY_NAMES.get(mapped, name) if mapped else (name or None)


def normalize(item, subdomain, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Workable posting")
    posting_id = item.get("id") or item.get("shortcode") or item.get("code")
    title = item.get("title")
    source_url = item.get("shortlink") or item.get("url") or item.get("application_url")
    if not posting_id or not title or not source_url or not company_name:
        raise ValueError("Malformed Workable posting: missing id/title/url/company")

    location_obj = item.get("location") if isinstance(item.get("location"), dict) else item
    location = str(location_obj.get("location_str") or "").strip()
    if not location:
        location = ", ".join(str(location_obj.get(key)).strip() for key in ("city", "region", "country") if location_obj.get(key))
    country = _country(location_obj)
    workplace = str(location_obj.get("workplace_type") or item.get("workplace_type") or "").lower()
    remote = bool(location_obj.get("telecommuting") or item.get("telecommuting") or workplace == "remote")
    arrangement = "hybrid" if workplace == "hybrid" else ("remote" if remote else "onsite")

    return {
        "id": f"workable:{subdomain}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": plain_text(item.get("description")),
        "location": location,
        "countries": [country] if country else [],
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(item.get("employment_type")),
        "date_posted": item.get("published_on") or item.get("created_at"),
        "source_url": source_url,
        "sources": [{"provider": "Workable", "subdomain": subdomain}],
        "department": item.get("department"),
    }


def collect(subdomain, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    subdomain = str(subdomain or "").strip().lower()
    company_name = str(company_name or "").strip()
    if not SLUG.fullmatch(subdomain):
        raise ValueError("Workable subdomain is invalid")
    if not company_name:
        raise ValueError("Workable company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")
    payload = _request_json(f"{BASE_URL}/{quote(subdomain, safe='')}?details=true", opener=opener)
    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("Workable response must contain a jobs array")
    records = [normalize(item, subdomain, company_name) for item in jobs[:max_postings]]
    return [engine.CollectionResult(f"workable:{subdomain}", "public_account", True, records, len(jobs))]
