"""Eightfold authenticated Positions API adapter."""

import json
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000


def _base_url(domain):
    value = str(domain or "").strip()
    if value.startswith("https://"):
        parsed = urlsplit(value)
        if not parsed.hostname:
            raise ValueError("Eightfold domain is invalid")
        return f"https://{parsed.hostname}"
    if not re.fullmatch(r"[a-z0-9.-]+", value, re.I):
        raise ValueError("Eightfold domain is invalid")
    return f"https://apiv2.{value}.ai"


def _request_json(url, token, opener=urlopen):
    if not token:
        raise RuntimeError("EIGHTFOLD_API_TOKEN is required")
    request = Request(url, headers={"Accept": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "job-search-command-center/1.0"})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Eightfold response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, (dict, list)):
        raise ValueError("Eightfold response must be JSON")
    return payload


def normalize(item, company_name, domain):
    if not isinstance(item, dict):
        raise ValueError("Malformed Eightfold position")
    position_id = item.get("positionId") or item.get("id") or item.get("atsJobId") or item.get("positionDisplayId")
    title = item.get("name") or item.get("title")
    source_url = item.get("jobUrl") or item.get("applyUrl") or item.get("externalUrl")
    if not source_url and position_id:
        source_url = f"https://{domain}.ai/careers/job/{position_id}"
    if not position_id or not title or not company_name:
        raise ValueError("Malformed Eightfold position: missing id/title/company")

    location_value = item.get("location") or item.get("locations") or ""
    if isinstance(location_value, list):
        location = "; ".join(str(v.get("name") if isinstance(v, dict) else v).strip() for v in location_value if v)
    elif isinstance(location_value, dict):
        location = str(location_value.get("name") or location_value.get("displayName") or "").strip()
    else:
        location = str(location_value).strip()
    country = str(item.get("country") or "").strip()
    code = engine.COUNTRY_NAME_TO_CODE.get(country.lower()) or (country.upper() if len(country) == 2 else None)
    country_name = engine.COUNTRY_NAMES.get(code, country) if country else None
    remote = bool(item.get("remote") or re.search(r"\bremote\b", location, re.I))
    return {
        "id": f"eightfold:{domain}:{position_id}", "job_title": str(title).strip(),
        "company": str(company_name).strip(), "description": str(item.get("jobDescription") or item.get("description") or "").strip(),
        "location": location, "countries": [country_name] if country_name else [], "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": engine.list_values(item.get("employmentType") or item.get("jobType")),
        "date_posted": item.get("postedDate") or item.get("createdAt") or item.get("updatedAt"),
        "source_url": source_url, "sources": [{"provider": "Eightfold", "domain": domain}],
    }


def collect(domain, token, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    company_name = str(company_name or "").strip()
    domain_key = str(domain or "").strip()
    if not company_name:
        raise ValueError("Eightfold company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")
    base = _base_url(domain_key)
    query = urlencode({"start": 0, "limit": max_postings})
    payload = _request_json(base + "/api/v2/core/positions?" + query, token, opener=opener)
    if isinstance(payload, list):
        positions = payload
        total = len(payload)
    else:
        positions = payload.get("positions") or payload.get("data") or payload.get("results")
        total = payload.get("total") or payload.get("count")
    if isinstance(positions, dict):
        positions = positions.get("positions") or positions.get("results")
    if not isinstance(positions, list):
        raise ValueError("Eightfold response must contain a positions array")
    records = [normalize(item, company_name, domain_key) for item in positions[:max_postings]]
    return [engine.CollectionResult(f"eightfold:{domain_key}", "positions_api", True, records, int(total or len(positions)))]
