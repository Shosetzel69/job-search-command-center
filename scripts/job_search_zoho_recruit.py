"""Public-only Zoho Recruit collector; isolate tenant and sanitize request URLs."""
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit, urlencode
from urllib.request import Request, urlopen, HTTPRedirectHandler, build_opener
from zoho_detail import extract_detail

MAX_BYTES = 3 * 1024 * 1024
MAX_POSTINGS = 500
HOST = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.zohorecruit\.com$")
JOB_ID = re.compile(r"^[0-9]{5,30}$")

def validate_board(url):
    p = urlsplit(str(url or "").strip())
    if (p.scheme != "https" or not HOST.fullmatch(p.hostname or "") or
        p.username or p.password or p.port or p.query or p.fragment or
        p.path.rstrip("/") != "/careers"):
        raise ValueError("invalid Zoho Recruit public careers URL")
    return "https://" + p.hostname + "/careers"

class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.current = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self.current = [attrs["href"], ""]
    def handle_data(self, data):
        if self.current is not None:
            self.current[1] += data
    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.links.append(tuple(self.current))
            self.current = None

def enumerate_board(html, board_url):
    parser = Links()
    parser.feed(html)
    tenant = urlsplit(board_url).hostname
    found = {}
    for href, title in parser.links:
        p = urlsplit(urljoin(board_url, href))
        if (p.scheme != "https" or p.hostname != tenant or p.username or
            p.password or p.port or p.path != "/recruit/PortalDetail.na"):
            continue
        jobids = parse_qs(p.query).get("jobid", [])
        if len(jobids) != 1 or not JOB_ID.fullmatch(jobids[0]):
            continue
        jobid = jobids[0]
        # Preserve the public portal detail token: stripping digest breaks Zoho detail pages.
        # Rebuild URL from a strict query-key allowlist, never pass through arbitrary parameters.
        params = parse_qs(p.query, keep_blank_values=False)
        allowed = ("digest", "embedsource", "iframe", "jobid", "widgetid")
        if any(len(params.get(key, [])) != 1 for key in ("digest", "jobid", "widgetid")):
            continue
        if len(params["digest"][0]) > 256 or not re.fullmatch(r"[a-zA-Z0-9._-]+", params["digest"][0]):
            continue
        if not JOB_ID.fullmatch(params["widgetid"][0]):
            continue
        sanitized = {key: params[key][0] for key in allowed if key in params}
        if any(len(value) != 1 for value in params.values()):
            continue
        if "embedsource" in sanitized and sanitized["embedsource"] != "CareerSite":
            continue
        if "iframe" in sanitized and sanitized["iframe"] not in ("true", "false"):
            continue
        safe_url = "https://" + tenant + "/recruit/PortalDetail.na?" + urlencode(sanitized)
        found.setdefault(jobid, {"jobid": jobid, "job_title": " ".join(title.split()), "source_url": safe_url})
        if len(found) > MAX_POSTINGS:
            raise ValueError("too many Zoho postings")
    if not found and re.search(r"jobid=|PortalDetail\.na", html, re.I):
        raise ValueError("unsupported Zoho board link structure")
    return list(found.values())

class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def _safe_opener(request, timeout):
    return build_opener(_NoRedirect).open(request, timeout=timeout)

def _fetch(url, tenant, opener):
    p = urlsplit(url)
    if (p.scheme != "https" or p.hostname != tenant or p.username or
        p.password or p.port or p.fragment):
        raise ValueError("off-tenant Zoho request rejected")
    with opener(Request(url, headers={"User-Agent": "job-search-command-center/1.0",
                                      "Accept": "text/html"}), timeout=25) as response:
        # urlopen may follow redirects: reject untrusted final destinations.
        final_url = response.geturl() if hasattr(response, "geturl") else url
        final = urlsplit(final_url)
        if (final.scheme != "https" or final.hostname != tenant or final.username or
            final.password or final.port):
            raise ValueError("off-tenant Zoho redirect rejected")
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("oversized Zoho public HTML")
    return body.decode("utf-8", errors="strict")

def collect(board_url, company_name, opener=None):
    opener = opener or _safe_opener
    board = validate_board(board_url)
    if not isinstance(company_name, str) or not company_name.strip():
        raise ValueError("company_name is required")
    tenant = urlsplit(board).hostname
    summaries = enumerate_board(_fetch(board, tenant, opener), board)
    records = []
    for item in summaries:
        detail = extract_detail(_fetch(item["source_url"], tenant, opener),
                                expected_title=item["job_title"] or None)
        records.append({
            "id": f"zoho_recruit:{tenant}:{item['jobid']}",
            "job_title": detail["job_title"], "company": company_name.strip(),
            "description": detail["description"], "location": detail["location"],
            "countries": [detail["country"]] if detail.get("country") else [], "remote": None, "work_arrangement": None,
            "employment_statuses": [detail["employment_type"]] if detail["employment_type"] else [],
            "date_posted": detail["date_posted"], "source_url": item["source_url"],
            "sources": [{"provider": "Zoho Recruit", "tenant": tenant}],
        })
    return records


def collect_result(board_url, company_name, opener=None):
    """Adapt public postings to the JSCC canonical CollectionResult boundary."""
    import job_search as engine
    records = collect(board_url, company_name, opener=opener)
    tenant = urlsplit(validate_board(board_url)).hostname
    return [engine.CollectionResult(f"zoho_recruit:{tenant}", "public_postings", True, records, len(records))]

def collect_public_metadata(board_url, company_name, opener=None):
    """Stage 1 only: real public listing metadata, NOT full job records."""
    from zoho_public_jobs import embedded_jobs
    board=validate_board(board_url)
    tenant=urlsplit(board).hostname
    url="https://"+tenant+"/jobs/Careers"
    raw=embedded_jobs(_fetch(url,tenant,opener or _safe_opener))
    return [{"id":f"zoho_recruit:{tenant}:{r['jobid']}",
             "job_title":r["job_title"],"company":company_name,
             "country":r["country"],"city":r["city"],
             "employment_type":r["employment_type"],"industry":r["industry"],
             "remote_raw":r["remote_raw"],"description":r["description"],
             "description_available":r["description_available"],
             "description_chars":r["description_chars"],
             "description_quality_check":r["description_chars"] >= 80,
             "date_opened":r["date_opened"], "state":r["state"],
             "details_complete":bool(r["description_available"] and r["description_chars"] >= 80)}
            for r in raw]


def collect_public_complete(board_url, company_name, opener=None):
    """Require complete publicly disclosed description for every published item.

    Do not silently drop incomplete jobs or report partial listing success.
    """
    records=collect_public_metadata(board_url,company_name,opener=opener)
    missing=[row["id"] for row in records if not row["details_complete"]]
    if missing:
        raise ValueError(f"Zoho public board lacks complete descriptions for {len(missing)} of {len(records)} postings")
    return records
