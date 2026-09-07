"""BambooHR public careers adapter."""

import json
import re
from html.parser import HTMLParser
from urllib.parse import quote
from urllib.request import Request, urlopen

import job_search as engine

MAX_POSTINGS = 500
MAX_BYTES = 10 * 1024 * 1024
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
        raise ValueError("BambooHR response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("BambooHR response must be a JSON object")
    return payload


def _location(item):
    values = []
    source = item.get("location") or {}
    fallback = item.get("atsLocation") or {}
    if not any(source.get(key) for key in ("city", "state", "province", "country")):
        source = fallback
    for key in ("city", "state", "province", "country"):
        value = source.get(key) if isinstance(source, dict) else None
        if value and str(value).strip() not in values:
            values.append(str(value).strip())
    return ", ".join(values), source


def _country(source):
    if not isinstance(source, dict):
        return None
    value = str(source.get("country") or "").strip()
    if not value:
        return None
    code = engine.COUNTRY_NAME_TO_CODE.get(value.lower()) or (value.upper() if len(value) == 2 else None)
    return engine.COUNTRY_NAMES.get(code, value) if code else value


def normalize(summary, detail, subdomain, company_name):
    if not isinstance(summary, dict):
        raise ValueError("Malformed BambooHR posting summary")
    info = detail.get("result", {}).get("jobOpening") if isinstance(detail.get("result"), dict) else None
    if not isinstance(info, dict):
        raise ValueError("Malformed BambooHR posting detail")
    posting_id = summary.get("id") or info.get("id")
    title = info.get("jobOpeningName") or summary.get("jobOpeningName")
    if not posting_id or not title or not company_name:
        raise ValueError("Malformed BambooHR posting: missing id/title/company")

    merged = dict(summary)
    merged.update(info)
    location, source = _location(merged)
    country = _country(source) or _country(merged.get("atsLocation") or {})
    location_type = str(merged.get("locationType") or "").strip()
    remote = bool(merged.get("isRemote") or location_type == "1")
    arrangement = "hybrid" if location_type == "2" else ("remote" if remote else "onsite")
    if arrangement == "remote" and "remote" not in location.lower():
        location = "; ".join(value for value in (location, "Remote") if value)
    source_url = info.get("jobOpeningShareUrl") or f"https://{subdomain}.bamboohr.com/careers/{quote(str(posting_id), safe='')}"

    return {
        "id": f"bamboohr:{subdomain}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": plain_text(info.get("description")),
        "location": location,
        "countries": [country] if country else [],
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(info.get("employmentType") or summary.get("employmentType") or summary.get("employmentStatusLabel")),
        "date_posted": info.get("datePosted"),
        "source_url": source_url,
        "sources": [{"provider": "BambooHR", "subdomain": subdomain}],
        "department": info.get("departmentLabel") or summary.get("departmentLabel"),
    }


def collect(subdomain, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    subdomain = str(subdomain or "").strip().lower()
    company_name = str(company_name or "").strip()
    if not SLUG.fullmatch(subdomain):
        raise ValueError("BambooHR subdomain is invalid")
    if not company_name:
        raise ValueError("BambooHR company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    origin = f"https://{subdomain}.bamboohr.com"
    listing = _request_json(origin + "/careers/list", opener=opener)
    summaries = listing.get("result")
    if not isinstance(summaries, list):
        raise ValueError("BambooHR list response must contain a result array")
    records = []
    for summary in summaries[:max_postings]:
        posting_id = summary.get("id") if isinstance(summary, dict) else None
        if not posting_id:
            raise ValueError("Malformed BambooHR posting summary: missing id")
        detail = _request_json(
            origin + f"/careers/{quote(str(posting_id), safe='')}/detail",
            opener=opener,
        )
        records.append(normalize(summary, detail, subdomain, company_name))
    total = (listing.get("meta") or {}).get("totalCount")
    return [engine.CollectionResult(f"bamboohr:{subdomain}", "public_careers", True, records, int(total or len(summaries)))]
