"""Remote OK official public JSON feed adapter.

Provider terms require attribution/link-back. The normalized source keeps Remote OK
as provider and preserves the provider job URL as source_url.
"""

import json
import re
from html import unescape
from urllib.request import Request, urlopen

import job_search as engine
from job_search_jobicy import plain_text

ENDPOINT = "https://remoteok.com/api"
MAX_BYTES = 10 * 1024 * 1024


def normalize(item):
    required = ("id", "position", "company", "url")
    if not isinstance(item, dict) or not all(item.get(key) for key in required):
        raise ValueError("Malformed Remote OK listing: missing id/position/company/url")

    geo = str(item.get("location") or "").strip()
    countries = [
        name for name in engine.COUNTRY_NAME_TO_CODE
        if re.search(r"(?<!\\w)" + re.escape(name) + r"(?!\\w)", geo, re.I)
    ]
    normalized_geo = geo.casefold()
    eligible = (
        not geo
        or normalized_geo in {"anywhere", "worldwide", "europe", "eu", "emea"}
        or any(engine.COUNTRY_NAME_TO_CODE[country] == "RO" for country in countries)
    )

    return {
        "romania_eligible": eligible,
        "id": "remoteok:" + str(item["id"]),
        "job_title": unescape(str(item["position"])),
        "company": unescape(str(item["company"])),
        "description": plain_text(item.get("description")),
        "location": geo or "Worldwide",
        "countries": countries,
        "remote": True,
        "work_arrangement": "remote",
        "employment_statuses": [],
        "date_posted": item.get("date"),
        "source_url": str(item["url"]),
        "sources": [{"provider": "Remote OK"}],
    }


def collect(_config=None, opener=urlopen):
    request = Request(
        ENDPOINT,
        headers={
            "Accept": "application/json",
            "User-Agent": "job-search-command-center/1.0",
        },
    )
    with opener(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Remote OK response exceeds size limit")

    payload = json.loads(body)
    if not isinstance(payload, list):
        raise ValueError("Remote OK response must be a JSON array")

    # The feed starts with a metadata/legal object; only entries with an id are jobs.
    listings = [item for item in payload if isinstance(item, dict) and item.get("id")]
    records = [normalize(item) for item in listings]
    return [engine.CollectionResult("remoteok", "public_json_feed", True, records, len(records))]
