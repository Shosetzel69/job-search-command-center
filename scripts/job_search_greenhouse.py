"""Greenhouse public Job Board API adapter.

The connector only collects and normalizes provider data. Geography, filtering,
deduplication and scoring remain in the canonical search engine.
"""

import json
import re
from html.parser import HTMLParser
from urllib.parse import quote
from urllib.request import Request, urlopen

import job_search as engine

BASE_URL = "https://boards-api.greenhouse.io/v1/boards"
MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 1000


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
        raise ValueError("Greenhouse response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Greenhouse response must be a JSON object")
    return payload


def _countries(location):
    text = str(location or "")
    found = []
    for name, code in engine.COUNTRY_NAME_TO_CODE.items():
        if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text, re.I):
            canonical = engine.COUNTRY_NAMES.get(code, name.title())
            if canonical not in found:
                found.append(canonical)
    return found


def normalize(item, board_token, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Greenhouse posting")
    posting_id = item.get("id")
    title = item.get("title")
    source_url = item.get("absolute_url")
    if posting_id is None or not title or not source_url or not company_name:
        raise ValueError("Malformed Greenhouse posting: missing id/title/url/company")

    location = str((item.get("location") or {}).get("name") or "").strip()
    countries = _countries(location)
    remote = bool(re.search(r"\b(remote|anywhere|worldwide)\b", location, re.I))
    departments = [str(value.get("name")).strip() for value in (item.get("departments") or [])
                   if isinstance(value, dict) and value.get("name")]
    offices = [str(value.get("name")).strip() for value in (item.get("offices") or [])
               if isinstance(value, dict) and value.get("name")]

    return {
        "id": f"greenhouse:{board_token}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": plain_text(item.get("content")),
        "location": location,
        "countries": countries,
        "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": [],
        "date_posted": item.get("updated_at"),
        "source_url": source_url,
        "sources": [{"provider": "Greenhouse", "board_token": board_token}],
        "departments": departments,
        "offices": offices,
    }


def collect(board_token, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    board_token = str(board_token or "").strip()
    company_name = str(company_name or "").strip()
    if not board_token:
        raise ValueError("Greenhouse board_token is required")
    if not company_name:
        raise ValueError("Greenhouse company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    token = quote(board_token, safe="")
    payload = _request_json(f"{BASE_URL}/{token}/jobs?content=true", opener=opener)
    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("Greenhouse jobs response must contain a jobs array")
    jobs = jobs[:max_postings]
    records = [normalize(item, board_token, company_name) for item in jobs]
    return [engine.CollectionResult(
        f"greenhouse:{board_token}", "public_board", True, records,
        int((payload.get("meta") or {}).get("total") or len(records)),
    )]
