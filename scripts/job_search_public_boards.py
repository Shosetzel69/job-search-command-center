"""Dedicated public-board adapters for stable no-auth JSON/RSS sources.

This module deliberately keeps provider-specific transport/normalization outside the
canonical filtering/FIT engine. It never bypasses login, CAPTCHA, robots or paywalls.
"""

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.entities import html5
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
    "Landing.Jobs": {"kind": "rss", "url": "https://landing.jobs/feed"},
    "We Work Remotely": {"kind": "rss", "url": "https://weworkremotely.com/remote-jobs.rss"},
    "NoDesk": {"kind": "rss", "url": "https://nodesk.co/remote-jobs/index.xml"},
    "EU Remote Jobs": {"kind": "rss", "url": "https://euremotejobs.com/feed/"},
    "EU Careers / EPSO": {"kind": "eu_careers", "url": "https://eu-careers.europa.eu/en/job-opportunities/open-vacancies/cast"},
    "Remote.co": {"kind": "remote_co", "url": "https://remote.co/remote-jobs"},
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


def _sanitize_xml_entities(payload):
    text = payload.decode("utf-8", errors="replace") if isinstance(payload, (bytes, bytearray)) else str(payload)
    allowed = {"amp", "lt", "gt", "quot", "apos"}
    def replace(match):
        name = match.group(1)
        if name in allowed:
            return match.group(0)
        value = html5.get(name + ";")
        if value is None:
            return " "
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"&([A-Za-z][A-Za-z0-9]+);", replace, text)


def _rss(payload, provider, feed_url):
    try:
        root = ET.fromstring(_sanitize_xml_entities(payload))
    except ET.ParseError as exc:
        raise ValueError(f"{provider} RSS/XML parse error: {exc}") from exc
    entries = [x for x in root.iter() if x.tag.rsplit("}", 1)[-1] in {"item", "entry"}]
    records = []
    for index, item in enumerate(entries):
        title = (_rss_text(item, ["title"]) or "").strip()
        link = (_rss_text(item, ["link"]) or "").strip()
        if not link:
            for child in list(item):
                if child.tag.rsplit("}", 1)[-1] == "link" and child.attrib.get("href"):
                    link = str(child.attrib["href"]).strip()
                    break
        if not title or not link:
            continue
        description = _rss_text(item, ["description", "summary", "content"]) or title
        company = _rss_text(item, ["company", "companyName", "author"]) or provider
        location = _rss_text(item, ["location", "locationRestriction", "city", "country"]) or "Remote"
        date = _rss_text(item, ["pubDate", "published", "updated"])
        identity = _rss_text(item, ["guid", "id"]) or link or str(index)
        try:
            records.append(_record(
                provider, identity, title, company, description, urljoin(feed_url, link),
                date_posted=_rss_date(date), location=location,
                countries=_country_names_from_text(location), remote=True,
            ))
        except ValueError:
            # One malformed feed item must not invalidate an otherwise usable public feed.
            continue
    return records


class _EuCareersTable(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.in_row = False
        self.in_cell = False
        self.cell_parts = []
        self.cell_link = None
        self.cells = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.in_row = True
            self.cells = []
        elif self.in_row and tag == "td":
            self.in_cell = True
            self.cell_parts = []
            self.cell_link = None
        elif self.in_cell and tag == "a" and attrs.get("href") and self.cell_link is None:
            self.cell_link = attrs["href"]

    def handle_data(self, data):
        if self.in_cell:
            self.cell_parts.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.in_cell:
            self.cells.append((" ".join(" ".join(self.cell_parts).split()), self.cell_link))
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            if len(self.cells) >= 7:
                self.rows.append(self.cells)
            self.in_row = False


def _eu_date(value):
    value = str(value or "").strip().split(" - ", 1)[0]
    try:
        return datetime.strptime(value, "%d/%m/%Y").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _eu_careers(base_url):
    records = {}
    for page in range(10):
        sep = "&" if "?" in base_url else "?"
        url = f"{base_url}{sep}order=created&sort=desc&page={page}"
        status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"EU Careers public vacancy page HTTP {status}")
        parser = _EuCareersTable()
        parser.feed(body.decode("utf-8", errors="replace"))
        if not parser.rows:
            break
        added = 0
        for cells in parser.rows:
            title, href = cells[0]
            if not title or not href:
                continue
            domains = cells[1][0]
            grade = cells[2][0]
            institution = cells[3][0] or "EU Careers / EPSO"
            location = cells[4][0]
            published = cells[5][0]
            deadline = cells[6][0]
            link = urljoin(base_url, href)
            identity = link.rsplit("/", 1)[-1] or link
            record = _record(
                "EU Careers / EPSO", identity, title, institution,
                f"Domains: {domains}. Grade: {grade}. Deadline: {deadline}.",
                link, date_posted=_eu_date(published), location=location,
                countries=_country_names_from_text(location), remote=False,
                employment_statuses=[grade] if grade else [],
            )
            records[record["id"]] = record
            added += 1
        if added == 0:
            break
    return list(records.values())


class _RemoteCoList(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.anchor = None
        self.anchor_parts = []
        self.heading = None
        self.heading_parts = []
        self.last_job = None
        self.recent = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href")
        if tag == "a" and href and "/job-details/" in href:
            self.anchor = href
            self.anchor_parts = []
        if tag in {"h4", "h5"}:
            self.heading = tag
            self.heading_parts = []

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        self.recent.append(text)
        self.recent = self.recent[-12:]
        if self.anchor is not None:
            self.anchor_parts.append(text)
        if self.heading is not None:
            self.heading_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            title = " ".join(self.anchor_parts).strip()
            if title:
                context = " ".join(self.recent[-8:])
                self.jobs.setdefault(self.anchor, {"title": title, "company": None, "context": context})
                self.last_job = self.anchor
            self.anchor = None
            self.anchor_parts = []
        if tag == self.heading:
            value = " ".join(self.heading_parts).strip()
            if self.last_job and value and not self.jobs[self.last_job]["company"]:
                self.jobs[self.last_job]["company"] = value
            self.heading = None
            self.heading_parts = []


def _relative_date(text):
    now = datetime.now(timezone.utc)
    value = str(text or "")
    if re.search(r"\bToday\b", value, re.I):
        return now.isoformat()
    if re.search(r"\bYesterday\b", value, re.I):
        return (now.replace(hour=12, minute=0, second=0, microsecond=0) - timedelta(days=1)).isoformat()
    match = re.search(r"\b(\d+)\s+days?\s+ago\b", value, re.I)
    if match:
        return (now - timedelta(days=int(match.group(1)))).isoformat()
    return None


def _remote_co(url):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Remote.co public jobs page HTTP {status}")
    parser = _RemoteCoList()
    parser.feed(body.decode("utf-8", errors="replace"))
    records = []
    for href, item in parser.jobs.items():
        title = item.get("title")
        if not title:
            continue
        link = urljoin(url, href)
        identity = href.rstrip("/").rsplit("/", 1)[-1]
        records.append(_record(
            "Remote.co", identity, title, item.get("company") or "Remote.co",
            item.get("context") or title, link,
            date_posted=_relative_date(item.get("context")), location="Remote",
            remote=True,
        ))
    return records

def collect(source, config=None):
    name = str(source.get("name") or "")
    spec = PUBLIC_BOARD_SOURCES.get(name)
    if not spec:
        raise ValueError(f"Unsupported public-board source: {name}")
    kind, url = spec["kind"], spec["url"]
    if kind == "eu_careers":
        records = _eu_careers(url)
    elif kind == "remote_co":
        records = _remote_co(url)
    else:
        accept = "application/json" if kind != "rss" else "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
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
