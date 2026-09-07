"""Recruitee Careers Site API adapter."""

import json
import re
from html.parser import HTMLParser
from urllib.parse import quote
from urllib.request import Request, urlopen

import job_search as engine

MAX_POSTINGS = 1000
MAX_BYTES = 10 * 1024 * 1024
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


def _request_json(subdomain, token=None, opener=urlopen):
    headers = {"Accept": "application/json", "User-Agent": "job-search-command-center/1.0"}
    if token:
        headers["X-Careers-Sites-Token"] = str(token)
    request = Request(f"https://{subdomain}.recruitee.com/api/offers/", headers=headers)
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Recruitee response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Recruitee response must be a JSON object")
    return payload


def _location_values(item):
    values = []
    location = item.get("location")
    if isinstance(location, str) and location.strip():
        values.append(location.strip())
    elif isinstance(location, dict):
        value = location.get("name") or location.get("city")
        if value:
            values.append(str(value).strip())
    for entry in item.get("locations") or []:
        if isinstance(entry, str):
            value = entry
        elif isinstance(entry, dict):
            value = entry.get("name") or entry.get("city") or entry.get("location")
        else:
            value = None
        if value and str(value).strip() not in values:
            values.append(str(value).strip())
    return values


def _countries(item, location_text):
    found = []
    for entry in item.get("locations") or []:
        if not isinstance(entry, dict):
            continue
        country = entry.get("country")
        if isinstance(country, dict):
            country = country.get("name") or country.get("code")
        if country:
            text = str(country).strip()
            code = engine.COUNTRY_NAME_TO_CODE.get(text.lower()) or (text.upper() if len(text) == 2 else None)
            canonical = engine.COUNTRY_NAMES.get(code, text) if code else text
            if canonical not in found:
                found.append(canonical)
    if not found:
        for name, code in engine.COUNTRY_NAME_TO_CODE.items():
            if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", location_text, re.I):
                canonical = engine.COUNTRY_NAMES.get(code, name.title())
                if canonical not in found:
                    found.append(canonical)
    return found


def normalize(item, subdomain, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Recruitee offer")
    offer_id = item.get("id")
    title = item.get("title")
    slug = item.get("slug")
    source_url = item.get("careers_url") or item.get("careersUrl") or item.get("url")
    if not source_url and slug:
        source_url = f"https://{subdomain}.recruitee.com/o/{quote(str(slug), safe='')}"
    if offer_id is None or not title or not source_url or not company_name:
        raise ValueError("Malformed Recruitee offer: missing id/title/url/company")

    locations = _location_values(item)
    location_text = "; ".join(locations)
    countries = _countries(item, location_text)
    remote = bool(item.get("remote") or re.search(r"\bremote\b", location_text, re.I))
    workplace = str(item.get("workplace_type") or item.get("workplaceType") or "").lower()
    arrangement = "hybrid" if "hybrid" in workplace else ("remote" if remote or "remote" in workplace else "onsite")
    if "remote" in workplace:
        remote = True

    description = item.get("description") or item.get("description_html") or item.get("descriptionHtml") or ""
    requirements = item.get("requirements") or item.get("requirements_html") or ""
    description = "\n\n".join(value for value in (plain_text(description), plain_text(requirements)) if value)

    return {
        "id": f"recruitee:{subdomain}:{offer_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": description,
        "location": location_text,
        "countries": countries,
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(item.get("employment_type") or item.get("employmentType")),
        "date_posted": item.get("published_at") or item.get("publishedAt") or item.get("created_at"),
        "source_url": source_url,
        "sources": [{"provider": "Recruitee", "subdomain": subdomain}],
        "department": (item.get("department") or {}).get("name") if isinstance(item.get("department"), dict) else item.get("department"),
    }


def collect(subdomain, company_name, token=None, max_postings=MAX_POSTINGS, opener=urlopen):
    subdomain = str(subdomain or "").strip().lower()
    company_name = str(company_name or "").strip()
    if not SUBDOMAIN.fullmatch(subdomain):
        raise ValueError("Recruitee subdomain is invalid")
    if not company_name:
        raise ValueError("Recruitee company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")
    payload = _request_json(subdomain, token=token, opener=opener)
    offers = payload.get("offers")
    if not isinstance(offers, list):
        raise ValueError("Recruitee response must contain an offers array")
    records = [normalize(item, subdomain, company_name) for item in offers[:max_postings]]
    return [engine.CollectionResult(f"recruitee:{subdomain}", "careers_site", True, records, len(offers))]
