"""Phenom authenticated Jobs API adapter."""

import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import job_search as engine

BASE_URL = "https://api.phenom.com/jobs-api/v1/jobs"
MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000


def _request_json(url, token, opener=urlopen):
    if not token:
        raise RuntimeError("PHENOM_API_TOKEN is required")
    request = Request(url, headers={"Accept": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "job-search-command-center/1.0"})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Phenom response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Phenom response must be a JSON object")
    return payload


def normalize(item, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Phenom job")
    job_id = item.get("jobId") or item.get("reqId") or item.get("referenceId")
    title = item.get("title")
    source_url = item.get("applyUrl") or item.get("jobUrl")
    if not job_id or not title or not source_url or not company_name:
        raise ValueError("Malformed Phenom job: missing id/title/url/company")
    location = ", ".join(str(item.get(k)).strip() for k in ("city", "state", "country") if item.get(k))
    country = str(item.get("country") or "").strip()
    code = engine.COUNTRY_NAME_TO_CODE.get(country.lower()) or (country.upper() if len(country) == 2 else None)
    country_name = engine.COUNTRY_NAMES.get(code, country) if country else None
    remote = bool(item.get("remote") or "remote" in location.lower())
    return {
        "id": f"phenom:{job_id}", "job_title": str(title).strip(), "company": str(company_name).strip(),
        "description": str(item.get("description") or "").strip(), "location": location,
        "countries": [country_name] if country_name else [], "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": engine.list_values(item.get("employmentType")),
        "date_posted": item.get("postedDate") or item.get("datePosted") or item.get("createdDate"),
        "source_url": source_url, "sources": [{"provider": "Phenom"}],
        "category": item.get("category"),
    }


def collect(token, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    company_name = str(company_name or "").strip()
    if not company_name:
        raise ValueError("Phenom company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")
    payload = _request_json(BASE_URL + "?" + urlencode({"offset": 0, "limit": max_postings}), token, opener=opener)
    data = payload.get("data")
    if isinstance(data, dict):
        jobs = data.get("jobs") or data.get("results")
    else:
        jobs = data
    if not isinstance(jobs, list):
        raise ValueError("Phenom response must contain a jobs array")
    records = [normalize(item, company_name) for item in jobs[:max_postings]]
    total = payload.get("hits") or payload.get("total") or len(jobs)
    return [engine.CollectionResult("phenom", "jobs_api", True, records, int(total))]
