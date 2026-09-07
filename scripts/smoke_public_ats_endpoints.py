"""Live smoke checks for public ATS endpoints.

This is intentionally separate from unit tests. It validates that real public
provider surfaces still return the minimum payload shape expected by the
connectors. It does not write data or use credentials.
"""

import json
import sys
import urllib.request
import xml.etree.ElementTree as ET

UA = "job-search-command-center-live-smoke/1.0"
TIMEOUT = 20


def fetch_json(url, *, method="GET", payload=None, headers=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    final_headers = {"Accept": "application/json", "User-Agent": UA}
    if data is not None:
        final_headers["Content-Type"] = "application/json"
    final_headers.update(headers or {})
    request = urllib.request.Request(url, data=data, headers=final_headers, method=method)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.status, json.loads(response.read())


def fetch_bytes(url, *, headers=None):
    final_headers = {"User-Agent": UA}
    final_headers.update(headers or {})
    request = urllib.request.Request(url, headers=final_headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.status, response.read()


def check(name, fn):
    try:
        detail = fn()
        print(f"PASS {name}: {detail}")
        return True
    except Exception as exc:
        print(f"FAIL {name}: {type(exc).__name__}: {exc}")
        return False


def smartrecruiters():
    status, payload = fetch_json(
        "https://api.smartrecruiters.com/v1/companies/Endava/postings?destination=PUBLIC&limit=2&offset=0"
    )
    assert status == 200 and isinstance(payload.get("content"), list)
    return f"{len(payload['content'])} postings"


def greenhouse():
    status, payload = fetch_json(
        "https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true"
    )
    assert status == 200 and isinstance(payload.get("jobs"), list)
    return f"{len(payload['jobs'])} postings"


def ashby():
    status, payload = fetch_json(
        "https://api.ashbyhq.com/posting-api/job-board/camunda?includeCompensation=false"
    )
    assert status == 200 and isinstance(payload.get("jobs"), list)
    return f"{len(payload['jobs'])} postings"


def recruitee():
    status, payload = fetch_json("https://almavivadebelgique.recruitee.com/api/offers/")
    assert status == 200 and isinstance(payload.get("offers"), list)
    return f"{len(payload['offers'])} offers"


def lever():
    status, payload = fetch_json(
        "https://api.lever.co/v0/postings/Civitta?mode=json&skip=0&limit=2"
    )
    assert status == 200 and isinstance(payload, list)
    return f"{len(payload)} postings"


def workable():
    status, payload = fetch_json("https://www.workable.com/api/accounts/upstream?details=true")
    assert status == 200 and isinstance(payload.get("jobs"), list)
    return f"{len(payload['jobs'])} jobs"


def bamboohr():
    status, payload = fetch_json("https://saphetor.bamboohr.com/careers/list")
    assert status == 200 and isinstance(payload.get("result"), list)
    return f"{len(payload['result'])} jobs"


def workday():
    url = "https://thales.wd3.myworkdayjobs.com/wday/cxs/thales/Careers/jobs"
    status, payload = fetch_json(
        url,
        method="POST",
        payload={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""},
        headers={"Referer": "https://thales.wd3.myworkdayjobs.com/Careers/"},
    )
    assert status == 200 and isinstance(payload.get("jobPostings"), list)
    return f"{len(payload['jobPostings'])} postings"


def successfactors():
    url = (
        "https://career5.successfactors.eu/career?company=C0001122692P"
        "&career_ns=job_listing_summary&resultType=XML"
    )
    status, body = fetch_bytes(url, headers={"Accept": "application/xml,text/xml"})
    assert status == 200
    root = ET.fromstring(body)
    jobs = root.findall(".//job")
    if not jobs:
        tags = []
        for node in root.iter():
            tag = node.tag.rsplit("}", 1)[-1]
            if tag not in tags:
                tags.append(tag)
            if len(tags) >= 20:
                break
        raise AssertionError(f"no <job> nodes; tags={tags}")
    return f"{len(jobs)} jobs"


def main():
    checks = [
        ("SmartRecruiters", smartrecruiters),
        ("Workday", workday),
        ("Greenhouse", greenhouse),
        ("Ashby", ashby),
        ("Lever", lever),
        ("Recruitee", recruitee),
        ("Workable", workable),
        ("BambooHR", bamboohr),
        ("SuccessFactors", successfactors),
    ]
    failures = [name for name, fn in checks if not check(name, fn)]
    if failures:
        print("FAILED PROVIDERS: " + ", ".join(failures))
        return 1
    print("ALL PUBLIC ATS SMOKE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
