"""Workday public CXS adapter.

The connector only collects and normalizes provider data. Geography, filtering,
deduplication and scoring remain in the canonical search engine.
"""

import json
import re
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

PAGE_SIZE = 20
MAX_POSTINGS = 500
MAX_BYTES = 5 * 1024 * 1024
WORKDAY_HOST = re.compile(r"^[a-z0-9-]+\.wd[0-9]+\.myworkdayjobs\.com$", re.I)
LOCALE = re.compile(r"^[a-z]{2}(?:-[A-Z]{2})?$")


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


def parse_career_url(career_url):
    parsed = urlsplit(str(career_url or "").strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or not WORKDAY_HOST.fullmatch(host):
        raise ValueError("Workday career_url must be an HTTPS myworkdayjobs.com tenant URL")

    parts = [part for part in parsed.path.split("/") if part]
    locale = None
    if parts and LOCALE.fullmatch(parts[0]):
        locale = parts.pop(0)
    if not parts:
        raise ValueError("Workday career_url must include a site name")
    site = parts[0]
    tenant = host.split(".", 1)[0]
    origin = f"https://{host}"
    public_base = f"{origin}/{locale}/{site}" if locale else f"{origin}/{site}"
    cxs_base = f"{origin}/wday/cxs/{quote(tenant, safe='')}/{quote(site, safe='')}"
    return {"host": host, "tenant": tenant, "site": site, "locale": locale,
            "origin": origin, "public_base": public_base, "cxs_base": cxs_base}


def _request_json(request, opener=urlopen):
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Workday response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Workday response must be a JSON object")
    return payload


def _post_page(board, offset, opener=urlopen):
    payload = json.dumps({
        "appliedFacets": {},
        "limit": PAGE_SIZE,
        "offset": offset,
        "searchText": "",
    }).encode("utf-8")
    request = Request(
        board["cxs_base"] + "/jobs",
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
            "Referer": board["public_base"] + "/",
            "User-Agent": "job-search-command-center/1.0",
        },
        method="POST",
    )
    return _request_json(request, opener=opener)


def _get_detail(board, external_path, opener=urlopen):
    path = str(external_path or "").strip()
    if not path.startswith("/"):
        raise ValueError("Malformed Workday posting: invalid externalPath")
    request = Request(
        board["cxs_base"] + path,
        headers={
            "Accept": "application/json",
            "Accept-Language": "en-US",
            "Referer": board["public_base"] + path,
            "User-Agent": "job-search-command-center/1.0",
        },
    )
    return _request_json(request, opener=opener)


def _country_name(value):
    code = str(value or "").strip().upper()
    if len(code) == 2:
        return engine.COUNTRY_NAMES.get(code, code)
    return str(value or "").strip() or None


def _country_from_detail(info):
    requisition_location = info.get("jobRequisitionLocation") or {}
    country_obj = requisition_location.get("country") or {}
    if isinstance(country_obj, dict):
        code = country_obj.get("alpha2Code") or country_obj.get("code")
        if code:
            return _country_name(code)
    country = info.get("country")
    if isinstance(country, dict):
        country = country.get("name") or country.get("alpha2Code")
    return _country_name(country)


def normalize(detail, summary, board, company_name):
    info = detail.get("jobPostingInfo") or {}
    if not isinstance(info, dict):
        raise ValueError("Malformed Workday posting detail")

    external_path = summary.get("externalPath")
    title = info.get("title") or summary.get("title")
    posting_id = info.get("jobReqId") or info.get("jobPostingId")
    if not posting_id and external_path:
        posting_id = str(external_path).rstrip("/").rsplit("/", 1)[-1]
    if not all((external_path, title, posting_id, company_name)):
        raise ValueError("Malformed Workday posting: missing path/title/id/company")

    location = str(info.get("location") or summary.get("locationsText") or "").strip()
    additional = info.get("additionalLocations") or []
    if isinstance(additional, list):
        extra_locations = []
        for item in additional:
            if isinstance(item, dict):
                value = item.get("location") or item.get("name")
            else:
                value = item
            if value and str(value).strip() not in extra_locations:
                extra_locations.append(str(value).strip())
        if extra_locations:
            location = "; ".join([value for value in [location, *extra_locations] if value])

    country = _country_from_detail(info)
    remote_text = " ".join(str(info.get(key) or "") for key in ("remoteType", "workplaceType"))
    remote = bool(re.search(r"\bremote\b", remote_text, re.I) or re.search(r"\bremote\b", location, re.I))
    employment = info.get("timeType") or info.get("employmentType")
    source_url = board["public_base"] + str(external_path)

    return {
        "id": f"workday:{board['tenant']}:{board['site']}:{posting_id}",
        "job_title": str(title).strip(),
        "company": str(company_name).strip(),
        "description": plain_text(info.get("jobDescription")),
        "location": location,
        "countries": [country] if country else [],
        "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": engine.list_values(employment),
        "date_posted": info.get("startDate"),
        "source_url": source_url,
        "sources": [{"provider": "Workday", "tenant": board["tenant"], "site": board["site"]}],
    }


def collect(career_url, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    company_name = str(company_name or "").strip()
    if not company_name:
        raise ValueError("Workday company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    board = parse_career_url(career_url)
    summaries = []
    offset = 0
    total = None
    while len(summaries) < max_postings:
        payload = _post_page(board, offset, opener=opener)
        postings = payload.get("jobPostings")
        if not isinstance(postings, list):
            raise ValueError("Workday jobs response must contain a jobPostings array")
        if total is None and isinstance(payload.get("total"), int):
            total = payload["total"]
        summaries.extend(postings[:max_postings - len(summaries)])
        if not postings or len(postings) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        if isinstance(total, int) and offset >= total:
            break

    records = []
    for summary in summaries[:max_postings]:
        if not isinstance(summary, dict):
            raise ValueError("Malformed Workday posting summary")
        detail = _get_detail(board, summary.get("externalPath"), opener=opener)
        records.append(normalize(detail, summary, board, company_name))

    connector = f"workday:{board['tenant']}:{board['site']}"
    return [engine.CollectionResult(connector, "public_cxs", True, records, len(records))]
