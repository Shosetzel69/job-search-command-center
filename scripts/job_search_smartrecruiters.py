"""SmartRecruiters public Posting API adapter.

The connector only collects and normalizes provider data. Geography, filtering,
deduplication and scoring remain in the canonical search engine.
"""

import json
from html.parser import HTMLParser
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import job_search as engine
from retrieve_provider_queries import scope_search_terms, listing_role_excluded

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
        "_jscc_field_provenance": {"title":"ATS_FIELD",
            **({"description":"ATS_FIELD"} if _description(detail) else {}),
            **({"location":"ATS_FIELD"} if location_parts else {}),
            **({"date_posted":"ATS_FIELD"} if detail.get("releasedDate") or fallback.get("releasedDate") else {})},
    }


def bounded_terms(config, max_postings=MAX_POSTINGS):
    terms = scope_search_terms(config)
    # No additional list-call budget; don't silently drop any selected role.
    pages = (max_postings + PAGE_SIZE - 1) // PAGE_SIZE
    return terms if len(terms) <= pages else ()


def _bounded_summaries(company_path, terms, max_postings, opener):
    # Public Posting API: q is title/location text search. A single canonical
    # term per request avoids assuming undocumented OR syntax.
    active = {term: 0 for term in terms}
    unique = {}
    budget = (max_postings + PAGE_SIZE - 1) // PAGE_SIZE
    partial = False
    while active and budget and len(unique) < max_postings:
        for term, offset in list(active.items()):
            if not budget or len(unique) >= max_postings:
                break
            budget -= 1
            limit = min(PAGE_SIZE, max_postings - len(unique))
            query = urlencode({"destination":"PUBLIC","limit":limit,"offset":offset,"q":term})
            payload = _request_json(f"{BASE_URL}/{company_path}/postings?{query}", opener=opener)
            rows = payload.get("content")
            if not isinstance(rows, list):
                raise ValueError("SmartRecruiters postings response must contain a content array")
            for row in rows:
                identity = (row.get("id") or row.get("uuid")) if isinstance(row, dict) else None
                if not identity:
                    partial = True
                elif len(unique) < max_postings:
                    unique[str(identity)] = row
                elif str(identity) not in unique:
                    partial = True
            total = payload.get("totalFound")
            if len(rows) < limit or (isinstance(total, int) and offset + len(rows) >= total):
                active.pop(term)
            else:
                active[term] += len(rows)
    return list(unique.values()), bool(active) or partial


@engine.measure_provider_opener
def collect(company_identifier, max_postings=MAX_POSTINGS, opener=urlopen, search_terms=(), role_scopes=()):
    company_identifier = str(company_identifier or "").strip()
    if not company_identifier:
        raise ValueError("SmartRecruiters company_identifier is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    company_path = quote(company_identifier, safe="")
    summaries = []
    partial = False
    if search_terms:
        terms = tuple(sorted(set(search_terms)))
        if len(terms) > (max_postings + PAGE_SIZE - 1) // PAGE_SIZE:
            raise ValueError('Search terms exceed the existing list request budget')
        summaries, partial = _bounded_summaries(company_path, terms, max_postings, opener)
    offset = 0
    total_found = None

    while not search_terms and len(summaries) < max_postings:
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
    selected=summaries[:max_postings]
    skipped_details=0
    for summary in selected:
        if listing_role_excluded(summary.get('name') or summary.get('title'),role_scopes):
            skipped_details+=1
            continue
        posting_id = summary.get("id") or summary.get("uuid")
        if not posting_id:
            raise ValueError("Malformed SmartRecruiters posting summary: missing id")
        detail = _request_json(
            f"{BASE_URL}/{company_path}/postings/{quote(str(posting_id), safe='')}",
            opener=opener,
        )
        records.append(normalize(detail, company_identifier, fallback=summary))

    connector = f"smartrecruiters:{company_identifier}"
    results = [engine.CollectionResult(connector, "public_postings", True, records, len(records))]
    results[0].provider_scope_details={'query_terms':list(search_terms),'listing_valid':len(selected),'details_skipped_out_of_scope':skipped_details}
    if partial:
        results.append(engine.CollectionResult(connector,"bounded_search_partial",False,[],0,
            "SmartRecruiters bounded query did not exhaust every result within the existing cap",
            error_code="SCHEMA_ERROR",failure_stage="parse"))
    return results
