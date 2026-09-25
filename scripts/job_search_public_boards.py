"""Bounded public job-board adapters.

Collection is intentionally broad and source-owned. No profile criteria are pushed
into provider queries. Business filtering remains in the canonical engine.
"""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import job_search as engine
from job_search_jobicy import plain_text

MAX_BYTES = 12 * 1024 * 1024
MAX_RECORDS = 500
USER_AGENT = "job-search-command-center/1.0"

ENDPOINTS = {
    "remoteok": "https://remoteok.com/api",
    "himalayas": "https://himalayas.app/jobs/api",
    "workingnomads": "https://www.workingnomads.com/api/exposed_jobs/",
    "jobgether": "https://jobgether.com/api/v1/jobs",
    "wwr": "https://weworkremotely.com/remote-jobs.rss",
    "nodesk": "https://nodesk.co/remote-jobs/index.xml",
    "euremotejobs": "https://euremotejobs.com/feed/",
    "landingjobs": "https://landing.jobs/api/v1/jobs",
    "eures": "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search",
}

DISPLAY_NAMES = {
    "remoteok": "Remote OK",
    "himalayas": "Himalayas",
    "workingnomads": "Working Nomads",
    "jobgether": "Jobgether",
    "wwr": "We Work Remotely",
    "nodesk": "NoDesk",
    "euremotejobs": "EU Remote Jobs",
    "landingjobs": "Landing.Jobs",
    "eures": "EURES",
}


def _read(request, *, timeout=35):
    with urlopen(request, timeout=timeout) as response:
        body = response.read(MAX_BYTES + 1)
        status = getattr(response, "status", None)
    if len(body) > MAX_BYTES:
        raise ValueError("Public board response exceeds size limit")
    return body, status


def _get_json(url):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    body, _ = _read(request)
    return json.loads(body.decode("utf-8"))


def _get_text(url, accept="application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1"):
    request = Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    body, _ = _read(request)
    return body.decode("utf-8", errors="replace")


def _post_json(url, payload):
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    body, _ = _read(request)
    return json.loads(body.decode("utf-8"))


def _iso_from_epoch(value):
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return str(value)
    if numeric > 10_000_000_000:
        numeric /= 1000
    return datetime.fromtimestamp(numeric, tz=timezone.utc).isoformat()


def _rss_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    parsed = engine.parse_posted_datetime(text)
    if parsed:
        return parsed.isoformat()
    try:
        parsed = parsedate_to_datetime(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        return None


def _country_fields(value):
    values = engine.list_values(value)
    names, codes = [], []
    for raw in values:
        text = str(raw or "").strip()
        if not text:
            continue
        code = text.upper() if len(text) == 2 else engine.COUNTRY_NAME_TO_CODE.get(text.casefold())
        if code in engine.ACTIVE_COUNTRY_CODES:
            if code not in codes:
                codes.append(code)
            name = engine.COUNTRY_NAMES.get(code, text)
            if name not in names:
                names.append(name)
        elif text not in names:
            names.append(text)
    return names, codes


def _record(*, connector, source_name, identity, title, company, description, url,
            date_posted=None, location="", countries=None, country_codes=None,
            remote=False, contract=None, verified_at=None):
    title = unescape(str(title or "")).strip()
    company = unescape(str(company or source_name or "")).strip()
    url = str(url or "").strip()
    if not title or not company or not url:
        raise ValueError(f"Malformed {source_name} listing: title/company/url required")
    work_arrangement = "remote" if remote else ""
    return {
        "id": f"{connector}:{identity}",
        "job_title": title,
        "company": company,
        "description": plain_text(description)[:100000],
        "date_posted": date_posted,
        "remote": bool(remote),
        "work_arrangement": work_arrangement,
        "countries": list(countries or []),
        "country_codes": list(country_codes or []),
        "location": str(location or ("Worldwide" if remote else "")).strip(),
        "employment_statuses": [str(contract).lower()] if contract else [],
        "source_url": url,
        "sources": [{"provider": source_name}],
        "verified_at": (verified_at or datetime.now(timezone.utc)).isoformat(),
    }


def _remoteok(now):
    payload = _get_json(ENDPOINTS["remoteok"])
    if not isinstance(payload, list):
        raise ValueError("Remote OK response must be an array")
    records = []
    for item in payload:
        if not isinstance(item, dict) or not item.get("id") or not item.get("position"):
            continue
        records.append(_record(
            connector="remoteok", source_name="Remote OK", identity=str(item["id"]),
            title=item.get("position"), company=item.get("company"),
            description=item.get("description"), url=item.get("apply_url") or item.get("url"),
            date_posted=item.get("date") or _iso_from_epoch(item.get("epoch")),
            location=item.get("location") or "Worldwide", remote=True, verified_at=now,
        ))
        if len(records) >= MAX_RECORDS:
            break
    return records


def _himalayas(now):
    records, cursor, pages = [], None, 0
    while pages < 5 and len(records) < 100:
        url = ENDPOINTS["himalayas"] + (("?cursor=" + cursor) if cursor else "")
        payload = _get_json(url)
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            raise ValueError("Himalayas response must contain jobs")
        for item in payload["jobs"]:
            if not isinstance(item, dict):
                continue
            locations, codes = _country_fields(item.get("locationRestrictions"))
            identity = item.get("guid") or item.get("applicationLink") or hashlib.sha256(
                str(item.get("title") or "").encode()
            ).hexdigest()[:20]
            records.append(_record(
                connector="himalayas", source_name="Himalayas", identity=hashlib.sha256(str(identity).encode()).hexdigest()[:24],
                title=item.get("title"), company=item.get("companyName"),
                description=item.get("description") or item.get("excerpt"),
                url=item.get("applicationLink") or item.get("guid"),
                date_posted=_iso_from_epoch(item.get("pubDate")),
                location=", ".join(locations) or "Remote",
                countries=locations, country_codes=codes, remote=True,
                contract=item.get("employmentType"), verified_at=now,
            ))
            if len(records) >= 100:
                break
        cursor = str(payload.get("nextCursor") or "").strip() or None
        pages += 1
        if not cursor:
            break
    return records


def _workingnomads(now):
    payload = _get_json(ENDPOINTS["workingnomads"])
    if not isinstance(payload, list):
        raise ValueError("Working Nomads response must be an array")
    records = []
    for item in payload[:MAX_RECORDS]:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        identity = hashlib.sha256(str(url or item.get("title") or "").encode()).hexdigest()[:24]
        location = str(item.get("location") or "Remote")
        countries, codes = _country_fields([
            name for name in engine.COUNTRY_NAME_TO_CODE
            if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", location, re.I)
        ])
        records.append(_record(
            connector="workingnomads", source_name="Working Nomads", identity=identity,
            title=item.get("title"), company=item.get("company_name"),
            description=item.get("description"), url=url,
            date_posted=item.get("pub_date"), location=location,
            countries=countries, country_codes=codes, remote=True, verified_at=now,
        ))
    return records


def _jobgether(now):
    records = []
    for page in range(1, 6):
        payload = _get_json(ENDPOINTS["jobgether"] + "?" + urlencode({"page": page, "limit": 25}))
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            raise ValueError("Jobgether response must contain jobs")
        jobs = payload["jobs"]
        for item in jobs:
            if not isinstance(item, dict):
                continue
            location = str(item.get("location") or "Remote")
            country_names = [part.strip() for part in location.split(",") if part.strip()]
            countries, codes = _country_fields(country_names)
            records.append(_record(
                connector="jobgether", source_name="Jobgether", identity=str(item.get("id") or hashlib.sha256(str(item.get("url")).encode()).hexdigest()[:24]),
                title=item.get("title"), company=item.get("company"),
                description="; ".join(engine.list_values(item.get("jobFunctions"))),
                url=item.get("url"), date_posted=item.get("postedAt"), location=location,
                countries=countries, country_codes=codes,
                remote="remote" in str(item.get("remote") or "").casefold(),
                contract=item.get("contractType"), verified_at=now,
            ))
        if not jobs or not (payload.get("pagination") or {}).get("hasMore"):
            break
    return records[:125]


def _first_text(node, names):
    for name in names:
        child = node.find(name)
        if child is not None and child.text:
            return child.text.strip()
        for candidate in node:
            if candidate.tag.rsplit("}", 1)[-1].lower() == name.lower() and candidate.text:
                return candidate.text.strip()
    return None


def _rss(connector, source_name, endpoint, now):
    text = _get_text(endpoint)
    root = ET.fromstring(text)
    items = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1].lower() in {"item", "entry"}]
    records = []
    for item in items[:MAX_RECORDS]:
        title = _first_text(item, ["title"])
        link = _first_text(item, ["link", "guid", "id"])
        if not link:
            link_node = next((x for x in item if x.tag.rsplit("}", 1)[-1].lower() == "link"), None)
            if link_node is not None:
                link = link_node.attrib.get("href")
        description = _first_text(item, ["description", "summary", "content"])
        date_posted = _rss_date(_first_text(item, ["pubDate", "published", "updated", "date"]))
        company = _first_text(item, ["author", "creator", "company"]) or source_name
        role = title or ""
        for separator in (" at ", " @ ", " - ", ": "):
            if separator in role and company == source_name:
                left, right = role.split(separator, 1)
                if separator in {" at ", " @ "}:
                    role, company = left, right
                elif len(left) < 80:
                    company, role = left, right
                break
        identity = hashlib.sha256(str(link or role).encode()).hexdigest()[:24]
        records.append(_record(
            connector=connector, source_name=source_name, identity=identity,
            title=role, company=company, description=description, url=link,
            date_posted=date_posted, location="Remote", remote=True, verified_at=now,
        ))
    return records


def _landingjobs(now):
    payload = _get_json(ENDPOINTS["landingjobs"] + "?limit=50")
    if isinstance(payload, dict):
        jobs = payload.get("jobs") or payload.get("data") or payload.get("results") or []
    else:
        jobs = payload
    if not isinstance(jobs, list):
        raise ValueError("Landing.Jobs response must contain a job list")
    records = []
    for item in jobs[:50]:
        if not isinstance(item, dict):
            continue
        country_value = item.get("country_name") or item.get("country_code")
        countries, codes = _country_fields(country_value)
        identity = str(item.get("id") or hashlib.sha256(str(item.get("url") or item.get("title")).encode()).hexdigest()[:24])
        url = item.get("url") or item.get("application_url") or item.get("apply_url")
        if not url and item.get("id"):
            url = f"https://landing.jobs/at/{item['id']}"
        remote = bool(item.get("remote") or item.get("work_from_home"))
        records.append(_record(
            connector="landingjobs", source_name="Landing.Jobs", identity=identity,
            title=item.get("title"), company=item.get("company_name") or item.get("company") or "Landing.Jobs",
            description=item.get("role_description") or item.get("description"),
            url=url, date_posted=item.get("published_at") or item.get("created_at"),
            location=", ".join(filter(None, [str(item.get("city") or ""), str(country_value or "")])).strip(", "),
            countries=countries, country_codes=codes, remote=remote,
            contract=item.get("type"), verified_at=now,
        ))
    return records


def _eures(now):
    payload = {
        "resultsPerPage": 100,
        "page": 1,
        "sortSearch": "MOST_RECENT",
        "keywords": [],
        "publicationPeriod": None,
        "occupationUris": [],
        "skillUris": [],
        "requiredExperienceCodes": [],
        "positionScheduleCodes": [],
        "sectorCodes": [],
        "educationAndQualificationLevelCodes": [],
        "positionOfferingCodes": [],
        "locationCodes": [],
        "euresFlagCodes": [],
        "otherBenefitsCodes": [],
        "requiredLanguages": [],
        "minNumberPost": None,
        "sessionId": "jscc-public-collection",
        "requestLanguage": "en",
    }
    response = _post_json(ENDPOINTS["eures"], payload)
    jobs = response.get("jvs") if isinstance(response, dict) else None
    if not isinstance(jobs, list):
        raise ValueError("EURES response must contain jvs")
    records = []
    for item in jobs[:100]:
        if not isinstance(item, dict):
            continue
        employer = item.get("employer") if isinstance(item.get("employer"), dict) else {}
        location_map = item.get("locationMap") if isinstance(item.get("locationMap"), dict) else {}
        codes = [str(code).upper() for code in location_map.keys() if len(str(code)) == 2]
        countries = [engine.COUNTRY_NAMES.get(code, code) for code in codes]
        identity = str(item.get("id") or "")
        url = f"https://europa.eu/eures/portal/jv-se/jv-details/{identity}?lang=en" if identity else None
        records.append(_record(
            connector="eures", source_name="EURES", identity=hashlib.sha256(identity.encode()).hexdigest()[:24],
            title=item.get("title"), company=employer.get("name") or "EURES employer",
            description=item.get("description"), url=url,
            date_posted=_iso_from_epoch(item.get("creationDate")),
            location=", ".join(countries), countries=countries, country_codes=codes,
            remote=False, verified_at=now,
        ))
    return records


def collect(connector, source=None, now=None):
    now = now or datetime.now(timezone.utc)
    source_name = str((source or {}).get("name") or DISPLAY_NAMES.get(connector) or connector)
    if connector == "remoteok":
        records = _remoteok(now)
    elif connector == "himalayas":
        records = _himalayas(now)
    elif connector == "workingnomads":
        records = _workingnomads(now)
    elif connector == "jobgether":
        records = _jobgether(now)
    elif connector == "wwr":
        records = _rss("wwr", source_name, ENDPOINTS["wwr"], now)
    elif connector == "nodesk":
        records = _rss("nodesk", source_name, ENDPOINTS["nodesk"], now)
    elif connector == "euremotejobs":
        records = _rss("euremotejobs", source_name, ENDPOINTS["euremotejobs"], now)
    elif connector == "landingjobs":
        records = _landingjobs(now)
    elif connector == "eures":
        records = _eures(now)
    else:
        raise ValueError(f"Unsupported public-board connector: {connector}")
    return [engine.CollectionResult(connector, "public-board", True, records, len(records))]
