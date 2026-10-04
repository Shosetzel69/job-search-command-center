"""Eightfold PCSX public career-site adapter (zero-auth)."""

import json
from datetime import datetime, timezone
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

MAX_BYTES = 12 * 1024 * 1024
PAGE_SIZE = 10
MAX_PAGES = 200
USER_AGENT = "job-search-command-center/1.0"


def _plain(value):
    return " ".join(str(value or "").split())


def _country(value):
    text = _plain(value)
    if not text:
        return None
    code = engine.COUNTRY_NAME_TO_CODE.get(text.lower())
    if not code and len(text) == 2:
        code = text.upper()
    return engine.COUNTRY_NAMES.get(code, text) if code else text


def _epoch_or_iso(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000
        return datetime.fromtimestamp(number, tz=timezone.utc).isoformat()
    return str(value)


def _location_parts(item):
    values = (
        item.get("locations")
        or item.get("standardizedLocations")
        or item.get("standardized_locations")
        or item.get("primaryLocation")
        or item.get("primary_location")
        or item.get("location")
        or []
    )
    if not isinstance(values, list):
        values = [values]
    labels, countries = [], []
    for value in values:
        if isinstance(value, dict):
            label = _plain(value.get("name") or value.get("displayName") or value.get("location"))
            if not label:
                label = ", ".join(
                    part for part in (
                        _plain(value.get("city")),
                        _plain(value.get("state")),
                        _plain(value.get("country")),
                    ) if part
                )
            country = _country(value.get("country") or value.get("countryCode") or value.get("country_code"))
        else:
            label = _plain(value)
            country = None
        if label and label not in labels:
            labels.append(label)
        if country and country not in countries:
            countries.append(country)

    direct_country = _country(item.get("country") or item.get("countryCode") or item.get("country_code"))
    if direct_country and direct_country not in countries:
        countries.append(direct_country)
    return "; ".join(labels), countries


def normalize(item, base_url, domain, company_name):
    if not isinstance(item, dict):
        raise ValueError("Malformed Eightfold public position")
    position_id = (
        item.get("id") or item.get("positionId") or item.get("position_id")
        or item.get("atsJobId") or item.get("ats_job_id")
    )
    title = _plain(item.get("name") or item.get("posting_name") or item.get("title"))
    raw_url = (
        item.get("canonicalPositionUrl") or item.get("canonical_position_url")
        or item.get("positionUrl") or item.get("position_url")
    )
    if not raw_url and position_id:
        raw_url = f"/careers/job/{position_id}"
    if not position_id or not title or not raw_url:
        raise ValueError("Malformed Eightfold public position: missing id/title/url")

    source_url = urljoin(base_url.rstrip("/") + "/", str(raw_url))
    location, countries = _location_parts(item)
    workplace = _plain(
        item.get("workLocationOption") or item.get("work_location_option")
        or item.get("locationFlexibility") or item.get("location_flexibility")
    ).lower()
    remote = "remote" in workplace
    arrangement = "hybrid" if "hybrid" in workplace else ("remote" if remote else "onsite")
    employment = item.get("employmentType") or item.get("employment_type") or []
    if not isinstance(employment, list):
        employment = [employment]

    return {
        "id": f"eightfold-public:{domain}:{position_id}",
        "job_title": title,
        "company": company_name,
        "description": _plain(item.get("job_description") or item.get("jobDescription")),
        "location": location,
        "countries": countries,
        "remote": remote,
        "work_arrangement": arrangement,
        "employment_statuses": [str(value) for value in employment if str(value).strip()],
        "date_posted": _epoch_or_iso(
            item.get("postedTs") or item.get("posted_ts") or item.get("creationTs")
            or item.get("t_create") or item.get("t_update")
        ),
        "source_url": source_url,
        "sources": [{"provider": "Eightfold PCSX", "domain": domain}],
        "department": item.get("department") or item.get("team") or item.get("businessUnit"),
    }


def _request_page(base_url, domain, start, opener=urlopen):
    params = urlencode({
        "domain": domain,
        "start": start,
        "num": PAGE_SIZE,
        "query": "",
        "location": "",
    })
    url = base_url.rstrip("/") + "/api/pcsx/search?" + params
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
        status = getattr(response, "status", 200)
    if len(body) > MAX_BYTES:
        raise ValueError("Eightfold PCSX response exceeds 12 MiB limit")
    if status != 200:
        raise RuntimeError(f"Eightfold PCSX endpoint HTTP {status}")
    payload = json.loads(body.decode("utf-8", errors="replace"))
    if not isinstance(payload, dict):
        raise ValueError("Eightfold PCSX response must be a JSON object")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    positions = data.get("positions")
    if not isinstance(positions, list):
        raise ValueError("Eightfold PCSX response must contain positions[]")
    total = data.get("count")
    try:
        total = int(total)
    except (TypeError, ValueError):
        total = None
    return positions, total


def collect(base_url, domain, company_name, max_pages=MAX_PAGES, opener=urlopen):
    parsed = urlsplit(str(base_url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Eightfold PCSX base_url must be public HTTPS")
    domain = _plain(domain)
    company_name = _plain(company_name)
    if not domain or not company_name:
        raise ValueError("Eightfold PCSX domain/company are required")
    if not isinstance(max_pages, int) or not 1 <= max_pages <= MAX_PAGES:
        raise ValueError(f"max_pages must be between 1 and {MAX_PAGES}")

    records = {}
    total_available = None
    for page in range(max_pages):
        positions, count = _request_page(base_url, domain, page * PAGE_SIZE, opener=opener)
        if count is not None:
            total_available = count
        if not positions:
            break
        for item in positions:
            record = normalize(item, base_url, domain, company_name)
            records[record["id"]] = record
        if total_available is not None and len(records) >= total_available:
            break
        if len(positions) < PAGE_SIZE:
            break

    if total_available is not None and total_available > len(records) and max_pages * PAGE_SIZE < total_available:
        raise RuntimeError(
            f"Eightfold PCSX pagination cap reached: retrieved {len(records)} of {total_available}"
        )
    return [engine.CollectionResult(
        f"eightfold-public:{domain}",
        "pcsx_public_search",
        True,
        list(records.values()),
        total_available if total_available is not None else len(records),
    )]
