"""SAP SuccessFactors public XML job-feed adapter."""

import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

import job_search as engine

MAX_BYTES = 10 * 1024 * 1024
MAX_POSTINGS = 2000


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


def _text(node, *names):
    for name in names:
        child = node.find(name)
        if child is not None and child.text and child.text.strip():
            return child.text.strip()
    return None


def _country(value):
    text = str(value or "").strip()
    if not text:
        return None
    code = engine.COUNTRY_NAME_TO_CODE.get(text.lower()) or (text.upper() if len(text) == 2 else None)
    return engine.COUNTRY_NAMES.get(code, text) if code else text


def normalize(node, company_id, company_name, origin):
    posting_id = _text(node, "jobid", "jobId", "jobReqId", "jobreqid", "id")
    title = _text(node, "title", "jobtitle", "jobTitle")
    source_url = _text(node, "url", "joburl", "jobUrl", "link")
    if not posting_id or not title or not company_name:
        raise ValueError("Malformed SuccessFactors job: missing id/title/company")
    if not source_url:
        source_url = f"{origin}/career?" + urlencode({"company": company_id, "career_ns": "job_listing", "career_job_req_id": posting_id})

    city = _text(node, "city")
    state = _text(node, "state", "region")
    country = _country(_text(node, "country", "countryCode"))
    location = ", ".join(value for value in (city, state, country) if value)
    location = location or (_text(node, "location") or "")
    remote = bool(re.search(r"\b(remote|anywhere|worldwide)\b", location, re.I))
    description = plain_text(_text(node, "description", "jobDescription") or "")

    return {
        "id": f"successfactors:{company_id}:{posting_id}",
        "job_title": title,
        "company": company_name,
        "description": description,
        "location": location,
        "countries": [country] if country else [],
        "remote": remote,
        "work_arrangement": "remote" if remote else "onsite",
        "employment_statuses": engine.list_values(_text(node, "jobtype", "jobType", "employmentType")),
        "date_posted": _text(node, "date", "datePosted", "postedDate", "publicationDate"),
        "source_url": source_url,
        "sources": [{"provider": "SuccessFactors", "company_id": company_id}],
        "category": _text(node, "category"),
    }


def collect(career_site_url, company_id, company_name, locale=None, max_postings=MAX_POSTINGS, opener=urlopen):
    parsed = urlsplit(str(career_site_url or "").strip())
    company_id = str(company_id or "").strip()
    company_name = str(company_name or "").strip()
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port:
        raise ValueError("SuccessFactors career_site_url must be a public HTTPS URL")
    if not company_id:
        raise ValueError("SuccessFactors company_id is required")
    if not company_name:
        raise ValueError("SuccessFactors company_name is required")
    if not isinstance(max_postings, int) or max_postings < 1 or max_postings > MAX_POSTINGS:
        raise ValueError(f"max_postings must be between 1 and {MAX_POSTINGS}")

    origin = f"https://{parsed.hostname}"
    query = {"company": company_id, "career_ns": "job_listing_summary", "resultType": "XML"}
    if locale:
        query["rcm_site_locale"] = str(locale)
    request = Request(origin + "/career?" + urlencode(query), headers={"Accept": "application/xml,text/xml", "User-Agent": "job-search-command-center/1.0"})
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("SuccessFactors response exceeds size limit")
    root = ET.fromstring(body)
    jobs = root.findall(".//job")
    if not jobs and root.tag.lower().endswith("job"):
        jobs = [root]
    records = [normalize(node, company_id, company_name, origin) for node in jobs[:max_postings]]
    return [engine.CollectionResult(f"successfactors:{company_id}", "public_xml_feed", True, records, len(jobs))]
