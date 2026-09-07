"""SmartRecruiters public Posting API adapter.

The connector only collects and normalizes provider data. Geography, filtering,
deduplication and scoring remain in the canonical search engine.
"""

import json
from html.parser import HTMLParser
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import job_search as engine

BASE_URL = "https://api.smartrecruiters.com/v1/companies"
PAGE_SIZE = 100
MAX_POSTINGS = 500
MAX_BYTES = 5 * 1024 * 1024


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
        "Accept-Language": "en",
        "User-Agent": "job-search-command-center/1.0",
    })
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("SmartRecruiters response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("SmartRecruiters response must be a JSON object")
    return payload


def _country_name(code):
    value = str(code or "").upper()
    if not value:
        return None
    return engine.COUNTRY_NAMES.get(value, value)


def _description(detail):
    sections = (((detail.get("jobAd") or {}).get("sections")) or {})
    parts = []
    for key in ("jobDescription", "qualifications", "additionalInformation"):
        section = sections.get(key) or {}
        text = plain_text(section.get("text"))
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def normalize(detail, company_identifier, fallback=None):
    fallback = fallback or {}
    if not isinstance(detail, dict):
        raise ValueError("Malformed SmartRecruiters posting detail")
    posting_id = detail.get("id") or fallback.get("id")
    title = detail.get("name") or fallback.get("name")
    company = (detail.get("company") or {}).get("name") or (fallback.get("company") or {}).get("name")
    source_url = detail.get("postingUrl") or detail.get("applyUrl") or fallback.get("postingUrl")
    if not all((posting_id, title, company, source_url)):
        raise ValueError("Malformed SmartRecruiters posting: missing id/title/company/url")

    location = detail.get("location") or fallback.get("location") or {}
    country = _country_name(location.get("country"))
    location_parts = [str(location.get(key)).strip() for key in ("city", "region") if location.get(key)]
    if country:
        location_parts.append(country)
    remote = bool(location.get("remote"))
    employment = detail.get("typeOfEmployment") or fallback.get("typeOfEmployment") or {}

    return {
        "id": f"smartrecruiters:{company_identifier}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company).strip(),
        "description": _description(detail),
        "location": ", ".join(location_parts),
        "countries": [country] if country else [],
        "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": engine.list_values(employment.get("label")),
        "date_posted": detail.get("releasedDate") or fallback.get("releasedDate"),
        "source_url": source_url,
        "sources": [{"provider": "SmartRecruiters", "company_identifier": company_identifier}],
    }


def collect(company_identifier, max_postings=MAX_POSTINGS, opener=urlopen):
    company_identifier = str(company_identifier or "").strip()
    if not company_identifier:
        raise ValueError("SmartRecruiters company_identifier is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    company_path = quote(company_identifier, safe="")
    summaries = []
    offset = 0
    total_found = None

    while len(summaries) < max_postings:
        limit = min(PAGE_SIZE, max_postings - len(summaries))
        query = urlencode({"destination": "PUBLIC", "limit": limit, "offset": offset})
        payload = _request_json(f"{BASE_URL}/{company_path}/postings?{query}", opener=opener)
        content = payload.get("content")
        if not isinstance(content, list):
            raise ValueError("SmartRecruiters postings response must contain a content array")
        if total_found is None:
            total_found = payload.get("totalFound")
        summaries.extend(content)
        if not content or len(content) < limit:
            break
        offset += len(content)
        if isinstance(total_found, int) and offset >= total_found:
            break

    records = []
    for summary in summaries[:max_postings]:
        posting_id = summary.get("id") or summary.get("uuid")
        if not posting_id:
            raise ValueError("Malformed SmartRecruiters posting summary: missing id")
        detail = _request_json(
            f"{BASE_URL}/{company_path}/postings/{quote(str(posting_id), safe='')}",
            opener=opener,
        )
        records.append(normalize(detail, company_identifier, fallback=summary))

    connector = f"smartrecruiters:{company_identifier}"
    return [engine.CollectionResult(connector, "public_postings", True, records, len(records))]
