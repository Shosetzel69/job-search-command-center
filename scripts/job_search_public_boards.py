"""Dedicated public-board adapters for stable no-auth JSON/RSS sources.

This module deliberately keeps provider-specific transport/normalization outside the
canonical filtering/FIT engine. It never bypasses login, CAPTCHA, robots or paywalls.
"""

import hashlib
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

BROWSER_REQUIRED_SOURCES = {"EPAM", "Mantu", "Serco Europe", "Prohuman", "GitHub", "Montreal Associates", "Fujitsu Belgium", "Dynamite Jobs", "HARMAN", "Vector Synergy", "Welcome to the Jungle", "Arc.dev", "Hubstaff Talent", "Torre", "Hirexa Solutions", "Float", "W Talent", "Lawrence Harvey"}

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
    "Remote.co": {"kind": "heading_list", "url": "https://remote.co/remote-jobs/project-manager", "default_remote": True},
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
    "Mantu": {"kind": "rendered_links", "url": "https://careers.mantu.com/jobs", "job_path": r"/brands/[^/?#]+/jobs/\d+"},
    "Serco Europe": {"kind": "rendered_links", "url": "https://careers.serco.com/eu/en/search-results", "job_path": r"/eu/en/job/\d+/[^/?#]+"},
    "Next Ventures": {"kind": "nextventures", "url": "https://next-ventures.com/jobs/"},
    "Hays Romania": {"kind": "linked_jobs", "url": "https://www.hays.ro/en/job-search", "job_path": r"/en/job-detail/[^?#]+"},
    "Square One Resources": {"kind": "squareone", "url": "https://www.squareoneresources.com/jobs"},
    "Proactive.IT": {"kind": "wordpress_archive", "url": "https://www.proactive.it/job-category/project-management-business-analysis/"},
    "PowerToFly": {"kind": "linked_jobs", "url": "https://powertofly.com/jobs/?only_html=True", "job_path": r"/jobs/detail/\d+"},
    "Wellfound": {"kind": "linked_jobs", "url": "https://wellfound.com/role/project-manager", "job_path": r"/jobs/\d+-[^?#]+"},
    "SkipTheDrive": {"kind": "linked_jobs", "url": "https://www.skipthedrive.com/job-category/remote-project-manager-jobs/", "job_path": r"/job/[^?#]+-\d+/"},
    "Prohuman": {"kind": "prohuman", "url": "https://www.prohuman.ro/locuri-de-munca"},
    "Source Group International": {"kind": "linked_jobs", "url": "https://www.sourcegroupinternational.com/candidate/", "job_path": r"/jobs/[^?#]+/"},
    "GitHub": {"kind": "rendered_links", "url": "https://www.github.careers/careers-home/jobs", "job_path": r"/careers-home/jobs/\d+"},
    "Brains Consulting": {"kind": "brains", "url": "https://www.brainsconsulting.ro/category/locuri-de-munca/"},
    "Montreal Associates": {"kind": "montreal_associates", "url": "https://www.montrealassociates.com/uk/candidates/job-search/"},
    "eJobs": {"kind": "ejobs", "url": "https://www.ejobs.ro/locuri-de-munca/bucuresti/it-project-manager"},
    "Trasys International": {"kind": "trasys_keyes", "url": "https://keyescareers.eu/find-my-job"},
    "KEYES / NRB": {"kind": "linked_jobs", "url": "https://keyescareers.eu/find-my-job", "job_path": r"/o/[^/?#]+"},
    "DailyRemote": {"kind": "dailyremote", "url": "https://dailyremote.com/remote-project-management-jobs"},
    "Jobspresso": {"kind": "rss", "url": "https://jobspresso.co/?feed=job_feed"},
    "awork.ro": {"kind": "awork", "url": "https://www.awork.ro/"},
    "Freelancer.com": {"kind": "freelancer_api", "url": "https://www.freelancer.com/api/projects/0.1/projects/active/?limit=100&or_search_query=project%20manager%20program%20manager%20programme%20manager%20scrum%20master%20delivery%20manager%20service%20manager"},
    "Fujitsu Belgium": {"kind": "rendered_links", "url": "https://www.jobs.global.fujitsu.com/search/?q=&locationsearch=Belgium&searchResultView=LIST", "job_path": r"/job/[^/?#]+/\d+-[A-Za-z_]+"},
    "No Fluff Jobs": {"kind": "linked_jobs", "url": "https://nofluffjobs.com/remote/project-manager", "job_path": r"/job/[^/?#]+"},
    "Flexa": {"kind": "heading_list", "url": "https://flexa.careers/jobs"},
    "Freelancermap": {"kind": "linked_jobs", "url": "https://www.freelancermap.com/projects", "job_path": r"/project/[^/?#]+"},
    "Dynamite Jobs": {"kind": "rendered_links", "url": "https://dynamitejobs.com/remote-jobs/management-operations/project-manager", "job_path": r"/company/[^/?#]+/remote-job/[^/?#]+"},
    "Just Join IT": {"kind": "linked_jobs", "url": "https://justjoin.it/job-offers/all-locations/pm?from=0", "job_path": r"/job-offer/[^/?#]+"},
    "Crossover": {"kind": "heading_list", "url": "https://www.crossover.com/jobs"},
    "JustRemote": {"kind": "heading_list", "url": "https://justremote.co/remote-project-manager-jobs", "default_remote": True},
    "Techjobs.be": {"kind": "heading_list", "url": "https://techjobs.be/en/ict-jobs", "default_country": "Belgia"},
    "Hipo": {"kind": "hipo", "url": "https://www.hipo.ro/locuri-de-munca/cautajob/Toate-Domeniile/Toate-Orasele/project-manager"},
    "Float": {"kind": "float_careers", "url": "https://www.float.com/careers"},
    "Eviden": {"kind": "eviden", "url": "https://eviden.com/careers/"},
    "HARMAN": {"kind": "rendered_links", "url": "https://jobs.harman.com/search-jobs/?orgIds=23226", "job_path": r"/job/[^/?#]+/[^/?#]+/23226/\d+"},
    "Vector Synergy": {"kind": "rendered_heading_list", "url": "https://www.vectorsynergy.com/job-board", "default_country": None},
    "Welcome to the Jungle": {"kind": "rendered_links", "url": "https://www.welcometothejungle.com/en/jobs?query=project%20manager", "job_path": r"/en/companies/[^/?#]+/jobs/[^/?#]+"},
    "PeoplePerHour": {"kind": "linked_jobs", "url": "https://www.peopleperhour.com/freelance-jobs?keyword=project%20manager", "job_path": r"/freelance-jobs/(?:[^/?#]+/)*[^/?#]+-\d+"},
    "Arc.dev": {"kind": "arc", "url": "https://arc.dev/remote-jobs?jobRoles=project_manager"},
    "eFinancialCareers": {"kind": "linked_jobs", "url": "https://www.efinancialcareers.com/jobs/project-manager", "job_path": r"/jobs-[^?#]+\.id\d+"},
    "Upwork": {"kind": "linked_jobs", "url": "https://www.upwork.com/freelance-jobs/project-management/", "job_path": r"/freelance-jobs/apply/[^/?#]+_~\d+/"},
    "Hubstaff Talent": {"kind": "rendered_links", "url": "https://hubstafftalent.net/search/jobs?search%5Bkeywords%5D=project%20manager", "job_path": r"/jobs/[^/?#]+"},
    "FlexJobs": {"kind": "heading_list", "url": "https://www.flexjobs.com/remote-jobs/project-manager"},
    "Torre": {"kind": "rendered_links", "url": "https://app.torre.ai/search-job?query=project%20manager", "job_path": r"(?:https://torre\.ai)?/post/[^/?#]+"},
    "Hirexa Solutions": {"kind": "hirexa", "url": "https://hirexa.com/careers/"},
    "Pangian": {"kind": "pangian_rss", "url": "https://pangian.com/feed/?post_type=job_listing"},
    "Worldpay / Global Payments": {"kind": "linked_jobs", "url": "https://jobs.globalpayments.com/jobs", "job_path": r"/en/jobs/r\d+/[^?#]+/?"},
    "Luxoft": {"kind": "linked_jobs", "url": "https://career.luxoft.com/jobs?country[]=Romania&perPage=60", "job_path": r"/jobs/[^/?#]+-\d+"},
    "Stripe": {"kind": "linked_jobs", "url": "https://stripe.com/careers/search", "job_path": r"/careers/listing/[^/?#]+/\d+"},
    "Cegeka": {"kind": "linked_jobs", "url": "https://www.cegeka.com/en/ro/jobs/all-jobs", "job_path": r"/en/ro/jobs/all-jobs/[^/?#]+-\d+"},
    "Computacenter": {"kind": "linked_jobs", "url": "https://careers.computacenter.com/ro/delivery-project-management", "job_path": r"/ro/offer/[^/?#]+/[0-9a-f-]+"},
    "RED Global": {"kind": "linked_jobs", "url": "https://redglobal.com/jobs", "job_path": r"/jobs/job/[^/?#]+/[A-Za-z0-9]+"},
    "Salt": {"kind": "linked_jobs", "url": "https://welovesalt.com/jobs", "job_path": r"/jobs/[^/?#]+-\d+"},
    "Lawrence Harvey": {"kind": "rendered_links", "url": "https://www.lawrenceharvey.com/candidates", "job_path": r"/jobs/\d+[A-Za-z0-9-]+"},
    "W Talent": {"kind": "rendered_heading_list", "url": "https://www.wtalent.com/uk/job-search/"},
    "Thaleria": {"kind": "linked_jobs", "url": "https://www.thaleria.com/careers/open-positions", "job_path": r"/careers/positions/[^/?#]+-\d+"},
}


class _HeadingListJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.current = None
        self.in_heading = False
        self.heading_parts = []

    def _flush(self):
        if self.current:
            title = " ".join(self.current.get("title_parts") or []).strip()
            context = " ".join(self.current.get("context_parts") or []).strip()
            if title:
                self.jobs.append({"title": title, "context": context})
        self.current = None
        self.in_heading = False
        self.heading_parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"h2","h3","h4"}:
            self._flush()
            self.current = {"title_parts": [], "context_parts": []}
            self.in_heading = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current:
            return
        if self.in_heading:
            self.current["title_parts"].append(text)
        else:
            self.current["context_parts"].append(text)

    def handle_endtag(self, tag):
        if tag in {"h2","h3","h4"} and self.in_heading:
            self.in_heading = False

    def close(self):
        super().close()
        self._flush()


_HEADING_LIST_NOISE = {
    "featured", "all listings", "applicant locations", "filters", "technology",
    "receive our latest jobs to your inbox", "search and find it jobs in belgium",
}


def _heading_list_board(url, provider, *, default_remote=False, default_country=None):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"{provider} public list HTTP {status}")
    parser = _HeadingListJobs()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = {}
    for item in parser.jobs:
        title = plain_text(item.get("title") or "")
        context = plain_text(item.get("context") or "")
        if not title or title.casefold() in _HEADING_LIST_NOISE:
            continue
        # Require some job-like context to avoid page-section headings.
        if provider == "JustRemote":
            company_match = re.match(r"^(.+?)\s+(?:permanent|contract|freelance|full[- ]time|part[- ]time)\b", context, re.I)
            company = company_match.group(1).strip() if company_match else provider
        elif provider == "Vector Synergy":
            company = provider
        else:
            parts = [part.strip() for part in re.split(r"\s{2,}|\u00a0+", context) if part.strip()]
            company = parts[0] if parts else provider

        countries = _country_names_from_text(context)
        if default_country and not countries:
            countries = [default_country]
        remote = bool(default_remote or re.search(r"\b(remote|fully remote|remote friendly|hybrid)\b", context, re.I))
        employment = [
            label for label in ("Permanent","Contract","Freelance","Full Time","Part Time")
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I)
        ]
        identity_basis = "|".join([provider.casefold(), title.casefold(), company.casefold()])
        identity = hashlib.sha1(identity_basis.encode("utf-8")).hexdigest()[:20]
        record = _record(
            provider, identity, title, company, context or title, url,
            location=context,
            countries=countries,
            remote=remote,
            employment_statuses=employment,
        )
        records[record["id"]] = record
    if not records:
        raise ValueError(f"{provider} public list contained no extractable jobs")
    return list(records.values())


class _HipoListJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.current = None
        self.in_heading = False
        self.title_parts = []

    def _flush(self):
        if self.current:
            title = " ".join(self.current.get("title_parts") or []).strip()
            parts = [p for p in self.current.get("parts") or [] if p]
            if title and parts:
                self.jobs.append({"title": title, "parts": parts})
        self.current = None
        self.in_heading = False
        self.title_parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"h2","h3","h4"}:
            self._flush()
            self.current = {"title_parts": [], "parts": []}
            self.in_heading = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current:
            return
        if self.in_heading:
            self.current["title_parts"].append(text)
        else:
            self.current["parts"].append(text)

    def handle_endtag(self, tag):
        if tag in {"h2","h3","h4"} and self.in_heading:
            self.in_heading = False

    def close(self):
        super().close()
        self._flush()


def _hipo(url):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Hipo jobs page HTTP {status}")
    parser = _HipoListJobs()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = {}
    for item in parser.jobs:
        title = plain_text(item.get("title") or "")
        if not title or title.casefold().startswith(("locuri de munca", "joburi ")):
            continue
        parts = [plain_text(x) for x in item.get("parts") or [] if plain_text(x)]
        if not parts:
            continue
        company = parts[0] if parts else "Hipo"
        context = " ".join(parts[:12])
        date_match = re.search(r"\b(\d{2})-(\d{2})-(\d{4})\b", context)
        date_posted = None
        if date_match:
            try:
                date_posted = datetime(
                    int(date_match.group(3)), int(date_match.group(2)), int(date_match.group(1)),
                    tzinfo=timezone.utc,
                ).isoformat()
            except ValueError:
                date_posted = None
        identity_basis = "|".join([title.casefold(), company.casefold(), context.casefold()])
        identity = hashlib.sha1(identity_basis.encode("utf-8")).hexdigest()[:20]
        remote = bool(re.search(r"\b(remote|hybrid|hibrid)\b", context, re.I))
        records[identity] = _record(
            "Hipo", identity, title, company, context or title, url,
            date_posted=date_posted,
            location=context,
            countries=["Romania"],
            remote=remote,
        )
    if not records:
        raise ValueError("Hipo project-manager search contained no extractable jobs")
    return list(records.values())


class _FloatCareers(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_h2 = False
        self.h2_parts = []
        self.in_roles = False
        self.current_href = None
        self.current_parts = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h2":
            self.in_h2 = True
            self.h2_parts = []
        elif self.in_roles and tag == "a" and attrs.get("href"):
            self.current_href = attrs["href"]
            self.current_parts = []

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        if self.in_h2:
            self.h2_parts.append(text)
        elif self.current_href:
            self.current_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "h2" and self.in_h2:
            heading = " ".join(self.h2_parts).strip().casefold()
            self.in_roles = heading == "current open roles"
            self.in_h2 = False
            self.h2_parts = []
        elif tag == "a" and self.current_href:
            title = " ".join(self.current_parts).strip()
            if title:
                self.links.append((self.current_href, title))
            self.current_href = None
            self.current_parts = []


def _heading_list_records_from_html(html, url, provider, *, default_remote=False, default_country=None):
    parser = _HeadingListJobs()
    parser.feed(html)
    parser.close()
    records = {}
    for item in parser.jobs:
        title = plain_text(item.get("title") or "")
        context = plain_text(item.get("context") or "")
        if not title or title.casefold() in _HEADING_LIST_NOISE:
            continue
        if provider == "JustRemote":
            company_match = re.match(r"^(.+?)\s+(?:permanent|contract|freelance|full[- ]time|part[- ]time)\b", context, re.I)
            company = company_match.group(1).strip() if company_match else provider
        else:
            parts = [part.strip() for part in re.split(r"\s{2,}|\u00a0+", context) if part.strip()]
            company = parts[0] if parts else provider
        countries = _country_names_from_text(context)
        if default_country and not countries:
            countries = [default_country]
        remote = bool(default_remote or re.search(r"\b(remote|fully remote|remote friendly|hybrid|off-site)\b", context, re.I))
        employment = [
            label for label in ("Permanent","Contract","Freelance","Full Time","Part Time")
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I)
        ]
        identity_basis = "|".join([provider.casefold(), title.casefold(), company.casefold()])
        identity = hashlib.sha1(identity_basis.encode("utf-8")).hexdigest()[:20]
        record = _record(
            provider, identity, title, company, context or title, url,
            location=context,
            countries=countries,
            remote=remote,
            employment_statuses=employment,
        )
        records[record["id"]] = record
    if not records:
        raise ValueError(f"{provider} public list contained no extractable jobs")
    return list(records.values())


def _rendered_heading_list_board(url, provider, *, default_remote=False, default_country=None, max_seconds=20):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, rendered_html, _meta = browser.render(url, deadline, client)
    return _heading_list_records_from_html(
        rendered_html, final_url, provider,
        default_remote=default_remote,
        default_country=default_country,
    )


def _float_careers(url, max_seconds=20):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, html, _meta = browser.render(url, deadline, client)
    if not re.search(r"Current\s+open\s+roles", html, re.I):
        raise ValueError("Float careers page missing authoritative Current open roles section")
    parser = _FloatCareers()
    parser.feed(html)
    parser.close()
    records = {}
    for href, title in parser.links:
        if re.search(r"general application|hiring process|blog", title, re.I):
            continue
        link = urljoin(final_url, href)
        identity = hashlib.sha1(link.encode("utf-8")).hexdigest()[:20]
        records[identity] = _record(
            "Float", identity, title, "Float", title, link,
            location="Remote", countries=[], remote=True,
        )
    # Empty is legitimate only because the authoritative section itself was found.
    return list(records.values())

class _EvidenCareers(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.in_item = False
        self.parts = []
        self.current_title = None

    def handle_starttag(self, tag, attrs):
        # Eviden renders the results as semantic list/card blocks but markup can vary.
        attrs = dict(attrs)
        cls = " ".join(attrs.get("class", []) if isinstance(attrs.get("class"), list) else [str(attrs.get("class") or "")])
        if tag in {"li","article"} or (tag == "div" and re.search(r"job|result|vacancy", cls, re.I)):
            if self.in_item and self.parts:
                self._flush()
            self.in_item = True
            self.parts = []

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if text and self.in_item:
            self.parts.append(text)

    def handle_endtag(self, tag):
        if self.in_item and tag in {"li","article"}:
            self._flush()

    def _flush(self):
        text = " ".join(self.parts).strip()
        if text:
            self.jobs.append(text)
        self.in_item = False
        self.parts = []

    def close(self):
        if self.in_item and self.parts:
            self._flush()
        super().close()


def _eviden(url):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Eviden careers page HTTP {status}")
    html = body.decode("utf-8", errors="replace")

    # Prefer explicit list/card blocks when present.
    parser = _EvidenCareers()
    parser.feed(html)
    parser.close()
    candidates = list(parser.jobs)

    # Fallback for the current careers markup/text shape:
    # "<title> <Mon d, YYYY> <city>, <country> <experience>"
    if not candidates:
        text = plain_text(html)
        pattern = re.compile(
            r"(?P<title>.{3,160}?)\s+"
            r"(?P<date>(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})\s+"
            r"(?P<location>.{2,120}?)\s+"
            r"(?P<experience>Experienced|Internship|Entry Level|Graduate|Professional)\b",
            re.I,
        )
        candidates = [" | ".join(m.groupdict().values()) for m in pattern.finditer(text)]

    records = {}
    for raw in candidates:
        context = plain_text(raw)
        if not context:
            continue
        match = re.search(
            r"(?P<title>.+?)\s*(?:\||\s)"
            r"(?P<date>(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})"
            r"\s*(?:\||\s)(?P<location>.+?)\s*(?:\||\s)"
            r"(?P<experience>Experienced|Internship|Entry Level|Graduate|Professional)\b",
            context,
            re.I,
        )
        if not match:
            continue
        title = plain_text(match.group("title"))
        location = plain_text(match.group("location"))
        published = _atos_date(match.group("date"))
        experience = plain_text(match.group("experience"))
        if not title or not location:
            continue
        identity_basis = "|".join([title.casefold(), location.casefold(), str(published or "")])
        identity = hashlib.sha1(identity_basis.encode("utf-8")).hexdigest()[:20]
        record = _record(
            "Eviden", identity, title, "Eviden",
            f"{title} {location} {experience}", url,
            date_posted=published,
            location=location,
            countries=_country_names_from_text(location),
            remote=bool(re.search(r"\b(remote|hybrid)\b", location, re.I)),
        )
        records[record["id"]] = record

    if not records:
        raise ValueError("Eviden careers page contained no extractable job listings")
    return list(records.values())


class _ArcJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.recent = []
        self.current = None
        self.in_heading = False

    def _flush(self):
        if self.current:
            title = " ".join(self.current.get("title_parts") or []).strip()
            context = " ".join(self.current.get("context_parts") or []).strip()
            prefix = list(self.current.get("prefix") or [])
            if title:
                self.jobs.append({"title": title, "context": context, "prefix": prefix})
        self.current = None
        self.in_heading = False

    def handle_starttag(self, tag, attrs):
        if tag in {"h2","h3","h4"}:
            self._flush()
            self.current = {
                "title_parts": [],
                "context_parts": [],
                "prefix": list(self.recent[-4:]),
            }
            self.in_heading = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        self.recent.append(text)
        self.recent = self.recent[-8:]
        if not self.current:
            return
        if self.in_heading:
            self.current["title_parts"].append(text)
        else:
            self.current["context_parts"].append(text)

    def handle_endtag(self, tag):
        if tag in {"h2","h3","h4"} and self.in_heading:
            self.in_heading = False

    def close(self):
        super().close()
        self._flush()


_ARC_NOISE = {
    "remote project manager jobs", "find remote project manager jobs around the world",
    "sort by", "filters", "project manager",
}


def _arc(url, max_seconds=20):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, rendered_html, _meta = browser.render(url, deadline, client)
    parser = _ArcJobs()
    parser.feed(rendered_html)
    parser.close()
    records = {}
    for item in parser.jobs:
        title = plain_text(item.get("title") or "")
        if not title or title.casefold() in _ARC_NOISE:
            continue
        context = plain_text(item.get("context") or "")
        prefix = [plain_text(x) for x in item.get("prefix") or [] if plain_text(x)]
        # Card layout normally places company immediately before the title.
        company = "Arc.dev"
        for candidate in reversed(prefix):
            if candidate.casefold() in _ARC_NOISE:
                continue
            if re.search(r"\b(remote|full[- ]time|part[- ]time|manager|project management)\b", candidate, re.I):
                continue
            if len(candidate) <= 120:
                company = candidate
                break
        combined = " ".join(prefix[-2:] + [context])
        employment = [
            label for label in ("Full-time","Part-time","Freelance","Contract")
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", combined, re.I)
        ]
        countries = _country_names_from_text(combined)
        identity_basis = "|".join([title.casefold(), company.casefold(), combined.casefold()])
        identity = hashlib.sha1(identity_basis.encode("utf-8")).hexdigest()[:20]
        records[identity] = _record(
            "Arc.dev", identity, title, company, combined or title, final_url,
            date_posted=_relative_date(combined),
            location=combined,
            countries=countries,
            remote=True,
            employment_statuses=employment,
        )
    if not records:
        raise ValueError("Arc.dev project-manager page contained no extractable jobs")
    return list(records.values())


class _HirexaOpenPositions(HTMLParser):
    """Recognize an explicitly empty Hirexa open-positions section.

    Fail closed if named positions appear without a stable public detail route.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_heading = False
        self.heading_parts = []
        self.in_positions = False
        self.saw_search_job = False
        self.saw_apply_new = False
        self.position_headings = []

    def handle_starttag(self, tag, attrs):
        if tag in {"h1", "h2", "h3", "h4"}:
            self.in_heading = True
            self.heading_parts = []

    def handle_data(self, data):
        if self.in_heading:
            text = " ".join(str(data or "").split())
            if text:
                self.heading_parts.append(text)

    def handle_endtag(self, tag):
        if tag not in {"h1", "h2", "h3", "h4"} or not self.in_heading:
            return
        heading = " ".join(self.heading_parts).strip()
        folded = heading.casefold()
        if folded == "search job":
            self.saw_search_job = True
            self.in_positions = True
        elif folded == "apply new":
            self.saw_apply_new = True
            self.in_positions = False
        elif self.in_positions and heading and folded != "open positions":
            self.position_headings.append(heading)
        self.in_heading = False
        self.heading_parts = []


def _hirexa(url, max_seconds=20):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    _final_url, rendered_html, _meta = browser.render(url, deadline, client)
    parser = _HirexaOpenPositions()
    parser.feed(rendered_html)
    parser.close()
    if not parser.saw_search_job or not parser.saw_apply_new:
        raise ValueError("Hirexa careers page did not expose the expected open-positions boundary")
    if parser.position_headings:
        raise ValueError(
            "Hirexa careers page exposes named positions without a stable public detail enumeration: "
            + ", ".join(parser.position_headings[:5])
        )
    return []


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


def _montreal_date(context):
    match = re.search(r"\bPosted:\s*(\d{2})/(\d{2})/(\d{4})\b", str(context or ""), re.I)
    if not match:
        return None
    try:
        return datetime(
            int(match.group(3)), int(match.group(2)), int(match.group(1)), tzinfo=timezone.utc
        ).isoformat()
    except ValueError:
        return None


def _montreal_associates(url, max_details=40, max_seconds=30):
    deadline = time.monotonic() + max_seconds
    client = PublicClient(deadline)
    final_url, rendered_html, _meta = browser.render(url, deadline, client)
    links = _JobLinkCollector(r"/(?:uk|it|de|es|ca|fr)/candidates/job/[^/?#]+/?")
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
        if not title:
            continue
        ref_match = re.search(r"\b(006P[A-Za-z0-9]+_\d+)\b", context)
        identity = ref_match.group(1) if ref_match else detail_url.rstrip("/").rsplit("/", 1)[-1]
        employment = [
            label for label in ("Contract/Freelance", "Permanent", "Contract", "Freelance", "Temporary")
            if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I)
        ]
        records[identity] = _record(
            "Montreal Associates", identity, title, "Montreal Associates", context or title, detail_url,
            date_posted=_montreal_date(context),
            location=context,
            countries=_country_names_from_text(context),
            remote=bool(re.search(r"\b(remote|hybrid)\b", context, re.I)),
            employment_statuses=employment,
        )
    if not records:
        raise ValueError("Montreal Associates rendered job search contained no extractable jobs")
    return list(records.values())


class _EjobsList(HTMLParser):
    JOB_PATH = re.compile(r"/user/locuri-de-munca/[^/?#]+/\d+", re.I)

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.current = None
        self.in_job_anchor = False
        self.recent = []

    def _flush(self):
        if self.current:
            title = " ".join(self.current["title_parts"]).strip()
            if title:
                self.current["title"] = title
                self.jobs.append(self.current)
        self.current = None
        self.in_job_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = str(attrs.get("href") or "")
        if tag == "a" and href and self.JOB_PATH.search(href):
            self._flush()
            self.current = {
                "href": href,
                "title_parts": [],
                "after_parts": [],
                "prefix_parts": list(self.recent[-3:]),
            }
            self.in_job_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text:
            return
        self.recent.append(text)
        self.recent = self.recent[-6:]
        if not self.current:
            return
        if self.in_job_anchor:
            self.current["title_parts"].append(text)
        else:
            self.current["after_parts"].append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_job_anchor:
            self.in_job_anchor = False

    def close(self):
        super().close()
        self._flush()


_EJOBS_MONTHS = {
    "ian": 1, "feb": 2, "mar": 3, "apr": 4, "mai": 5, "iun": 6,
    "iul": 7, "aug": 8, "sept": 9, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _ejobs_date(text):
    match = re.search(
        r"\b(\d{1,2})\s+(Ian|Feb|Mar|Apr|Mai|Iun|Iul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{4})\b",
        str(text or ""), re.I,
    )
    if not match:
        return None
    month = _EJOBS_MONTHS.get(match.group(2).casefold())
    if not month:
        return None
    try:
        return datetime(int(match.group(3)), month, int(match.group(1)), tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _ejobs_page_url(base_url, page):
    base = str(base_url or "").rstrip("/")
    return base if page == 1 else f"{base}/pagina{page}"


def _ejobs(base_url, max_pages=3):
    records = {}
    for page in range(1, max_pages + 1):
        page_url = _ejobs_page_url(base_url, page)
        status, _kind, body = _fetch(page_url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"eJobs results page HTTP {status}")
        parser = _EjobsList()
        parser.feed(body.decode("utf-8", errors="replace"))
        parser.close()
        added = 0
        for item in parser.jobs:
            href = item.get("href") or ""
            title = item.get("title") or ""
            after = [x for x in item.get("after_parts") or [] if x]
            prefix = [x for x in item.get("prefix_parts") or [] if x]
            if not href or not title:
                continue
            link = urljoin(page_url, href)
            id_match = re.search(r"/(\d+)(?:[/?#]|$)", link)
            identity = id_match.group(1) if id_match else link.rstrip("/").rsplit("/", 1)[-1]
            company = after[0] if after else "eJobs"
            context = " ".join(prefix + after[:20])
            record = _record(
                "eJobs", identity, title, company, context or title, link,
                date_posted=_ejobs_date(context),
                location=context,
                countries=_country_names_from_text(context) or ["Romania"],
                remote=bool(re.search(r"\b(remote|de acasa|hibrid|hybrid)\b", context, re.I)),
            )
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0:
            break
    if not records:
        raise ValueError("eJobs public results contained no extractable jobs")
    return list(records.values())


def _trasys_keyes(url):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"KEYES careers page HTTP {status}")
    parser = _RenderedCareerJobs(r"/o/[^/?#]+")
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = {}
    for href, item in parser.jobs.items():
        title = item.get("title") or ""
        context = item.get("context") or ""
        if not title or not re.search(r"\bTrasys International\b", context, re.I):
            continue
        link = urljoin(url, href)
        identity = link.rstrip("/").rsplit("/", 1)[-1]
        record = _record(
            "Trasys International", identity, title, "Trasys International",
            context or title, link,
            location=context,
            countries=_country_names_from_text(context),
            remote=bool(re.search(r"\b(remote|hybrid)\b", context, re.I)),
        )
        records[record["id"]] = record
    if not records:
        raise ValueError("KEYES careers page contained no Trasys International jobs")
    return list(records.values())


class _DailyRemoteList(HTMLParser):
    JOB_PATH = re.compile(r"/remote-job/[^/?#]+-(\d+)", re.I)

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.current = None
        self.in_anchor = False

    def _flush(self):
        if self.current:
            title = " ".join(self.current["title_parts"]).strip()
            if title:
                self.current["title"] = title
                self.jobs.append(self.current)
        self.current = None
        self.in_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = str(attrs.get("href") or "")
        match = self.JOB_PATH.search(href)
        if tag == "a" and match:
            self._flush()
            self.current = {
                "href": href,
                "id": match.group(1),
                "title_parts": [],
                "after_parts": [],
            }
            self.in_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current:
            return
        if self.in_anchor:
            self.current["title_parts"].append(text)
        else:
            self.current["after_parts"].append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False

    def close(self):
        super().close()
        self._flush()


def _dailyremote_company(context):
    text = " ".join(str(context or "").split())
    if not text:
        return "DailyRemote"
    marker = re.search(
        r"\b(?:Full Time|Part Time|Contract|Freelance|Internship|"
        r"\d+\s+(?:Minutes?|Hours?|Days?|Weeks?|Months?)\s+Ago|Today|Yesterday)\b",
        text,
        re.I,
    )
    company = text[:marker.start()].strip(" ·|-") if marker else text
    return company or "DailyRemote"


def _dailyremote_page_url(base_url, page):
    if page <= 1:
        return base_url
    sep = "&" if "?" in base_url else "?"
    return f"{base_url}{sep}page={page}"


def _dailyremote(base_url, max_pages=3):
    records = {}
    for page in range(1, max_pages + 1):
        page_url = _dailyremote_page_url(base_url, page)
        status, _kind, body = _fetch(page_url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"DailyRemote jobs page HTTP {status}")
        parser = _DailyRemoteList()
        parser.feed(body.decode("utf-8", errors="replace"))
        parser.close()
        added = 0
        for item in parser.jobs:
            title = item.get("title") or ""
            href = item.get("href") or ""
            after = [x for x in item.get("after_parts") or [] if x]
            if not title or not href:
                continue
            link = urljoin(page_url, href)
            context = " ".join(after[:24])
            company = _dailyremote_company(context)
            employment = [
                label for label in ("Full Time", "Part Time", "Contract", "Freelance", "Internship")
                if re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", context, re.I)
            ]
            countries = _country_names_from_text(context)
            record = _record(
                "DailyRemote", item["id"], title, company, context or title, link,
                date_posted=_relative_date(context),
                location=context,
                countries=countries,
                remote=True,
                employment_statuses=employment,
            )
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0:
            break
    if not records:
        raise ValueError("DailyRemote project-management page contained no extractable jobs")
    return list(records.values())


_AWORK_TARGET_ROLE = re.compile(
    r"\b(project manager|program manager|programme manager|delivery manager|"
    r"technical project manager|it project manager|scrum master|service manager)\b",
    re.I,
)


def _awork_page_url(base_url, page):
    base = str(base_url or "").rstrip("/")
    return base if page <= 1 else f"{base}/page-{page}"


def _awork_date(context):
    text = str(context or "")
    month_map = {
        "jan":1,"feb":2,"mar":3,"apr":4,"may":5,"mai":5,"jun":6,"iun":6,
        "jul":7,"iul":7,"aug":8,"sep":9,"sept":9,"oct":10,"nov":11,"dec":12,
    }
    match = re.search(
        r"\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Mai|Jun|Iun|Jul|Iul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{4})\b",
        text, re.I,
    )
    if not match:
        return None
    month = month_map.get(match.group(2).casefold())
    try:
        return datetime(int(match.group(3)), month, int(match.group(1)), tzinfo=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _awork(base_url, max_pages=3):
    records = {}
    for page in range(1, max_pages + 1):
        page_url = _awork_page_url(base_url, page)
        status, _kind, body = _fetch(page_url, "text/html,application/xhtml+xml")
        if status != 200:
            raise RuntimeError(f"awork.ro page HTTP {status}")
        parser = _RenderedCareerJobs(r"/[^/?#]+/id-\d+")
        parser.feed(body.decode("utf-8", errors="replace"))
        parser.close()
        added = 0
        for href, item in parser.jobs.items():
            title = item.get("title") or ""
            context = item.get("context") or ""
            if not title or not _AWORK_TARGET_ROLE.search(title):
                continue
            link = urljoin(page_url, href)
            id_match = re.search(r"/id-(\d+)(?:[/?#]|$)", link)
            identity = id_match.group(1) if id_match else link.rstrip("/").rsplit("/",1)[-1]
            company_match = re.search(r"postat\s+de\s+(.+?)\s+în\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}", context, re.I)
            company = company_match.group(1).strip() if company_match else "awork.ro"
            record = _record(
                "awork.ro", identity, title, company, context or title, link,
                date_posted=_awork_date(context),
                location=context,
                countries=_country_names_from_text(context) or ["Romania"],
                remote=bool(re.search(r"\b(remote|hibrid|hybrid)\b", context, re.I)),
            )
            if record["id"] not in records:
                records[record["id"]] = record
                added += 1
        if added == 0 and page >= 2:
            break
    if not records:
        raise ValueError("awork.ro bounded pages contained no target-role jobs")
    return list(records.values())


def _freelancer_api(payload):
    if not isinstance(payload, dict):
        raise ValueError("Freelancer API response must be an object")
    result = payload.get("result")
    projects = result.get("projects") if isinstance(result, dict) else None
    if not isinstance(projects, list):
        raise ValueError("Freelancer API response missing result.projects[]")
    records = []
    for item in projects:
        if not isinstance(item, dict):
            continue
        project_id = item.get("id")
        title = str(item.get("title") or "").strip()
        if not project_id or not title:
            continue
        description = str(item.get("description") or title).strip()
        seo_url = str(item.get("seo_url") or item.get("url") or "").strip()
        if seo_url.startswith(("http://","https://")):
            source_url = seo_url
        elif seo_url:
            source_url = urljoin("https://www.freelancer.com/projects/", seo_url.lstrip("/"))
        else:
            source_url = f"https://www.freelancer.com/projects/{project_id}"

        budget = item.get("budget") if isinstance(item.get("budget"), dict) else {}
        currency = item.get("currency") if isinstance(item.get("currency"), dict) else {}
        budget_parts = []
        minimum, maximum = budget.get("minimum"), budget.get("maximum")
        code = str(currency.get("code") or "").strip()
        if minimum is not None or maximum is not None:
            budget_parts.append(
                f"Budget {minimum if minimum is not None else '?'}-"
                f"{maximum if maximum is not None else '?'} {code}".strip()
            )

        skills = []
        for job in item.get("jobs") or []:
            if isinstance(job, dict) and job.get("name"):
                skills.append(str(job["name"]).strip())
        if skills:
            budget_parts.append("Skills: " + ", ".join(skills[:20]))

        project_type = str(item.get("type") or "").strip()
        employment = ["Freelance"]
        if project_type:
            employment.append(project_type)

        records.append(_record(
            "Freelancer.com",
            str(project_id),
            title,
            "Freelancer.com",
            " ".join([description] + budget_parts),
            source_url,
            date_posted=_epoch_iso(item.get("submitdate")),
            location="Remote",
            countries=[],
            remote=True,
            employment_statuses=employment,
        ))
    if not records:
        raise ValueError("Freelancer API returned no extractable active projects")
    return records


class _WordpressArchiveJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.current = None
        self.in_heading = False
        self.in_anchor = False

    def _flush(self):
        if self.current and self.current.get("href"):
            title = " ".join(self.current.get("title_parts") or []).strip()
            context = " ".join(self.current.get("context_parts") or []).strip()
            if title:
                self.jobs.append({"href": self.current["href"], "title": title, "context": context})
        self.current = None
        self.in_heading = False
        self.in_anchor = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"h2", "h3"}:
            self._flush()
            self.current = {"href": None, "title_parts": [], "context_parts": []}
            self.in_heading = True
        elif self.current and self.in_heading and tag == "a" and attrs.get("href"):
            self.current["href"] = attrs["href"]
            self.in_anchor = True

    def handle_data(self, data):
        text = " ".join(str(data or "").split())
        if not text or not self.current:
            return
        if self.in_heading:
            self.current["title_parts"].append(text)
        else:
            self.current["context_parts"].append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False
        elif tag in {"h2", "h3"} and self.in_heading:
            self.in_heading = False

    def close(self):
        super().close()
        self._flush()


def _wordpress_archive(url, provider):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"{provider} archive HTTP {status}")
    parser = _WordpressArchiveJobs()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    records = {}
    for item in parser.jobs:
        title = plain_text(item.get("title") or "")
        context = plain_text(item.get("context") or "")
        if not title:
            continue
        if re.search(
            r"Rolul este inchis|NU mai sunt locuri vacante|TOATE LOCURILE DE MUNCA VACANTE AU FOST OCUPATE",
            context, re.I,
        ):
            continue
        link = urljoin(url, item["href"])
        identity = link.rstrip("/").rsplit("/", 1)[-1]
        records[identity] = _record(
            provider, identity, title, provider, context or title, link,
            date_posted=_relative_date(context),
            location=context,
            countries=_country_names_from_text(context),
            remote=bool(re.search(r"\b(remote|hybrid|online|hibrid)\b", context, re.I)),
        )
    if not records:
        raise ValueError(f"{provider} archive contained no open extractable jobs")
    return list(records.values())


class _BrainsCategoryJobs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jobs = []
        self.in_heading = False
        self.current_href = None
        self.title_parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"h2","h3"}:
            self.in_heading = True
            self.current_href = None
            self.title_parts = []
        elif self.in_heading and tag == "a" and attrs.get("href"):
            self.current_href = attrs["href"]

    def handle_data(self, data):
        if self.in_heading:
            text = " ".join(str(data or "").split())
            if text:
                self.title_parts.append(text)

    def handle_endtag(self, tag):
        if tag in {"h2","h3"} and self.in_heading:
            title = " ".join(self.title_parts).strip()
            if self.current_href and title:
                self.jobs.append((self.current_href, title))
            self.in_heading = False
            self.current_href = None
            self.title_parts = []


def _brains(url, max_details=80):
    status, _kind, body = _fetch(url, "text/html,application/xhtml+xml")
    if status != 200:
        raise RuntimeError(f"Brains Consulting jobs category HTTP {status}")
    html = body.decode("utf-8", errors="replace")
    links = _JobLinkCollector(
        r"(?:https?://www\.brainsconsulting\.ro)?/(?!category/|tag/|author/|page/|despre-noi/|servicii/|candidati/|cursuri/|blog/|contact/?$|$)[^/?#]+/?$"
    )
    links.feed(html)
    records = {}
    for href in links.links[:max_details]:
        link = urljoin(url, href)
        try:
            detail_status, _detail_kind, detail_body = _fetch(link, "text/html,application/xhtml+xml")
        except Exception:
            continue
        if detail_status != 200:
            continue
        detail = _JobDetailPage()
        detail.feed(detail_body.decode("utf-8", errors="replace"))
        title = detail.title
        context = detail.text
        if not title or not re.search(r"Brains Consulting|BRAINS CONSULTING|recruteaz", context, re.I):
            continue
        if re.search(
            r"Rolul este inchis|NU mai sunt locuri vacante|TOATE LOCURILE DE MUNCA VACANTE AU FOST OCUPATE",
            context, re.I,
        ):
            continue
        identity = link.rstrip("/").rsplit("/", 1)[-1]
        records[identity] = _record(
            "Brains Consulting", identity, title, "Brains Consulting", context or title, link,
            location=context,
            countries=_country_names_from_text(context),
            remote=bool(re.search(r"\b(remote|hybrid|online|hibrid)\b", context, re.I)),
        )
    if not records:
        raise ValueError("Brains Consulting category contained no open extractable jobs")
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


def _pangian_feed(body, url):
    records = _rss(body, "Pangian", url)
    if not records:
        raise ValueError("Pangian feed contained no current job records; outage/empty state is not authoritative")
    return records


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
            "resultsPerPage": 100, "page": 1, "sortSearch": "MOST_RECENT",
            "keywords": [{"keyword": "project manager", "specificSearchCode": "EVERYWHERE"}],
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
    elif kind == "hirexa":
        records = _hirexa(url)
    elif kind == "rendered_links":
        records = _rendered_career_board(url, name, spec["job_path"])
    elif kind == "heading_list":
        records = _heading_list_board(url, name, default_remote=spec.get("default_remote", False), default_country=spec.get("default_country"))
    elif kind == "rendered_heading_list":
        records = _rendered_heading_list_board(url, name, default_remote=spec.get("default_remote", False), default_country=spec.get("default_country"))
    elif kind == "hipo":
        records = _hipo(url)
    elif kind == "float_careers":
        records = _float_careers(url)
    elif kind == "eviden":
        records = _eviden(url)
    elif kind == "arc":
        records = _arc(url)
    elif kind == "nextventures":
        records = _nextventures(url)
    elif kind == "linked_jobs":
        records = _linked_job_board(url, name, spec["job_path"])
    elif kind == "squareone":
        records = _squareone(url)
    elif kind == "prohuman":
        records = _prohuman(url)
    elif kind == "brains":
        records = _brains(url)
    elif kind == "wordpress_archive":
        records = _wordpress_archive(url, name)
    elif kind == "montreal_associates":
        records = _montreal_associates(url)
    elif kind == "ejobs":
        records = _ejobs(url)
    elif kind == "trasys_keyes":
        records = _trasys_keyes(url)
    elif kind == "dailyremote":
        records = _dailyremote(url)
    elif kind == "awork":
        records = _awork(url)
    elif kind == "freelancer_api":
        status, _content_type, body = _fetch(url, "application/json")
        if status != 200:
            raise RuntimeError(f"Freelancer public API HTTP {status}")
        records = _freelancer_api(json.loads(body.decode("utf-8", errors="replace")))
    else:
        accept = "application/json" if kind not in {"rss", "pangian_rss"} else "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
        status, _content_type, body = _fetch(url, accept)
        if status != 200:
            raise RuntimeError(f"{name} public endpoint HTTP {status}")
        if kind == "rss":
            records = _rss(body, name, url)
        elif kind == "pangian_rss":
            records = _pangian_feed(body, url)
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
