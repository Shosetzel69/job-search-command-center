"""Dedicated public-board adapters for stable no-auth JSON/RSS sources.

This module deliberately keeps provider-specific transport/normalization outside the
canonical filtering/FIT engine. It never bypasses login, CAPTCHA, robots or paywalls.
"""

import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.entities import html5
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import job_search as engine
import web_browser as browser
from web_transport import PublicClient

USER_AGENT = "job-search-command-center/1.0"
MAX_BYTES = 12 * 1024 * 1024

BROWSER_REQUIRED_SOURCES = {"EPAM", "Mantu", "Serco Europe", "Proactive.IT", "Prohuman"}

PUBLIC_BOARD_SOURCES = {
    "EURES": {"kind": "eures", "url": "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search"},
    "Remote OK": {"kind": "remoteok", "url": "https://remoteok.com/api"},
    "Himalayas": {"kind": "himalayas", "url": "https://himalayas.app/jobs/api?limit=100"},
    "Working Nomads": {"kind": "workingnomads", "url": "https://www.workingnomads.com/api/exposed_jobs/"},
    "Jobgether": {"kind": "jobgether", "url": "https://jobgether.com/api/v1/jobs?limit=25&sort=date"},
    "Landing.Jobs": {"kind": "landingjobs", "url": "https://landing.jobs/api/v1/jobs?limit=50&offset=0"},
    "We Work Remotely": {"kind": "rss", "url": "https://weworkremotely.com/remote-jobs.rss"},
    "NoDesk": {"kind": "rss", "url": "https://nodesk.co/remote-jobs/index.xml"},
    "EU Remote Jobs": {"kind": "eu_remote", "url": "https://euremotejobs.com/", "feed_url": "https://euremotejobs.com/feed/"},
    "Remote in Europe": {"kind": "rss", "url": "https://remoteineurope.com/feed/"},
    "EU Careers / EPSO": {"kind": "eu_careers", "url": "https://eu-careers.europa.eu/en/job-opportunities/open-vacancies/cast"},
    "Remote.co": {"kind": "remote_co", "url": "https://remote.co/remote-jobs"},
    "Remotive": {"kind": "remotive", "url": "https://remotive.com/api/remote-jobs"},
    "Atos": {"kind": "atos", "url": "https://jobs.atos.net/go/Jobs-in-Romania/3686501/"},
    "UpcoMinds": {"kind": "jobs4it", "url": "https://jobs4it.gr/"},
    "Worldline": {"kind": "worldline", "url": "https://jobs.worldline.com/viewalljobs/"},
    "NATO Careers": {"kind": "nato_taleo", "url": "https://nato.taleo.net/careersection/2/jobsearch.ftl?lang=en", "portal": "101430233", "section": "2"},
    "EuroBrussels": {"kind": "eurobrussels", "url": "https://www.eurobrussels.com/job_search"},
    "Societe Generale": {"kind": "socgen", "url": "https://careers.societegenerale.com/en/Technical/all-job-offers"},
    "SoftServe": {"kind": "softserve", "url": "https://career.softserveinc.com/en-us/vacancies/country-romania"},
    "EPAM": {"kind": "epam", "url": "https://careers.epam.com/en/jobs/romania"},
    "Orange Romania": {"kind": "softgarden_feed", "url": "https://cariere.orange.ro/jobs.feed.json"},
    "Mantu": {"kind": "rendered_links", "url": "https://careers.mantu.com/jobs", "job_path": r"/brands/[^/?#]+/jobs/\\d+"},
    "Serco Europe": {"kind": "rendered_links", "url": "https://careers.serco.com/eu/en/search-results", "job_path": r"/eu/en/job/\\d+/[^/?#]+"},
    "Next Ventures": {"kind": "nextventures", "url": "https://next-ventures.com/jobs/"},
    "Hays Romania": {"kind": "linked_jobs", "url": "https://www.hays.ro/en/job-search", "job_path": r"/en/job-detail/[^?#]+"},
    "Square One Resources": {"kind": "squareone", "url": "https://www.squareoneresources.com/jobs"},
    "Proactive.IT": {"kind": "rendered_links", "url": "https://www.proactive.it/job-vacancies/", "job_path": r"/job/[^/?#]+/?$"},
    "PowerToFly": {"kind": "linked_jobs", "url": "https://powertofly.com/jobs/?only_html=True", "job_path": r"/jobs/detail/\\d+"},
    "Wellfound": {"kind": "linked_jobs", "url": "https://wellfound.com/jobs", "job_path": r"/jobs/\\d+-[^?#]+"},
    "SkipTheDrive": {"kind": "linked_jobs", "url": "https://www.skipthedrive.com/job-category/remote-project-manager-jobs/", "job_path": r"/job/[^?#]+-\\d+/"},
    "Prohuman": {"kind": "prohuman", "url": "https://www.prohuman.ro/locuri-de-munca"},
    "Source Group International": {"kind": "linked_jobs", "url": "https://www.sourcegroupinternational.com/candidate/", "job_path": r"/jobs/[^?#]+/"},
}


class _RenderedCareerJobs(HTMLParser):
    def __init__(self, job_path):
        super().__init__(convert_charrefs=True)
        self.job_path = re.compile(job_path, re.I)
        self.jobs = {}
        self.current_href = None
        self.title_parts = []
        self.context_parts = []
        self.in_anchor = False

    def _flush(self):
        if self.current_href:
            title = " ".join(self.title_parts).strip()
            context = " ".join(self.context_parts[-30:]).strip()
            if title and title.casefold() not in {"apply", "apply now", "view job", "learn more"}:
                self.jobs.setdefault(self.current_href, {"title": title, "context": context})
        self.current_href = None
        self.title_parts = []
        self.context_parts = []
        self.in_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = str(attrs.get("href") or "")
        if tag == "a" and href and self.job_path.search(href):
            self._flush()
            self.current_href = href
            self.title_parts = []
            self.context_parts = []
            self.in_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current_href:
            return
        if self.in_anchor:
            self.title_parts.append(text)
        else:
            self.context_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False

    def close(self):
        super().close()
        self._flush()


def _rendered_career_board(url, provider, job_path, company=None, max_seconds=20):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, rendered_html, _meta = browser.render(url, deadline, client)
    parser = _RenderedCareerJobs(job_path)
    parser.feed(rendered_html)
    parser.close()
    records = {}
    for href, item in parser.jobs.items():
        title = item.get("title") or ""
        context = item.get("context") or ""
        if not title:
            continue
        link = urljoin(final_url, href)
        id_match = re.search(r"/(?:jobs?|job)/(?:[^/]+/)?(\d+)(?:/|$)", link, re.I)
        identity = id_match.group(1) if id_match else link.rstrip("/").rsplit("/", 1)[-1]
        countries = _country_names_from_text(context)
        record = _record(
            provider, identity, title, company or provider, context or title, link,
            location=context,
            countries=countries,
            remote=bool(re.search(r"\b(remote|hybrid|telework)\b", context, re.I)),
        )
        records[record["id"]] = record
    if not records:
        raise ValueError(f"{provider} rendered careers page contained no extractable job links")
    return list(records.values())


def _linked_job_board(url, provider, job_path):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"{provider} jobs page HTTP {status}")
    parser = _RenderedCareerJobs(job_path)
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = {}
    for href, item in parser.jobs.items():
        title = item.get("title") or ""
        context = item.get("context") or ""
        if not title:
            continue
        link = urljoin(url, href)
        ref_match = re.search(r"_(\d+)(?:[/?#]|$)", link)
        identity = ref_match.group(1) if ref_match else link.rstrip("/").rsplit("/", 1)[-1]
        countries = _country_names_from_text(context)
        record = _record(
            provider, identity, title, provider, context or title, link,
            date_posted=_relative_date(context),
            location=context,
            countries=countries,
            remote=bool(re.search(r"\b(remote|hybrid|telework)\b", context, re.I)),
        )
        records[record["id"]] = record
    if not records:
        raise ValueError(f"{provider} jobs page contained no extractable job links")
    return list(records.values())


class _JobLinkCollector(HTMLParser):
    def __init__(self, pattern):
        super().__init__(convert_charrefs=True)
        self.pattern = re.compile(pattern, re.I)
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href = str(dict(attrs).get("href") or "")
        if href and self.pattern.search(href) and href not in self.links:
            self.links.append(href)


class _JobDetailPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_h1 = False
        self.title_parts = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self.in_h1 = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        self.parts.append(text)
        if self.in_h1:
            self.title_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "h1":
            self.in_h1 = False

    @property
    def title(self):
        return " ".join(self.title_parts).strip()

    @property
    def text(self):
        return " ".join(self.parts)


def _squareone(url, max_details=20):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Square One Resources jobs page HTTP {status}")
    links = _JobLinkCollector(r"/job/[^/?#]+")
    links.feed(body.decode("utf-8", errors="replace"))
    records = {}
    for href in links.links[:max_details]:
        link = urljoin(url, href)
        detail_status, _detail_kind, detail_body = _fetch(link, "text/html,application/xhtml+xml")
        if detail_status != 200:
            continue
        detail = _JobDetailPage()
        detail.feed(detail_body.decode("utf-8", errors="replace"))
        title = detail.title
        context = detail.text
        if not title:
            continue
        id_match = re.search(r"-(\d{5,})(?:-|$)", link)
        identity = id_match.group(1) if id_match else link.rstrip("/").rsplit("/", 1)[-1]
        employment = [
            label for label in ("Contract", "Permanent", "Temporary", "Freelance")
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I)
        ]
        records[identity] = _record(
            "Square One Resources", identity, title, "Square One Resources",
            context or title, link,
            date_posted=_relative_date(context),
            location=context,
            countries=_country_names_from_text(context),
            remote=bool(re.search(r"Remote Work\s*-\s*Yes|\bfully remote\b", context, re.I)),
            employment_statuses=employment,
        )
    if not records:
        raise ValueError("Square One Resources jobs page contained no extractable job details")
    return list(records.values())


def _prohuman(url, max_details=30, max_seconds=25):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, rendered_html, _meta = browser.render(url, deadline, client)
    links = _JobLinkCollector(r"/candidati/jobs/[^/?#]+")
    links.feed(rendered_html)
    records = {}
    for href in links.links[:max_details]:
        link = urljoin(final_url, href)
        try:
            detail_url, detail_html = client.get(link)
        except Exception:
            continue
        detail = _JobDetailPage()
        detail.feed(detail_html)
        title = detail.title
        context = detail.text
        if not title or re.search(r"Rolul este inchis", context, re.I):
            continue
        identity = detail_url.rstrip("/").rsplit("/", 1)[-1]
        employment = [
            label for label in ("Full time", "Part time", "Contract", "Temporary", "Freelance")
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I)
        ]
        records[identity] = _record(
            "Prohuman", identity, title, "Prohuman APT", context or title, detail_url,
            date_posted=_relative_date(context),
            location=context,
            countries=_country_names_from_text(context),
            remote=bool(re.search(r"\b(remote|hybrid)\b", context, re.I)),
            employment_statuses=employment,
        )
    if not records:
        raise ValueError("Prohuman rendered jobs page contained no open extractable jobs")
    return list(records.values())


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


def browser_required(name):
    return str(name or "") in BROWSER_REQUIRED_SOURCES


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

def _softgarden_feed(payload, provider, feed_url):
    if not isinstance(payload, dict):
        raise ValueError("Softgarden feed must be a JSON object")
    elements = payload.get("dataFeedElement") or payload.get("itemListElement") or payload.get("jobs")
    if not isinstance(elements, list):
        raise ValueError("Softgarden feed must contain dataFeedElement[]")
    records = []
    for index, raw in enumerate(elements):
        item = raw.get("item") if isinstance(raw, dict) and isinstance(raw.get("item"), dict) else raw
        if not isinstance(item, dict):
            continue
        title = item.get("title") or item.get("name")
        url = item.get("url") or item.get("sameAs")
        identifier = item.get("identifier")
        if isinstance(identifier, dict):
            identity = identifier.get("value") or identifier.get("name")
        else:
            identity = identifier
        identity = str(identity or url or index)
        if not title or not url:
            continue

        company = provider
        hiring = item.get("hiringOrganization")
        if isinstance(hiring, dict) and hiring.get("name"):
            company = str(hiring.get("name"))

        locations = item.get("jobLocation")
        if isinstance(locations, dict):
            locations = [locations]
        locations = locations if isinstance(locations, list) else []
        location_parts = []
        countries = []
        for loc in locations:
            if not isinstance(loc, dict):
                continue
            address = loc.get("address") if isinstance(loc.get("address"), dict) else {}
            city = str(address.get("addressLocality") or "").strip()
            region = str(address.get("addressRegion") or "").strip()
            country_raw = str(address.get("addressCountry") or "").strip()
            country = None
            if country_raw:
                code = engine.COUNTRY_NAME_TO_CODE.get(country_raw.lower()) or (country_raw.upper() if len(country_raw)==2 else None)
                country = engine.COUNTRY_NAMES.get(code, country_raw) if code else country_raw
                if country not in countries:
                    countries.append(country)
            label = ", ".join(x for x in (city, region, country) if x)
            if label and label not in location_parts:
                location_parts.append(label)

        description = plain_text(item.get("description") or item.get("descriptionHtml") or "")
        job_location_type = str(item.get("jobLocationType") or "").upper()
        remote = "TELECOMMUTE" in job_location_type or bool(re.search(r"\bremote\b", " ".join(location_parts), re.I))
        records.append(_record(
            provider, identity, str(title), company, description or str(title), str(url),
            date_posted=item.get("datePosted"),
            location="; ".join(location_parts),
            countries=countries,
            remote=remote,
            employment_statuses=engine.list_values(item.get("employmentType")),
        ))
    if not records:
        raise ValueError(f"{provider} Softgarden feed contained no extractable jobs")
    return records


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
    match = re.search(r"\b(\d+)\s+hours?\s+ago\b", value, re.I)
    if match:
        return (now - timedelta(hours=int(match.group(1)))).isoformat()
    match = re.search(r"\b(\d+)\s+days?\s+ago\b", value, re.I)
    if match:
        return (now - timedelta(days=int(match.group(1)))).isoformat()
    match = re.search(r"\b(\d+)\s+weeks?\s+ago\b", value, re.I)
    if match:
        return (now - timedelta(weeks=int(match.group(1)))).isoformat()
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



def _landing_jobs_api(base_url):
    records = {}
    roots = [str(base_url or "").rstrip("/")]
    if not roots[0].endswith(".json"):
        roots.append(roots[0] + ".json")
    selected_root = None

    for offset in range(0, 201, 50):
        body = None
        last_error = None
        candidates = [selected_root] if selected_root else roots
        for root in candidates:
            if not root:
                continue
            sep = "&" if "?" in root else "?"
            try:
                status, _kind, candidate_body = _fetch(
                    f"{root}{sep}limit=50&offset={offset}",
                    "application/json",
                )
            except Exception as exc:
                last_error = exc
                continue
            if status == 200:
                selected_root = root
                body = candidate_body
                break
            last_error = RuntimeError(f"Landing.Jobs public API HTTP {status}")
        if body is None:
            if last_error:
                raise last_error
            raise RuntimeError("Landing.Jobs public API unavailable")

        payload = json.loads(body.decode("utf-8", errors="replace"))
        page = _landingjobs(payload)
        for record in page:
            records[record["id"]] = record
        if not isinstance(payload, list) or len(payload) < 50:
            break
    return list(records.values())


class _EuRemoteJobsList(HTMLParser):
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
        if tag == "a" and href and re.search(r"/job/[^/?#]+", href):
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
            if title and title.casefold() not in {"apply", "read more", "view job"}:
                self.jobs.setdefault(self.anchor, {"title": title, "context": ""})
            self.anchor = None
            self.anchor_parts = []

    def close(self):
        super().close()
        self._flush_context()


def _eu_remote_jobs(base_url, feed_url):
    # Prefer the site's feed when it contains usable items. Some edge/CDN paths
    # return 202 while still carrying a feed body, so status alone is not failure.
    try:
        status, _kind, body = _fetch(
            feed_url,
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        )
        if status in {200, 202}:
            try:
                records = _rss(body, "EU Remote Jobs", feed_url)
            except ValueError:
                records = []
            if records:
                return records
    except Exception:
        pass

    status, _kind, body = _fetch(base_url, "text/html,application/xhtml+xml")
    if status not in {200, 202}:
        raise RuntimeError(f"EU Remote Jobs public page HTTP {status}")
    parser = _EuRemoteJobsList()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = []
    for href, item in parser.jobs.items():
        title = item.get("title")
        if not title:
            continue
        context = item.get("context") or title
        link = urljoin(base_url, href)
        identity = link.rstrip("/").rsplit("/", 1)[-1] or link
        records.append(_record(
            "EU Remote Jobs", identity, title, "EU Remote Jobs", context, link,
            date_posted=_relative_date(context),
            location="Europe", countries=[], remote=True,
        ))
    if not records:
        raise ValueError("EU Remote Jobs page contained no extractable job links")
    return records


class _SoftServeJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.current_href = None
        self.title_parts = []
        self.context_parts = []
        self.in_anchor = False

    def _flush(self):
        if self.current_href:
            title = " ".join(self.title_parts).strip()
            context = " ".join(self.context_parts[-16:]).strip()
            if title:
                self.jobs[self.current_href] = {"title": title, "context": context}
        self.current_href = None
        self.title_parts = []
        self.context_parts = []
        self.in_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href") or ""
        if tag == "a" and re.search(r"/en-us/vacancies/[^/?#]+-\d+/?(?:[?#].*)?$", href):
            self._flush()
            self.current_href = href
            self.in_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current_href:
            return
        if self.in_anchor:
            self.title_parts.append(text)
        else:
            self.context_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False

    def close(self):
        super().close()
        self._flush()


def _softserve_page_url(base_url, page):
    base = str(base_url or "").rstrip("/")
    return base if page == 1 else f"{base}/page-{page}"


def _softserve(base_url, max_pages=10, max_seconds=30):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    records = {}
    for page_no in range(1, max_pages + 1):
        final_url, html = client.get(_softserve_page_url(base_url, page_no))
        parser = _SoftServeJobs()
        parser.feed(html)
        parser.close()
        added = 0
        for href, item in parser.jobs.items():
            title = item.get("title") or ""
            context = item.get("context") or ""
            if not title:
                continue
            link = urljoin(final_url, href)
            identity = link.rstrip("/").rsplit("/", 1)[-1]
            record = _record(
                "SoftServe", identity, title, "SoftServe", context or title, link,
                location=context, countries=_country_names_from_text(context),
                remote=bool(re.search(r"\bremote\b", context, re.I)),
            )
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0:
            break
    if not records:
        raise ValueError("SoftServe Romania page contained no extractable job links")
    return list(records.values())


class _EpamJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.current_href = None
        self.title_parts = []
        self.context_parts = []
        self.in_anchor = False

    def _flush(self):
        if self.current_href:
            title = " ".join(self.title_parts).strip()
            context = " ".join(self.context_parts[-20:]).strip()
            if title:
                self.jobs[self.current_href] = {"title": title, "context": context}
        self.current_href = None
        self.title_parts = []
        self.context_parts = []
        self.in_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href") or ""
        if tag == "a" and re.search(r"/en/vacancy/[^?#]+", href):
            self._flush()
            self.current_href = href
            self.in_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current_href:
            return
        if self.in_anchor:
            self.title_parts.append(text)
        else:
            self.context_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False

    def close(self):
        super().close()
        self._flush()


def _epam(url, max_seconds=20):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, rendered_html, _meta = browser.render(url, deadline, client)
    parser = _EpamJobs()
    parser.feed(rendered_html)
    parser.close()
    records = {}
    for href, item in parser.jobs.items():
        title = item.get("title") or ""
        context = item.get("context") or ""
        if not title:
            continue
        link = urljoin(final_url, href)
        identity = link.rstrip("/").rsplit("/", 1)[-1]
        record = _record(
            "EPAM", identity, title, "EPAM", context or title, link,
            location=context, countries=_country_names_from_text(context),
            remote=bool(re.search(r"\bremote\b", context, re.I)),
        )
        records[record["id"]] = record
    if not records:
        raise ValueError("EPAM rendered Romania page contained no extractable job links")
    return list(records.values())


class _SocGenJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.current_href = None
        self.anchor_parts = []
        self.context_parts = []
        self.in_anchor = False

    def _flush(self):
        if self.current_href:
            title = " ".join(self.anchor_parts).strip()
            context = " ".join(self.context_parts[-20:]).strip()
            if title:
                self.jobs[self.current_href] = {"title": title, "context": context}
        self.current_href = None
        self.anchor_parts = []
        self.context_parts = []
        self.in_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href") or ""
        if tag == "a" and re.search(r"/en/job-offers/[^?#]+", href):
            self._flush()
            self.current_href = href
            self.in_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current_href:
            return
        if self.in_anchor:
            self.anchor_parts.append(text)
        else:
            self.context_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False

    def close(self):
        super().close()
        self._flush()


def _socgen(url, max_seconds=30):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, html = client.get(url)
    parser = _SocGenJobs()
    parser.feed(html)
    parser.close()
    records = {}
    for href, item in parser.jobs.items():
        title = item.get("title") or ""
        context = item.get("context") or ""
        if not title:
            continue
        link = urljoin(final_url, href)
        identity = link.rstrip("/").rsplit("/", 1)[-1]
        countries = _country_names_from_text(context)
        location = context
        record = _record(
            "Societe Generale", identity, title, "Societe Generale",
            context or title, link,
            location=location, countries=countries,
            remote=bool(re.search(r"\b(remote|hybrid|telework)\b", context, re.I)),
        )
        records[record["id"]] = record
    if not records:
        raise ValueError("Societe Generale all-jobs page contained no extractable job links")
    return list(records.values())


class _EuroBrusselsList(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = {}
        self.current_href = None
        self.current_title = []
        self.current_parts = []
        self.in_job_anchor = False

    def _flush(self):
        if self.current_href:
            title = " ".join(self.current_title).strip()
            parts = [" ".join(str(x).split()) for x in self.current_parts if " ".join(str(x).split())]
            if title:
                self.jobs[self.current_href] = {"title": title, "parts": parts}
        self.current_href = None
        self.current_title = []
        self.current_parts = []
        self.in_job_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href")
        if tag == "a" and href and re.search(r"/job_display/\d+/", href):
            self._flush()
            self.current_href = href
            self.current_title = []
            self.current_parts = []
            self.in_job_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current_href:
            return
        if self.in_job_anchor:
            self.current_title.append(text)
        else:
            self.current_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_job_anchor:
            self.in_job_anchor = False

    def close(self):
        super().close()
        self._flush()


def _eurobrussels(url):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"EuroBrussels jobs page HTTP {status}")
    parser = _EuroBrusselsList()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = []
    for href, item in parser.jobs.items():
        title = item.get("title") or ""
        parts = item.get("parts") or []
        if not title:
            continue
        context = " ".join(parts[:24])
        company = parts[0] if parts else "EuroBrussels"
        location = parts[1] if len(parts) > 1 else ""
        link = urljoin(url, href)
        identity_match = re.search(r"/job_display/(\d+)/", link)
        identity = identity_match.group(1) if identity_match else link.rstrip("/").rsplit("/", 1)[-1]
        records.append(_record(
            "EuroBrussels", identity, title, company, context or title, link,
            date_posted=_relative_date(context),
            location=location,
            countries=_country_names_from_text(location),
            remote=bool(re.search(r"\bremote\b", context, re.I)),
        ))
    if not records:
        raise ValueError("EuroBrussels page contained no extractable job listings")
    return records


class _NextVenturesJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.current = None
        self.in_heading = False
        self.heading_parts = []

    def _flush(self):
        if self.current and self.current.get("ref") and self.current.get("title"):
            self.jobs.append(self.current)
        self.current = None
        self.in_heading = False
        self.heading_parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"h2","h3","h4","h5"} and self.current:
            self.in_heading = True
            self.heading_parts = []

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        match = re.search(r"\bRef:\s*#(\d+)\b", text, re.I)
        if match:
            self._flush()
            self.current = {"ref": match.group(1), "title": "", "context": []}
            return
        if not self.current:
            return
        if self.in_heading:
            self.heading_parts.append(text)
        else:
            self.current["context"].append(text)

    def handle_endtag(self, tag):
        if tag in {"h2","h3","h4","h5"} and self.in_heading:
            title = " ".join(self.heading_parts).strip()
            if title:
                self.current["title"] = title
            self.in_heading = False
            self.heading_parts = []

    def close(self):
        super().close()
        self._flush()


def _nextventures(url):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Next Ventures jobs page HTTP {status}")
    parser = _NextVenturesJobs()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = []
    for item in parser.jobs:
        ref = item["ref"]
        title = item["title"]
        context = " ".join(item.get("context") or [])
        countries = _country_names_from_text(context)
        employment = []
        for label in ("Contract","Permanent","Temporary","Freelance"):
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I):
                employment.append(label)
        records.append(_record(
            "Next Ventures", ref, title, "Next Ventures", context or title,
            f"{url}#ref-{ref}",
            location=context,
            countries=countries,
            remote=bool(re.search(r"\bremote\b", context, re.I)),
            employment_statuses=employment,
        ))
    if not records:
        raise ValueError("Next Ventures jobs page contained no extractable Ref listings")
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


def _atos_date(value):
    text = " ".join(str(value or "").split())
    for fmt in ("%b %d, %Y", "%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


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


def _rmk_page_url(base_url, startrow):
    base = str(base_url or "").split("?", 1)[0]
    if startrow:
        base = base.rstrip("/") + f"/{startrow}/"
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}q=&sortColumn=referencedate&sortDirection=desc"


def _rmk_records_from_html(html, base_url, provider, company):
    parser = _AtosJobsTable()
    parser.feed(html)
    link_parser = _RmkJobLinks()
    link_parser.feed(html)
    link_parser.close()

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

    records = {}
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
        records[record["id"]] = record
    return list(records.values())


def _rmk_jobs(base_url, provider, company):
    records = {}
    for startrow in range(0, 251, 50):
        url = _rmk_page_url(base_url, startrow)
        status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"{provider} jobs page HTTP {status}")
        page_records = _rmk_records_from_html(
            body.decode("utf-8", errors="replace"), base_url, provider, company
        )
        added = 0
        for record in page_records:
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0:
            break
        if len(page_records) < 50:
            break
    return list(records.values())


def _rmk_tile_jobs(base_url, provider, company, max_rows=500):
    origin = str(base_url or "").split("/viewalljobs", 1)[0].rstrip("/")
    records = {}
    for startrow in range(0, max_rows, 10):
        url = (
            f"{origin}/tile-search-results/?"
            f"q=&sortColumn=referencedate&sortDirection=desc&startrow={startrow}"
        )
        status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"{provider} RMK tile endpoint HTTP {status}")
        page_records = _rmk_records_from_html(
            body.decode("utf-8", errors="replace"), origin + "/", provider, company
        )
        added = 0
        for record in page_records:
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0:
            break
        if len(page_records) < 10:
            break
    return list(records.values())


def _rmk_browser_jobs(base_url, provider, company, max_seconds=22):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    records = {}
    for startrow in range(0, 251, 50):
        url = _rmk_page_url(base_url, startrow)
        _final_url, rendered_html, _meta = browser.render(url, deadline, client)
        page_records = _rmk_records_from_html(rendered_html, base_url, provider, company)
        added = 0
        for record in page_records:
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0:
            break
        if len(page_records) < 50:
            break
    return list(records.values())


def _atos(base_url):
    return _rmk_jobs(base_url, "Atos", "Atos")


def _worldline(base_url):
    records = _rmk_tile_jobs(base_url, "Worldline", "Worldline")
    if records:
        return records
    records = _rmk_jobs(base_url, "Worldline", "Worldline")
    if records:
        return records
    raise ValueError("Worldline public RMK endpoints reported vacancies but exposed no extractable jobs")

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
    if kind == "softgarden_feed":
        status, _content_type, body = _fetch(url, "application/json")
        if status != 200:
            raise RuntimeError(f"{name} public feed HTTP {status}")
        records = _softgarden_feed(json.loads(body.decode("utf-8", errors="replace")), name, url)
    elif kind == "eures":
        payload = _post_json(url, {
            "resultsPerPage": 100, "page": 1, "sortSearch": "MOST_RECENT", "keywords": [],
            "publicationPeriod": None, "occupationUris": [], "skillUris": [],
            "requiredExperienceCodes": [], "positionScheduleCodes": [], "sectorCodes": [],
            "educationAndQualificationLevelCodes": [], "positionOfferingCodes": [],
            "locationCodes": [], "euresFlagCodes": [], "otherBenefitsCodes": [],
            "requiredLanguages": [], "minNumberPost": None,
            "sessionId": "jscc-global-collection", "requestLanguage": "en",
        })
        records = _eures(payload)
    elif kind == "eu_careers":
        records = _eu_careers(url)
    elif kind == "remote_co":
        records = _remote_co(url)
    elif kind == "atos":
        records = _atos(url)
    elif kind == "worldline":
        records = _worldline(url)
    elif kind == "jobs4it":
        records = _jobs4it(url)
    elif kind == "landingjobs":
        records = _landing_jobs_api(url)
    elif kind == "eu_remote":
        records = _eu_remote_jobs(url, spec["feed_url"])
    elif kind == "nato_taleo":
        records = _nato_taleo(url, spec.get("portal", "101430233"), spec.get("section", "2"))
    elif kind == "eurobrussels":
        records = _eurobrussels(url)
    elif kind == "socgen":
        records = _socgen(url)
    elif kind == "softserve":
        records = _softserve(url)
    elif kind == "epam":
        records = _epam(url)
    elif kind == "rendered_links":
        records = _rendered_career_board(url, name, spec["job_path"])
    elif kind == "nextventures":
        records = _nextventures(url)
    elif kind == "linked_jobs":
        records = _linked_job_board(url, name, spec["job_path"])
    elif kind == "squareone":
        records = _squareone(url)
    elif kind == "prohuman":
        records = _prohuman(url)
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
                "remotive": _remotive,
            }[kind]
            records = parser(payload)
    return [engine.CollectionResult("public_board", kind, True, records, len(records))]
