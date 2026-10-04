"""Softgarden public schema.org DataFeed adapter."""

import json
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import job_search as engine

MAX_BYTES = 12 * 1024 * 1024
MAX_POSTINGS = 5000
USER_AGENT = "job-search-command-center/1.0"


def _plain(value):
    return " ".join(str(value or "").split())


def _country(value):
    text = _plain(value)
    if not text:
        return None
    code = engine.COUNTRY_NAME_TO_CODE.get(text.lower())
    if code:
        return engine.COUNTRY_NAMES.get(code, text)
    if len(text) == 2:
        return engine.COUNTRY_NAMES.get(text.upper(), text.upper())
    return text


def _addresses(job):
    locations = job.get("jobLocation") or []
    if isinstance(locations, dict):
        locations = [locations]
    labels, countries = [], []
    for location in locations if isinstance(locations, list) else []:
        if not isinstance(location, dict):
            continue
        address = location.get("address") or {}
        if not isinstance(address, dict):
            continue
        parts = [
            _plain(address.get("addressLocality")),
            _plain(address.get("addressRegion")),
            _plain(address.get("addressCountry")),
        ]
        label = ", ".join(part for part in parts if part)
        if label and label not in labels:
            labels.append(label)
        country = _country(address.get("addressCountry"))
        if country and country not in countries:
            countries.append(country)
    return "; ".join(labels), countries


def _identifier(job, source_url):
    value = job.get("identifier")
    if isinstance(value, dict):
        value = value.get("value") or value.get("name")
    value = _plain(value)
    if value:
        return value
    path = urlsplit(source_url).path.rstrip("/")
    return path.rsplit("/", 1)[-1] or source_url


def normalize(job, company_name):
    if not isinstance(job, dict):
        raise ValueError("Malformed Softgarden JobPosting")
    title = _plain(job.get("title"))
    source_url = _plain(job.get("url") or job.get("sameAs"))
    if not title or not source_url:
        raise ValueError("Malformed Softgarden JobPosting: missing title/url")

    organization = job.get("hiringOrganization") or {}
    company = _plain(organization.get("name")) if isinstance(organization, dict) else ""
    company = company_name or company
    location, countries = _addresses(job)
    location_type = _plain(job.get("jobLocationType")).upper()
    remote = "TELECOMMUTE" in location_type or bool(job.get("applicantLocationRequirements"))
    employment = job.get("employmentType") or []
    if not isinstance(employment, list):
        employment = [employment]

    return {
        "id": f"softgarden:{_identifier(job, source_url)}",
        "job_title": title,
        "company": company,
        "description": _plain(job.get("description")),
        "location": location or ("Remote" if remote else ""),
        "countries": countries,
        "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": [str(v) for v in employment if str(v).strip()],
        "date_posted": job.get("datePosted"),
        "source_url": source_url,
        "sources": [{"provider": "Softgarden"}],
    }


def _jobs(payload):
    if isinstance(payload, list):
        elements = payload
    elif isinstance(payload, dict):
        elements = payload.get("dataFeedElement") or payload.get("itemListElement") or payload.get("jobs") or []
    else:
        raise ValueError("Softgarden feed must be a JSON object or array")
    if not isinstance(elements, list):
        raise ValueError("Softgarden feed job collection must be an array")

    jobs = []
    for element in elements:
        if not isinstance(element, dict):
            continue
        item = element.get("item") if isinstance(element.get("item"), dict) else element
        if isinstance(item.get("item"), dict):
            item = item["item"]
        kind = str(item.get("@type") or "")
        if kind and kind.lower() != "jobposting":
            continue
        if item.get("title") and (item.get("url") or item.get("sameAs")):
            jobs.append(item)
    return jobs


def collect(feed_url, company_name, max_postings=MAX_POSTINGS, opener=urlopen):
    parsed = urlsplit(str(feed_url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Softgarden feed_url must be a public HTTPS URL")
    if not company_name:
        raise ValueError("Softgarden company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    request = Request(feed_url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
        status = getattr(response, "status", 200)
    if len(body) > MAX_BYTES:
        raise ValueError("Softgarden feed exceeds 12 MiB limit")
    if status != 200:
        raise RuntimeError(f"Softgarden feed HTTP {status}")

    payload = json.loads(body.decode("utf-8", errors="replace"))
    jobs = _jobs(payload)
    records = [normalize(job, company_name) for job in jobs[:max_postings]]
    return [engine.CollectionResult("softgarden", "schema_org_datafeed", True, records, len(jobs))]
