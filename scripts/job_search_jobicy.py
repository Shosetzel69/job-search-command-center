"""Jobicy public feed adapter; business rules stay in the canonical engine."""

import json
import re
from html import unescape
from html.parser import HTMLParser
from urllib.request import Request, urlopen

import job_search as engine

ENDPOINT = "https://jobicy.com/api/v2/remote-jobs?count=200"
MAX_BYTES = 10 * 1024 * 1024


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value):
    parser = PlainText()
    parser.feed(str(value or ""))
    return " ".join(parser.parts).strip()


def normalize(item):
    if not isinstance(item, dict) or not all(item.get(k) for k in ("id", "jobTitle", "companyName", "url")):
        raise ValueError("Malformed Jobicy listing: missing id/title/company/url")
    geo = str(item.get("jobGeo") or "").strip()
    # Preserve country restrictions before the shared remote eligibility check.
    countries = [name for name in engine.COUNTRY_NAME_TO_CODE if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", geo, re.I)]
    eligible = (not geo or geo.lower() in {"anywhere", "worldwide", "europe", "emea"}
                or any(engine.COUNTRY_NAME_TO_CODE[country] == "RO" for country in countries))
    return {
        "romania_eligible": eligible,
        "id": "jobicy:" + str(item["id"]),
        "job_title": unescape(item["jobTitle"]),
        "company": unescape(item["companyName"]),
        "description": plain_text(item.get("jobDescription") or item.get("jobExcerpt")),
        "location": "Worldwide" if geo.lower() == "anywhere" else geo,
        "countries": countries,
        "remote": True,
        "work_arrangement": "remote",
        "employment_statuses": engine.list_values(item.get("jobType")),
        "date_posted": item.get("pubDate"),
        "source_url": item["url"],
        "sources": [{"provider": "Jobicy"}],
    }


def collect(config):
    request = Request(ENDPOINT, headers={"Accept": "application/json", "User-Agent": "job-search-command-center/1.0"})
    with urlopen(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Jobicy response exceeds size limit")
    payload = json.loads(body)
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("Jobicy response must contain a jobs array")
    records = [normalize(item) for item in payload["jobs"]]
    return [engine.CollectionResult("jobicy", "latest_200", True, records, len(records))]
