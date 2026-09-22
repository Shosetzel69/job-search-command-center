"""Pinpoint public Job Postings JSON adapter."""

import json
import re
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000
SUBDOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", re.I)


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
        raise ValueError("Pinpoint response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Pinpoint response must be a JSON object")
    return payload


def _countries(location):
    found = []
    for name, code in engine.COUNTRY_NAME_TO_CODE.items():
        if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", location, re.I):
            canonical = engine.COUNTRY_NAMES.get(code, name.title())
            if canonical not in found:
                found.append(canonical)
    return found


def _label(value):
    if isinstance(value, dict):
        return value.get("text") or value.get("name") or value.get("label") or value.get("value")
    return value


def normalize(item, subdomain, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Pinpoint posting")
    posting_id = item.get("id")
    title = item.get("title")
    source_url = item.get("url")
    if posting_id is None or not title or not source_url or not company_name:
        raise ValueError("Malformed Pinpoint posting: missing id/title/url/company")

    parsed = urlsplit(str(source_url))
    expected_host = f"{subdomain}.pinpointhq.com"
    if parsed.scheme != "https" or parsed.hostname != expected_host:
        raise ValueError("Malformed Pinpoint posting: unexpected job URL")

    location_value = item.get("location")
    if isinstance(location_value, dict):
        location = str(location_value.get("name") or "").strip()
    else:
        location = str(location_value or "").strip()
    countries = _countries(location)
    lower_location = location.lower()
    remote = bool(re.search(r"\b(remote|anywhere|worldwide)\b", lower_location, re.I))
    arrangement = "hybrid" if "hybrid" in lower_location else ("remote" if remote else "onsite")

    description_parts = []
    for key in ("description", "key_responsibilities", "skills_knowledge_expertise", "benefits"):
        value = plain_text(item.get(key))
        if value:
            description_parts.append(value)

    department = _label(item.get("department"))
    division = _label(item.get("division"))
    employment = _label(item.get("employment_type_text") or item.get("employment_type"))

    return {
        "id": f"pinpoint:{subdomain}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": "\n\n".join(description_parts),
        "location": location,
        "countries": countries,
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(employment),
        "date_posted": item.get("published_at") or item.get("created_at"),
        "source_url": str(source_url),
        "sources": [{"provider": "Pinpoint", "subdomain": subdomain}],
        "department": department,
        "division": division,
    }


def collect(subdomain, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    subdomain = str(subdomain or "").strip().lower()
    company_name = str(company_name or "").strip()
    if not SUBDOMAIN.fullmatch(subdomain):
        raise ValueError("Pinpoint subdomain is invalid")
    if not company_name:
        raise ValueError("Pinpoint company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    payload = _request_json(
        f"https://{quote(subdomain, safe='')}.pinpointhq.com/postings.json",
        opener=opener,
    )
    jobs = payload.get("data")
    if not isinstance(jobs, list):
        raise ValueError("Pinpoint response must contain a data array")
    records = [normalize(item, subdomain, company_name) for item in jobs[:max_postings]]
    return [engine.CollectionResult(
        f"pinpoint:{subdomain}", "public_postings", True, records, len(jobs)
    )]
