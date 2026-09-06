"""Discover and collect public JobPosting pages without treating HTML 200 as success."""

import hashlib
import heapq
import json
import os
import re
import time
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import job_search as engine
import browser_render
from job_search_jobicy import plain_text
from web_transport import FetchError, PublicClient, public_url

MAX_PAGES = 12
MAX_SECONDS = 45
MAX_LINKS = 2000
ATS_HOSTS = ("greenhouse.io", "lever.co", "myworkdayjobs.com", "smartrecruiters.com",
             "workable.com", "ashbyhq.com", "recruitee.com", "bamboohr.com", "icims.com",
             "successfactors.com", "taleo.net", "teamtailor.com", "applytojob.com")
CAREER = re.compile(r"job|career|vacanc|recruit|cariere|posturi|stellen|emploi|opening|opportunit", re.I)
ROLE = re.compile(r"project|program|programme|delivery|service.manager|scrum|pmo", re.I)
SKIP = re.compile(r"/(login|signin|register|privacy|terms|blog|news|press|events|about)(/|$)", re.I)


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.links, self.documents, self.errors = [], [], []
        self.anchor, self.script = None, None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and (attrs.get("type") or "").lower().split(";")[0] == "application/ld+json":
            self.script = []
        if tag == "a" and attrs.get("href"):
            self.anchor = {"url": attrs["href"], "text": "", "next": "next" in (attrs.get("rel") or "").split()}
        if tag == "link" and "next" in (attrs.get("rel") or "").split() and attrs.get("href"):
            self.links.append({"url": attrs["href"], "text": "next", "next": True})

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        elif self.anchor is not None:
            self.anchor["text"] += data

    def handle_endtag(self, tag):
        if tag == "script" and self.script is not None:
            value = "".join(self.script).strip()
            try:
                self.documents.append(json.loads(value))
            except (ValueError, RecursionError):
                self.errors.append("Malformed JSON-LD")
            self.script = None
        if tag == "a" and self.anchor is not None:
            if len(self.links) < MAX_LINKS:
                self.links.append(self.anchor)
            self.anchor = None


def objects(value, depth=0):
    if depth > 30:
        return
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child, depth + 1)


def is_type(node, kind):
    types = node.get("@type") or []
    types = types if isinstance(types, list) else [types]
    return any(str(value).rstrip("/").split("/")[-1] == kind for value in types)


def as_list(value):
    return value if isinstance(value, list) else [] if value is None else [value]


def area_name(value):
    if isinstance(value, list):
        return ", ".join(filter(None, (area_name(item) for item in value)))
    return str(value.get("name") or value.get("@id") or "") if isinstance(value, dict) else str(value or "")


def normalize(node, page_url, source, now):
    title, description = plain_text(node.get("title")), plain_text(node.get("description"))
    company = area_name(node.get("hiringOrganization"))
    if not title or not company or not description:
        raise ValueError("JobPosting missing title, hiringOrganization or description")
    link = node.get("url") or node.get("mainEntityOfPage") or page_url
    if isinstance(link, dict):
        link = link.get("@id") or page_url
    link = public_url(urljoin(page_url, str(link)))
    expires = engine.parse_posted_datetime(node.get("validThrough"))
    if expires and expires < now:
        return None
    remote = "TELECOMMUTE" in [str(value).upper() for value in as_list(node.get("jobLocationType"))]
    locations, office_countries = [], []
    for place in as_list(node.get("jobLocation")):
        if not isinstance(place, dict):
            locations.append(str(place))
            continue
        for address in as_list(place.get("address") or {}):
            if not isinstance(address, dict):
                locations.append(str(address))
                continue
            parts = [address.get("addressLocality"), address.get("addressRegion"), area_name(address.get("addressCountry"))]
            locations.append(", ".join(str(part) for part in parts if part))
            if parts[-1]:
                office_countries.append(parts[-1])
    restrictions = [area_name(area) for area in as_list(node.get("applicantLocationRequirements"))]
    # For telecommuting, applicant restrictions take precedence over office addresses.
    territories = restrictions if remote else office_countries
    codes, names = [], []
    for territory in territories:
        code = territory.upper() if len(territory) == 2 else engine.COUNTRY_NAME_TO_CODE.get(territory.casefold())
        if code:
            codes.append(code)
            names.append(engine.COUNTRY_NAMES.get(code, territory))
        elif territory:
            names.append(territory)
    identifier = node.get("identifier")
    if isinstance(identifier, dict):
        identifier = identifier.get("value")
    source_key = hashlib.sha256(str(source.get("url")).encode()).hexdigest()[:12]
    identity = str(identifier or hashlib.sha256(link.encode()).hexdigest()[:20])
    record = {
        "id": f"web:{source_key}:{identity}", "job_title": title, "company": company,
        "description": description[:100000], "date_posted": node.get("datePosted"),
        "remote": remote, "work_arrangement": "remote" if remote else "",
        "countries": list(dict.fromkeys(names)), "country_codes": list(dict.fromkeys(codes)),
        "location": ", ".join(restrictions) if remote and restrictions else "Worldwide" if remote else "; ".join(locations),
        "employment_statuses": [str(value).lower().replace("_", "-") for value in as_list(node.get("employmentType"))],
        "source_url": link, "sources": [{"provider": source["name"]}],
        "verified_at": now.isoformat(),
    }
    if remote and restrictions and not codes and not any(re.search(r"^(worldwide|anywhere|europe|eu|european union|emea)$", value, re.I) for value in restrictions):
        record["romania_eligible"] = False
    return record


def site_root(host):
    return re.sub(r"^(www|jobs|careers|career)\.", "", host or "")


def candidate(link, page_url, roots):
    try:
        url = public_url(urljoin(page_url, unescape(link["url"])))
    except FetchError:
        return None
    parsed = urlsplit(url)
    host, path = parsed.hostname, parsed.path
    if SKIP.search(path) or re.search(r"\.(pdf|png|jpg|zip|css|js)$", path, re.I):
        return None
    internal = any(host == root or host.endswith("." + root) for root in roots)
    ats = any(host == root or host.endswith("." + root) for root in ATS_HOSTS)
    if not internal and not ats:
        return None
    text = link.get("text") or ""
    if ROLE.search(text + " " + path):
        priority = 0
    elif link.get("next") or re.search(r"^(next|suivant|urmatoarea|weiter|[2-9])$", text.strip(), re.I):
        priority = 2
    elif CAREER.search(text + " " + path) or ats:
        priority = 1 if len(path.strip("/").split("/")) <= 2 else 3
    else:
        return None
    return priority, url


def collect(source, config, now=None, client=None):
    now = now or datetime.now(timezone.utc)
    deadline = time.monotonic() + MAX_SECONDS
    client = client or PublicClient(deadline)
    connector = "web:" + str(source.get("id") or hashlib.sha256(source["url"].encode()).hexdigest()[:12])
    queue, queued, visited, records, diagnostics = [], set(), set(), {}, []
    roots = {site_root(urlsplit(source["url"]).hostname)}
    heapq.heappush(queue, (0, source["url"]))
    queued.add(source["url"])
    pages, detected, malformed, expired = 0, 0, 0, 0
    browser_attempts, browser_successes, browser_records = 0, 0, 0
    browser_enabled = os.environ.get("WEB_BROWSER_ENABLED") == "1"
    while queue and pages < MAX_PAGES and time.monotonic() < deadline:
        _, requested = heapq.heappop(queue)
        if requested in visited:
            continue
        visited.add(requested)
        pages += 1
        try:
            final_url, html = client.get(requested)
            visited.add(final_url)
            roots.add(site_root(urlsplit(final_url).hostname))
            if re.search(r"<title[^>]*>\s*(just a moment|access denied|attention required)", html, re.I) or "/cdn-cgi/challenge-platform/" in html:
                raise FetchError("Bot challenge; no bypass attempted", "blocked")
            page = Page(html)
            if not page.documents and re.search(r"<input[^>]+type=[\"\']password", html, re.I) and re.search(r"/(login|signin|sign-in|sign_in)(/|$)", urlsplit(final_url).path, re.I):
                raise FetchError("Authentication required", "blocked")
            browser_info = None
            has_jobs = any(is_type(node, "JobPosting") for doc in page.documents for node in objects(doc))
            if browser_enabled and not has_jobs and re.search(r"<script\b", html, re.I):
                if browser_attempts >= 2:
                    browser_info = {"status": "skipped", "error": "Browser page budget reached"}
                else:
                    browser_attempts += 1
                    try:
                        rendered = browser_render.render(final_url, html, deadline)
                        if re.search(r"<title[^>]*>\s*(just a moment|access denied|attention required)", rendered["html"], re.I) or "/cdn-cgi/challenge-platform/" in rendered["html"]:
                            raise FetchError("Browser encountered bot challenge", "blocked")
                        rendered_page = Page(rendered["html"])
                        rendered_page.documents.extend(page.documents)
                        # Keep static discovery if rendering removed useful links or failed resources.
                        rendered_page.links.extend({**link, "url": urljoin(final_url, link["url"])} for link in page.links)
                        page = rendered_page
                        final_url = rendered["url"]
                        roots.add(site_root(urlsplit(final_url).hostname))
                        browser_successes += 1
                        browser_info = {"status": "rendered", "requests": rendered.get("requests", 0),
                                        "resource_errors": rendered.get("errors", [])}
                    except FetchError as exc:
                        browser_info = {"status": getattr(exc, "kind", "error"), "error": str(exc)}
            count = 0
            for document in page.documents:
                for node in objects(document):
                    if is_type(node, "JobPosting"):
                        if isinstance(node.get("url"), str):
                            page.links.append({"url": node["url"], "text": node.get("title") or "job", "next": False})
                        detected += 1
                        try:
                            record = normalize(node, final_url, source, now)
                            if record:
                                records[record["id"]] = record
                                count += 1
                            else:
                                expired += 1
                        except (ValueError, TypeError, FetchError):
                            malformed += 1
                    if is_type(node, "ListItem"):
                        item = node.get("item") or {}
                        url = (item.get("url") or item.get("@id") or node.get("url")) if isinstance(item, dict) else item
                        if url:
                            page.links.append({"url": url, "text": area_name(item), "next": False})
            if browser_info and browser_info["status"] == "rendered":
                browser_records += count
            diagnostics.append({"query": requested, "final_url": final_url, "status": "fetched", "records": count,
                                "error": "; ".join(page.errors) or None, "browser": browser_info})
            malformed += len(page.errors)
            for link in page.links[:MAX_LINKS]:
                option = candidate(link, final_url, roots)
                if option and option[1] not in queued and option[1] not in visited and len(queued) < MAX_LINKS:
                    queued.add(option[1])
                    heapq.heappush(queue, option)
        except (FetchError, ValueError, OSError, RecursionError) as exc:
            diagnostics.append({"query": requested, "status": getattr(exc, "kind", "error"), "records": 0, "error": str(exc)})
    errors = [item for item in diagnostics if item["status"] != "fetched" or item.get("error")
              or (item.get("browser") or {}).get("error") or (item.get("browser") or {}).get("resource_errors")]
    limited = bool(queue)
    if records:
        outcome = "partial" if errors or limited or malformed else "extracted"
    elif diagnostics and all(item["status"] == "blocked" for item in diagnostics):
        outcome = "blocked"
    elif diagnostics and not any(item["status"] == "fetched" for item in diagnostics):
        outcome = "error"
    elif detected and expired == detected and not limited and not errors:
        outcome = "no_active_jobs"
    else:
        outcome = "no_extractable_jobs"
    note = f"{pages} pages attempted; {detected} JobPosting nodes; {len(records)} valid records; {expired} expired; {malformed} malformed"
    if limited:
        note += "; page/time/link budget reached; coverage is partial"
    if outcome == "no_extractable_jobs":
        note += "; HTML access does not establish absence of vacancies; site-specific extraction may be required"
    results = [engine.CollectionResult(connector, "web_pages", True, list(records.values()), len(records))] if records or outcome == "no_active_jobs" else []
    if outcome not in {"extracted", "no_active_jobs"}:
        results.append(engine.CollectionResult(connector, outcome, False, [], 0, note))
    return results, {"web_outcome": outcome, "pages_attempted": pages, "pages_fetched": sum(item["status"] == "fetched" for item in diagnostics),
                     "browser_enabled": browser_enabled, "browser_attempts": browser_attempts,
                     "browser_successes": browser_successes, "browser_records": browser_records,
                     "jobs_detected": detected, "coverage_complete": False, "discovered_pages_complete": not limited and not errors and not malformed,
                     "limitations": [note], "page_results": diagnostics}
