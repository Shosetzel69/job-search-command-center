"""Ashby public Job Postings API adapter."""

import json
import re
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

BASE_URL = "https://api.ashbyhq.com/posting-api/job-board"
MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000


def _request_json(url, opener=urlopen):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "job-search-command-center/1.0"})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Ashby response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Ashby response must be a JSON object")
    return payload


def _country(value):
    text = str(value or "").strip()
    if not text:
        return None
    code = engine.COUNTRY_NAME_TO_CODE.get(text.lower())
    if code:
        return engine.COUNTRY_NAMES.get(code, text)
    if len(text) == 2:
        return engine.COUNTRY_NAMES.get(text.upper(), text.upper())
    if text.upper() == "USA":
        return engine.COUNTRY_NAMES.get("US", "United States")
    return text


def normalize(item, board_name, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Ashby posting")
    title = item.get("title")
    source_url = item.get("jobUrl")
    if not title or not source_url or not company_name:
        raise ValueError("Malformed Ashby posting: missing title/url/company")
    parsed = urlsplit(str(source_url))
    posting_id = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    if not posting_id:
        raise ValueError("Malformed Ashby posting: missing stable id")

    locations = [str(item.get("location") or "").strip()]
    countries = []
    primary_address = (((item.get("address") or {}).get("postalAddress")) or {})
    primary_country = _country(primary_address.get("addressCountry"))
    if primary_country:
        countries.append(primary_country)
    for secondary in item.get("secondaryLocations") or []:
        if not isinstance(secondary, dict):
            continue
        label = str(secondary.get("location") or "").strip()
        if label and label not in locations:
            locations.append(label)
        country = _country((secondary.get("address") or {}).get("addressCountry"))
        if country and country not in countries:
            countries.append(country)
    locations = [value for value in locations if value]
    workplace = str(item.get("workplaceType") or "").strip().lower()
    remote = bool(item.get("isRemote") or workplace == "remote")
    arrangement = "hybrid" if workplace == "hybrid" else ("remote" if remote else "onsite")

    return {
        "id": f"ashby:{board_name}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": str(item.get("descriptionPlain") or "").strip(),
        "location": "; ".join(locations),
        "countries": countries,
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(item.get("employmentType")),
        "date_posted": item.get("publishedAt"),
        "source_url": source_url,
        "sources": [{"provider": "Ashby", "board_name": board_name}],
        "department": item.get("department"),
        "team": item.get("team"),
    }


def collect(board_name, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    board_name = str(board_name or "").strip()
    company_name = str(company_name or "").strip()
    if not board_name:
        raise ValueError("Ashby board_name is required")
    if not company_name:
        raise ValueError("Ashby company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")
    payload = _request_json(f"{BASE_URL}/{quote(board_name, safe='')}?includeCompensation=false", opener=opener)
    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("Ashby response must contain a jobs array")
    listed = [item for item in jobs if isinstance(item, dict) and item.get("isListed", True)]
    records = [normalize(item, board_name, company_name) for item in listed[:max_postings]]
    return [engine.CollectionResult(f"ashby:{board_name}", "public_board", True, records, len(listed))]
