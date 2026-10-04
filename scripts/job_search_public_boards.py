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
    "EURES": {"kind": "eures", "url": "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search"},
    "Remote OK": {"kind": "remoteok", "url": "https://remoteok.com/api"},
    "Himalayas": {"kind": "himalayas", "url": "https://himalayas.app/jobs/api?limit=100"},
    "Working Nomads": {"kind": "workingnomads", "url": "https://www.workingnomads.com/api/exposed_jobs/"},
    "Jobgether": {"kind": "jobgether", "url": "https://jobgether.com/api/v1/jobs?limit=25&sort=date"},
    "Landing.Jobs": {"kind": "landingjobs", "url": "https://landing.jobs/api/v1/jobs?limit=50&offset=0"},
    "We Work Remotely": {"kind": "rss", "url": "https://weworkremotely.com/remote-jobs.rss"},
    "NoDesk": {"kind": "rss", "url": "https://nodesk.co/remote-jobs/index.xml"},
    "EU Remote Jobs": {"kind": "rss", "url": "https://euremotejobs.com/feed/"},
    "Remote in Europe": {"kind": "rss", "url": "https://remoteineurope.com/feed/"},
    "Remotive": {"kind": "remotive", "url": "https://remotive.com/api/remote-jobs"},
    "Atos": {"kind": "atos", "url": "https://jobs.atos.net/go/Jobs-in-Romania/3686501/"},
    "UpcoMinds": {"kind": "jobs4it", "url": "https://jobs4it.gr/"},
    "NATO Careers": {"kind": "nato_taleo", "url": "https://nato.taleo.net/careersection/2/jobsearch.ftl?lang=en", "portal": "101430233", "section": "2"},
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


def _post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=data,
        method="POST",
        headers={"Accept":"application/json","Content-Type":"application/json","User-Agent":USER_AGENT},
    )
    with urlopen(request, timeout=30) as response:
        body=response.read(MAX_BYTES+1)
        status=getattr(response,"status",200)
    if len(body)>MAX_BYTES:
        raise ValueError("Public board response exceeds 12 MiB limit")
    if status!=200:
        raise RuntimeError(f"Public board endpoint HTTP {status}")
    return json.loads(body.decode("utf-8",errors="replace"))


def _eures(payload):
    if not isinstance(payload,dict) or not isinstance(payload.get("jvs"),list):
        raise ValueError("EURES response must contain jvs[]")
    records=[]
    for item in payload["jvs"]:
        if not isinstance(item,dict) or not item.get("id") or not item.get("title"):
            continue
        employer=item.get("employer") if isinstance(item.get("employer"),dict) else {}
        location_map=item.get("locationMap") if isinstance(item.get("locationMap"),dict) else {}
        codes=[str(code).upper() for code in location_map if str(code).upper() in engine.COUNTRY_NAMES]
        countries=[engine.COUNTRY_NAMES[code] for code in codes]
        description=item.get("description")
        translations=item.get("translations") if isinstance(item.get("translations"),dict) else {}
        en=translations.get("en") if isinstance(translations.get("en"),dict) else {}
        description=description or en.get("description") or item.get("title")
        title=en.get("title") or item.get("title")
        records.append(_record(
            "EURES",item["id"],title,employer.get("name") or "EURES",description,
            f"https://europa.eu/eures/portal/jv-se/jv-details/{item['id']}?lang=en",
            date_posted=_epoch_iso(item.get("creationDate")),
            location=", ".join(countries),countries=countries,remote=False,
            employment_statuses=item.get("positionScheduleCodes") or [],
        ))
    return records


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


class _AtosJobsTable(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.in_row = False
        self.in_cell = False
        self.cells = []
        self.parts = []
        self.job_href = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.in_row = True
            self.cells = []
            self.job_href = None
        elif self.in_row and tag == "td":
            self.in_cell = True
            self.parts = []
        elif self.in_row and tag == "a" and attrs.get("href") and "/job/" in attrs["href"] and self.job_href is None:
            self.job_href = attrs["href"]

    def handle_data(self, data):
        if self.in_cell:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.in_cell:
            self.cells.append(" ".join(" ".join(self.parts).split()))
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            if self.job_href and self.cells:
                self.rows.append((self.job_href, list(self.cells)))
            self.in_row = False


class _RmkJobLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.anchor = None
        self.anchor_parts = []
        self.current_href = None
        self.context_parts = []

    def _flush_context(self):
        if self.current_href and self.current_href in self.jobs:
            self.jobs[self.current_href]["context"] = " ".join(self.context_parts[-24:])
        self.context_parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href")
        if tag == "a" and href and "/job/" in href:
            self._flush_context()
            self.anchor = href
            self.current_href = href
            self.anchor_parts = []

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        if self.anchor is not None:
            self.anchor_parts.append(text)
        if self.current_href:
            self.context_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            title = " ".join(self.anchor_parts).strip()
            if title:
                self.jobs.setdefault(self.anchor, {"title": title, "context": ""})
            self.anchor = None
            self.anchor_parts = []

    def close(self):
        super().close()
        self._flush_context()


class _Jobs4ItHome(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.anchor = None
        self.anchor_parts = []
        self.current_href = None
        self.context_parts = []

    def _flush_context(self):
        if self.current_href and self.current_href in self.jobs:
            self.jobs[self.current_href]["context"] = " ".join(self.context_parts[-24:])
        self.context_parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href")
        if tag == "a" and href and re.search(r"/job/[^/?#]+/?(?:[?#].*)?$", href):
            self._flush_context()
            self.anchor = href
            self.current_href = href
            self.anchor_parts = []

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        if self.anchor is not None:
            self.anchor_parts.append(text)
        if self.current_href:
            self.context_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            title = " ".join(self.anchor_parts).strip()
            if title and title.casefold() not in {"apply now", "bookmark it", "see all recent jobs"}:
                self.jobs.setdefault(self.anchor, {"title": title, "context": ""})
            self.anchor = None
            self.anchor_parts = []

    def close(self):
        super().close()
        self._flush_context()


def _remotive(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("Remotive response must contain jobs[]")
    records = []
    for item in payload["jobs"]:
        if not isinstance(item, dict):
            continue
        location = item.get("candidate_required_location") or "Remote"
        identity = item.get("id") or item.get("url")
        if not identity or not item.get("title") or not item.get("url"):
            continue
        records.append(_record(
            "Remotive", identity, item.get("title"),
            item.get("company_name") or "Remotive",
            item.get("description") or item.get("title"), item.get("url"),
            date_posted=item.get("publication_date"), location=location,
            countries=_country_names_from_text(location), remote=True,
            employment_statuses=item.get("job_type"),
        ))
    return records


def _atos_date(value):
    text = " ".join(str(value or "").split())
    for fmt in ("%b %d, %Y", "%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def _rmk_page_url(base_url, startrow):
    base = str(base_url or "").split("?", 1)[0]
    if startrow:
        base = base.rstrip("/") + f"/{startrow}/"
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}q=&sortColumn=referencedate&sortDirection=desc"


def _rmk_jobs(base_url, provider, company):
    records = {}
    for startrow in range(0, 251, 50):
        url = _rmk_page_url(base_url, startrow)
        status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"{provider} jobs page HTTP {status}")
        html = body.decode("utf-8", errors="replace")
        parser = _AtosJobsTable()
        parser.feed(html)
        link_parser = _RmkJobLinks()
        link_parser.feed(html)
        link_parser.close()
        added = 0

        candidates = []
        for href, cells in parser.rows:
            candidates.append((
                href,
                cells[0] if cells else "",
                cells[1] if len(cells) > 1 else "",
                cells[2] if len(cells) > 2 else "",
            ))
        if not candidates:
            for href, item in link_parser.jobs.items():
                context = item.get("context") or ""
                date_match = re.search(
                    r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b",
                    context,
                    re.I,
                )
                candidates.append((
                    href,
                    item.get("title") or "",
                    context,
                    date_match.group(0) if date_match else "",
                ))

        for href, title, location, published in candidates:
            if not title or not href:
                continue
            link = urljoin(base_url, href)
            identity = link.rstrip("/").rsplit("/", 1)[-1] or link
            countries = _country_names_from_text(location)
            if not countries:
                match = re.search(r"(?:,|\s)\s*([A-Z]{2})(?:\b|$)", location)
                if match and match.group(1) in engine.COUNTRY_NAMES:
                    countries = [engine.COUNTRY_NAMES[match.group(1)]]
            record = _record(
                provider, identity, title, company, title, link,
                date_posted=_atos_date(published), location=location,
                countries=countries,
                remote=bool(re.search(r"\bremote\b", f"{title} {location}", re.I)),
            )
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1

        if added == 0:
            break
        if len(candidates) < 50:
            break
    return list(records.values())





def _jobs4it_date(value):
    text = " ".join(str(value or "").split())
    match = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b",
        text,
        re.I,
    )
    if not match:
        return None
    try:
        return datetime.strptime(match.group(0), "%B %d, %Y").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None





def _atos(base_url):
    return _rmk_jobs(base_url, "Atos", "Atos")


def _jobs4it(base_url):
    status, _kind, body = _fetch(base_url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Jobs4IT public jobs page HTTP {status}")
    parser = _Jobs4ItHome()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = {}
    for href, item in parser.jobs.items():
        title = item.get("title")
        if not title:
            continue
        context = item.get("context") or title
        link = urljoin(base_url, href)
        identity = link.rstrip("/").rsplit("/", 1)[-1] or link
        countries = _country_names_from_text(context)
        remote = bool(re.search(r"\bremote\b", context, re.I))
        location = ", ".join(countries) or ("Remote" if remote else "")
        employment = []
        for label in ("Freelance", "Full Time", "Part Time", "Contract", "Permanent", "Temporary", "Internship"):
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I):
                employment.append(label)
        record = _record(
            "UpcoMinds", identity, title, "UpcoMinds", context, link,
            date_posted=_jobs4it_date(context), location=location,
            countries=countries, remote=remote, employment_statuses=employment,
        )
        records[record["id"]] = record
    if not records:
        raise ValueError("Jobs4IT page contained no extractable job links")
    return list(records.values())


def _taleo_post_json(url, payload):
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "tz": "GMT+00:00",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        raw = response.read(MAX_BYTES + 1)
        status = getattr(response, "status", 200)
    if len(raw) > MAX_BYTES:
        raise ValueError("Taleo response exceeds 12 MiB limit")
    if status != 200:
        raise RuntimeError(f"Taleo job-board endpoint HTTP {status}")
    return json.loads(raw.decode("utf-8", errors="replace"))


def _taleo_location(value):
    text = str(value or "").strip()
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                text = "; ".join(str(item) for item in parsed if str(item).strip())
        except json.JSONDecodeError:
            pass
    return text


def _nato_taleo(url, portal="101430233", section="2"):
    endpoint = (
        "https://nato.taleo.net/careersection/rest/jobboard/searchjobs"
        f"?lang=en&portal={portal}"
    )
    records = {}
    page = 1
    while page <= 20:
        payload = {
            "multilineEnabled": False,
            "sortingSelection": {
                "sortBySelectionParam": "3",
                "ascendingSortingOrder": "false",
            },
            "fieldData": {
                "fields": {"KEYWORD": "", "JOB_TITLE": "", "JOB_NUMBER": ""},
                "valid": True,
            },
            "filterSelectionParam": {
                "searchFilterSelections": [
                    {"id": "POSTING_DATE", "selectedValues": []},
                    {"id": "LOCATION", "selectedValues": []},
                    {"id": "JOB_FIELD", "selectedValues": []},
                    {"id": "JOB_SCHEDULE", "selectedValues": []},
                ]
            },
            "advancedSearchFiltersSelectionParam": {
                "searchFilterSelections": [
                    {"id": "ORGANIZATION", "selectedValues": []},
                    {"id": "LOCATION", "selectedValues": []},
                    {"id": "JOB_FIELD", "selectedValues": []},
                    {"id": "URGENT_JOB", "selectedValues": []},
                    {"id": "EMPLOYEE_STATUS", "selectedValues": []},
                ]
            },
            "pageNo": page,
        }
        data = _taleo_post_json(endpoint, payload)
        rows = data.get("requisitionList")
        if not isinstance(rows, list):
            raise ValueError("NATO Taleo response missing requisitionList[]")
        for item in rows:
            if not isinstance(item, dict):
                continue
            job_number = str(item.get("jobId") or item.get("contestNo") or "").strip()
            columns = item.get("column") or []
            if not job_number or not isinstance(columns, list) or not columns:
                continue
            title = plain_text(columns[0])
            location = _taleo_location(columns[1] if len(columns) > 1 else "")
            published = plain_text(columns[2] if len(columns) > 2 else "")
            link = (
                f"https://nato.taleo.net/careersection/{section}/jobdetail.ftl"
                f"?job={job_number}&lang=en"
            )
            record = _record(
                "NATO Careers", job_number, title, "NATO", title, link,
                date_posted=_atos_date(published), location=location,
                countries=_country_names_from_text(location.replace("-", " ")),
                remote=bool(re.search(r"\bremote\b", location, re.I)),
            )
            records[record["id"]] = record

        paging = data.get("pagingData") or {}
        total = int(paging.get("totalCount") or len(records))
        page_size = int(paging.get("pageSize") or max(1, len(rows)))
        if not rows or page * page_size >= total:
            break
        page += 1

    if not records:
        raise ValueError("NATO Taleo API returned no extractable job rows")
    return list(records.values())


def collect(source, config=None):
    name = str(source.get("name") or "")
    spec = PUBLIC_BOARD_SOURCES.get(name)
    if not spec:
        raise ValueError(f"Unsupported public-board source: {name}")
    kind, url = spec["kind"], spec["url"]
    if kind == "eures":
        payload=_post_json(url,{
            "resultsPerPage":100,"page":1,"sortSearch":"MOST_RECENT","keywords":[],
            "publicationPeriod":None,"occupationUris":[],"skillUris":[],
            "requiredExperienceCodes":[],"positionScheduleCodes":[],"sectorCodes":[],
            "educationAndQualificationLevelCodes":[],"positionOfferingCodes":[],
            "locationCodes":[],"euresFlagCodes":[],"otherBenefitsCodes":[],
            "requiredLanguages":[],"minNumberPost":None,
            "sessionId":"jscc-global-collection","requestLanguage":"en",
        })
        records=_eures(payload)
    elif kind == "atos":
        records = _atos(url)
    elif kind == "jobs4it":
        records = _jobs4it(url)
    elif kind == "nato_taleo":
        records = _nato_taleo(url, spec.get("portal", "101430233"), spec.get("section", "2"))
    else:
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
                "remotive": _remotive,
            }[kind]
            records = parser(payload)
    return [engine.CollectionResult("public_board", kind, True, records, len(records))]
