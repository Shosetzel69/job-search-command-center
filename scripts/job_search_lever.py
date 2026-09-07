"""Lever public Postings API adapter."""

import json
from html.parser import HTMLParser
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import job_search as engine

BASES = {"global": "https://api.lever.co/v0/postings", "eu": "https://api.eu.lever.co/v0/postings"}
PAGE_SIZE = 100
MAX_POSTINGS = 1000
MAX_BYTES = 10 * 1024 * 1024


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
        raise ValueError("Lever response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, list):
        raise ValueError("Lever response must be a JSON array")
    return payload


def normalize(item, site, company_name, region):
    if not isinstance(item, dict):
        raise ValueError("Malformed Lever posting")
    posting_id = item.get("id")
    title = item.get("text")
    source_url = item.get("hostedUrl")
    if not posting_id or not title or not source_url or not company_name:
        raise ValueError("Malformed Lever posting: missing id/title/url/company")

    categories = item.get("categories") or {}
    locations = categories.get("allLocations") or []
    if not isinstance(locations, list):
        locations = []
    primary = str(categories.get("location") or "").strip()
    locations = [str(value).strip() for value in locations if str(value).strip()]
    if primary and primary not in locations:
        locations.insert(0, primary)
    country_code = str(item.get("country") or "").strip().upper()
    countries = [engine.COUNTRY_NAMES.get(country_code, country_code)] if country_code else []
    workplace = str(item.get("workplaceType") or "unspecified").strip().lower()
    remote = workplace == "remote"
    arrangement = "hybrid" if workplace == "hybrid" else ("remote" if remote else "onsite")

    description_parts = [item.get("descriptionPlain")]
    for section in item.get("lists") or []:
        if isinstance(section, dict):
            heading = str(section.get("text") or "").strip()
            body = plain_text(section.get("content"))
            if heading or body:
                description_parts.append(" ".join(value for value in (heading, body) if value))
    description_parts.append(item.get("additionalPlain"))

    return {
        "id": f"lever:{region}:{site}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": "\n\n".join(str(value).strip() for value in description_parts if str(value or "").strip()),
        "location": "; ".join(locations),
        "countries": countries,
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(categories.get("commitment")),
        "date_posted": None,
        "source_url": source_url,
        "sources": [{"provider": "Lever", "site": site, "region": region}],
        "department": categories.get("department"),
        "team": categories.get("team"),
    }


def collect(site, company_name, region="global", max_postings=MAX_POSTINGS, opener=urlopen):
    site = str(site or "").strip()
    company_name = str(company_name or "").strip()
    region = str(region or "global").strip().lower()
    if not site:
        raise ValueError("Lever site is required")
    if not company_name:
        raise ValueError("Lever company_name is required")
    if region not in BASES:
        raise ValueError("Lever region must be global or eu")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    records = []
    skip = 0
    while len(records) < max_postings:
        limit = min(PAGE_SIZE, max_postings - len(records))
        query = urlencode({"mode": "json", "skip": skip, "limit": limit})
        page = _request_json(f"{BASES[region]}/{quote(site, safe='')}?{query}", opener=opener)
        records.extend(normalize(item, site, company_name, region) for item in page)
        if not page or len(page) < limit:
            break
        skip += len(page)
    return [engine.CollectionResult(f"lever:{region}:{site}", "public_postings", True, records[:max_postings], len(records[:max_postings]))]
