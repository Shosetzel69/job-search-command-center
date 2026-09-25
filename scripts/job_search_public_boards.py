"""Dedicated public-board adapters for stable no-auth JSON/RSS sources.

This module deliberately keeps provider-specific transport/normalization outside the
canonical filtering/FIT engine. It never bypasses login, CAPTCHA, robots or paywalls.
"""

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import job_search as engine

USER_AGENT = "job-search-command-center/1.0"
MAX_BYTES = 12 * 1024 * 1024

PUBLIC_BOARD_SOURCES = {
    "Remote OK": {"kind": "remoteok", "url": "https://remoteok.com/api"},
    "Himalayas": {"kind": "himalayas", "url": "https://himalayas.app/jobs/api?limit=100"},
    "Working Nomads": {"kind": "workingnomads", "url": "https://www.workingnomads.com/api/exposed_jobs/"},
    "Jobgether": {"kind": "jobgether", "url": "https://jobgether.com/api/v1/jobs?limit=25&sort=date"},
    "Landing.Jobs": {"kind": "landingjobs", "url": "https://landing.jobs/api/v1/jobs?limit=50&offset=0"},
    "We Work Remotely": {"kind": "rss", "url": "https://weworkremotely.com/remote-jobs.rss"},
    "NoDesk": {"kind": "rss", "url": "https://nodesk.co/remote-jobs/index.xml"},
    "EU Remote Jobs": {"kind": "rss", "url": "https://euremotejobs.com/feed/"},
    "Remote in Europe": {"kind": "rss", "url": "https://remoteineurope.com/feed/"},
}


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value):
    parser = PlainText()
    parser.feed(str(value or ""))
    return " ".join(" ".join(parser.parts).split())


def source_supported(name):
    return str(name or "") in PUBLIC_BOARD_SOURCES


def _fetch(url, accept):
    request = Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
        status = getattr(response, "status", 200)
        content_type = response.headers.get("Content-Type", "")
    if len(body) > MAX_BYTES:
        raise ValueError("Public board response exceeds 12 MiB limit")
    return status, content_type, body


def _country_names_from_text(value):
    text = str(value or "")
    names = []
    for name in engine.COUNTRY_NAME_TO_CODE:
        if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text, re.I):
            canonical = engine.COUNTRY_NAMES.get(engine.COUNTRY_NAME_TO_CODE[name], name)
            if canonical not in names:
                names.append(canonical)
    return names


def _epoch_iso(value):
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _rss_date(value):
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        return str(value)


def _record(provider, identity, title, company, description, url, *,
            date_posted=None, location="", countries=None, remote=False,
            employment_statuses=None):
    title = plain_text(title)
    company = plain_text(company) or provider
    description = plain_text(description) or title
    url = str(url or "").strip()
    if not title or not url:
        raise ValueError(f"Malformed {provider} listing: missing title/url")
    countries = list(dict.fromkeys(countries or []))
    return {
        "id": f"{re.sub(r'[^a-z0-9]+','-',provider.casefold()).strip('-')}:{identity}",
        "job_title": title,
        "company": company,
        "description": description[:100000],
        "date_posted": date_posted,
        "remote": bool(remote),
        "work_arrangement": "remote" if remote else "",
        "countries": countries,
        "location": plain_text(location) or ("Worldwide" if remote else ""),
        "employment_statuses": engine.list_values(employment_statuses),
        "source_url": url,
        "sources": [{"provider": provider}],
    }


def _remoteok(payload):
    records = []
    if not isinstance(payload, list):
        raise ValueError("Remote OK response must be an array")
    for item in payload:
        if not isinstance(item, dict) or not item.get("id") or not item.get("position") or not item.get("url"):
            continue
        location = item.get("location") or "Worldwide"
        records.append(_record(
            "Remote OK", item["id"], item["position"], item.get("company"),
            item.get("description"), item.get("url") or item.get("apply_url"),
            date_posted=item.get("date"), location=location,
            countries=_country_names_from_text(location), remote=True,
            employment_statuses=item.get("tags") or [],
        ))
    return records


def _himalayas(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("Himalayas response must contain jobs[]")
    records = []
    for item in payload["jobs"]:
        if not isinstance(item, dict):
            continue
        url = item.get("applicationLink") or item.get("guid")
        identity = item.get("guid") or url or item.get("title")
        restrictions = item.get("locationRestrictions") or []
        records.append(_record(
            "Himalayas", identity, item.get("title"), item.get("companyName"),
            item.get("description") or item.get("excerpt"), url,
            date_posted=_epoch_iso(item.get("pubDate")),
            location=", ".join(map(str, restrictions)) or "Worldwide",
            countries=[str(x) for x in restrictions if str(x).strip()],
            remote=True, employment_statuses=item.get("employmentType"),
        ))
    return records


def _workingnomads(payload):
    if not isinstance(payload, list):
        raise ValueError("Working Nomads response must be an array")
    records = []
    for item in payload:
        if not isinstance(item, dict) or not item.get("url"):
            continue
        identity = re.sub(r"\D", "", str(item.get("url"))) or str(item.get("url"))
        location = item.get("location") or "Remote"
        records.append(_record(
            "Working Nomads", identity, item.get("title"), item.get("company_name"),
            item.get("description"), item.get("url"),
            date_posted=item.get("pub_date"), location=location,
            countries=_country_names_from_text(location), remote=True,
            employment_statuses=item.get("category_name"),
        ))
    return records


def _jobgether(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("Jobgether response must contain jobs[]")
    records = []
    for item in payload["jobs"]:
        if not isinstance(item, dict):
            continue
        remote_text = str(item.get("remote") or "")
        is_remote = "remote" in remote_text.casefold()
        location = item.get("location") or remote_text
        records.append(_record(
            "Jobgether", item.get("id") or item.get("url"), item.get("title"),
            item.get("company"), item.get("description") or item.get("title"), item.get("url"),
            date_posted=item.get("postedAt"), location=location,
            countries=_country_names_from_text(location), remote=is_remote,
            employment_statuses=item.get("contractType"),
        ))
    return records


def _landingjobs(payload):
    if not isinstance(payload, list):
        raise ValueError("Landing.Jobs response must be an array")
    records = []
    for item in payload:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        title = item.get("title") or item.get("job_title")
        if not title:
            continue
        country = item.get("country_name") or item.get("country_code") or ""
        city = item.get("city") or ""
        location = ", ".join(x for x in (city, country) if x)
        remote = bool(item.get("remote") or item.get("work_from_home"))
        url = item.get("url") or item.get("application_url") or f"https://landing.jobs/jobs/{item['id']}"
        records.append(_record(
            "Landing.Jobs", item["id"], title,
            item.get("company_name") or item.get("company") or "Landing.Jobs",
            item.get("role_description") or item.get("description") or title, url,
            date_posted=item.get("published_at") or item.get("created_at"),
            location=location or ("Worldwide" if remote else ""),
            countries=[country] if country else [], remote=remote,
            employment_statuses=item.get("type"),
        ))
    return records


def _rss_text(element, names):
    for name in names:
        direct = element.find(name)
        if direct is not None and direct.text:
            return direct.text
        for child in list(element):
            if child.tag.rsplit("}", 1)[-1] == name and child.text:
                return child.text
    return None


def _rss(payload, provider, feed_url):
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ValueError(f"{provider} RSS/XML parse error: {exc}") from exc
    entries = [x for x in root.iter() if x.tag.rsplit("}", 1)[-1] in {"item", "entry"}]
    records = []
    for index, item in enumerate(entries):
        title = _rss_text(item, ["title"])
        link = _rss_text(item, ["link"])
        if not link:
            for child in list(item):
                if child.tag.rsplit("}", 1)[-1] == "link" and child.attrib.get("href"):
                    link = child.attrib["href"]
                    break
        if not title or not link:
            continue
        description = _rss_text(item, ["description", "summary", "content"]) or title
        company = _rss_text(item, ["company", "companyName", "author"]) or provider
        location = _rss_text(item, ["location", "locationRestriction"]) or "Remote"
        date = _rss_text(item, ["pubDate", "published", "updated"])
        identity = _rss_text(item, ["guid", "id"]) or link or str(index)
        records.append(_record(
            provider, identity, title, company, description, urljoin(feed_url, link),
            date_posted=_rss_date(date), location=location,
            countries=_country_names_from_text(location), remote=True,
        ))
    return records


def collect(source, config=None):
    name = str(source.get("name") or "")
    spec = PUBLIC_BOARD_SOURCES.get(name)
    if not spec:
        raise ValueError(f"Unsupported public-board source: {name}")
    kind, url = spec["kind"], spec["url"]
    accept = "application/json" if kind != "rss" else "application/rss+xml, application/xml, text/xml, */*"
    status, _content_type, body = _fetch(url, accept)
    if status != 200:
        raise RuntimeError(f"{name} public endpoint HTTP {status}")
    if kind == "rss":
        records = _rss(body, name, url)
    else:
        payload = json.loads(body.decode("utf-8", errors="replace"))
        parser = {
            "remoteok": _remoteok,
            "himalayas": _himalayas,
            "workingnomads": _workingnomads,
            "jobgether": _jobgether,
            "landingjobs": _landingjobs,
        }[kind]
        records = parser(payload)
    return [engine.CollectionResult("public_board", kind, True, records, len(records))]
