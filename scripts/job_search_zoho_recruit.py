"""Public-only Zoho Recruit collector; isolate tenant and sanitize request URLs."""
import re
import time
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit, urlencode, quote
from urllib.request import Request, urlopen, HTTPRedirectHandler, build_opener
from zoho_detail import extract_detail, normalize_date, reject_access_gateway_text

MAX_BYTES = 3 * 1024 * 1024
MAX_POSTINGS = 500
MAX_REQUESTS_PER_SOURCE = 101
MAX_ELAPSED_SECONDS = 180
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


class _NextControl(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.controls = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "jobNextNav" in (attrs.get("class") or "").split():
            self.controls.append((attrs.get("data-wid"), attrs.get("data-findex")))


def _public_next_url(html, summaries, tenant):
    parser = _NextControl()
    parser.feed(html)
    if not parser.controls:
        return None
    if len(set(parser.controls)) != 1:
        raise ValueError("ambiguous Zoho next control")
    widget, index = parser.controls[0]
    if not JOB_ID.fullmatch(widget or "") or not re.fullmatch(r"[0-9]{1,6}", index or ""):
        raise ValueError("invalid Zoho next control")
    # Only reuse public parameters from the matching widget's validated links.
    context = set()
    for row in summaries:
        params = parse_qs(urlsplit(row["source_url"]).query)
        if params.get("widgetid") == [widget]:
            context.add((params["digest"][0], params.get("iframe", ["false"])[0]))
    if len(context) != 1:
        raise ValueError("unverified Zoho paging context")
    digest, iframe = context.pop()
    return "https://" + tenant + "/recruit/Portal.na?" + urlencode({
        "iframe": iframe, "digest": digest, "widgetid": widget,
        "findex": index, "mode": "next", "searchval": "",
        "myjob": "false", "isremote": "false",
    })


def _expand_public_links(html, summaries, board, tenant, opener, deadline, inventory_ids):
    found = {row["jobid"]: row for row in summaries}
    seen = set()
    requests = 0
    # Preserve existing network budget; never guess offsets or retry denied pages.
    while requests < 5 and set(found) != inventory_ids:
        url = _public_next_url(html, summaries, tenant)
        if url is None:
            break
        if url in seen:
            raise ValueError("repeated Zoho pagination cursor")
        seen.add(url)
        html = _fetch(url, tenant, opener, deadline=deadline)
        requests += 1
        summaries = enumerate_board(html, board)
        ids = {row["jobid"] for row in summaries}
        if not ids or not ids.issubset(inventory_ids) or ids.issubset(found):
            raise ValueError("inconsistent Zoho pagination response")
        for row in summaries:
            found.setdefault(row["jobid"], row)
    return list(found.values()), requests


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def _safe_opener(request, timeout):
    return build_opener(_NoRedirect).open(request, timeout=timeout)

def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Zoho source collection exceeded wall-time budget")
    return remaining


def _fetch(url, tenant, opener, *, deadline=None):
    p = urlsplit(url)
    if (p.scheme != "https" or p.hostname != tenant or p.username or
        p.password or p.port or p.fragment):
        raise ValueError("off-tenant Zoho request rejected")
    deadline = deadline if deadline is not None else time.monotonic() + MAX_ELAPSED_SECONDS
    with opener(Request(url, headers={"User-Agent": "job-search-command-center/1.0",
                                      "Accept": "text/html"}), timeout=min(25, _remaining(deadline))) as response:
        # urlopen may follow redirects: reject untrusted final destinations.
        final_url = response.geturl() if hasattr(response, "geturl") else url
        final = urlsplit(final_url)
        if (final.scheme != "https" or final.hostname != tenant or final.username or
            final.password or final.port):
            raise ValueError("off-tenant Zoho redirect rejected")
        # Bound each read by the remaining shared budget, not a fresh 25s.
        chunks, length = [], 0
        reader = getattr(response, "read1", response.read)
        while True:
            remaining = _remaining(deadline)
            sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
            if sock is not None:
                sock.settimeout(min(25, remaining))
            chunk = reader(min(65536, MAX_BYTES + 1 - length))
            _remaining(deadline)
            if not chunk:
                break
            chunks.append(chunk)
            length += len(chunk)
            if length > MAX_BYTES:
                raise ValueError("oversized Zoho public HTML")
        body = b"".join(chunks)
    if len(body) > MAX_BYTES:
        raise ValueError("oversized Zoho public HTML")
    return body.decode("utf-8", errors="strict")

# Conservative title prefilter for an explicitly requested project-management collection.
# Other scopes and unknown titles are deliberately retained.
_PM_TITLE = re.compile(r"\b(?:project manager|program(?:me)? manager|delivery manager|service manager|scrum master|agile project manager|technical project manager|pmo)\b", re.I)
_NON_PM_TITLE = re.compile(r"\b(?:android developer|ios developer|frontend developer|front.end developer|backend developer|back.end developer|devops engineer|software engineer|data engineer|qa engineer)\b", re.I)

def prefilter_public_metadata(rows, *, role_family=None):
    if str(role_family or "").upper() not in {"PROJECT_MANAGEMENT", "PROJECT_MANAGER"}:
        return list(rows)
    return [row for row in rows if _PM_TITLE.search(str(row.get("job_title") or ""))
            or not _NON_PM_TITLE.search(str(row.get("job_title") or ""))]

def mark_careers_board_fallback(records, board):
    """Label navigation honestly; a verified portal URL takes precedence."""
    tenant = urlsplit(board).hostname
    for record in records:
        link = record.get("source_url")
        if link == board:
            record["source_url_kind"] = "careers_board_fallback"
            record["source_url_label"] = "Careers board (not a direct job link)"
        else:
            parts = urlsplit(link or "")
            jobid = record["id"].rsplit(":", 1)[-1]
            portal = (parts.path == "/recruit/PortalDetail.na"
                      and parse_qs(parts.query).get("jobid") == [jobid])
            modern = bool(re.fullmatch(r"/jobs/careers/" + re.escape(jobid) + r"/[^/]+", parts.path, re.I))
            if (parts.scheme != "https" or parts.hostname != tenant or parts.username
                    or parts.password or parts.port or parts.fragment or not (portal or modern)):
                raise ValueError("unverified Zoho individual job URL")
            record["source_url_kind"] = "direct_job"
            record["source_url_label"] = "Original job posting"
        record["missing_fields"] = sorted(
            field for field in ("date_posted", "location", "remote", "work_arrangement")
            if record.get(field) is None or record.get(field) == ""
        )
    return records


def _rotating_details(rows, *, slot=None):
    # Stable ID ordering plus UTC minute rotation prevents a fixed prefix.
    # This is not a claim of exhaustive provider pagination.
    ordered = sorted(rows, key=lambda item: item["jobid"])
    if not ordered:
        return ordered
    offset = (int(time.time() // 60) if slot is None else slot) % len(ordered)
    return ordered[offset:] + ordered[:offset]


def _metadata_record(row, tenant, company_name, board):
    from zoho_public_jobs import _PlainText
    description = ""
    if row.get("description_available"):
        parser = _PlainText()
        parser.feed(row.get("description") or "")
        description = " ".join("".join(parser.parts).split())
        reject_access_gateway_text(description)
    place = ", ".join(x for x in (row.get("city"), row.get("state"), row.get("country")) if x)
    date = normalize_date(row.get("date_opened"))
    return {
        "id": f"zoho_recruit:{tenant}:{row['jobid']}",
        "job_title": row["job_title"], "company": company_name.strip(),
        "description": description,
        "description_completeness": "partial" if description else "missing",
        "description_provenance": "public_modern_jobs_json" if description else "public_listing_metadata_only",
        "location": place or None,
        "countries": [row["country"]] if row.get("country") else [],
        "remote": None, "work_arrangement": None,
        "employment_statuses": [row["employment_type"]] if row.get("employment_type") else [],
        "date_posted": date, "source_url": board,
        "_jscc_field_provenance": {
            "title": "ATS_FIELD",
            **({"description": "LISTING_CARD"} if description else {}),
            **({"location": "ATS_FIELD"} if place else {}),
            **({"date_posted": "ATS_FIELD"} if date else {}),
        },
        "sources": [{"provider": "Zoho Recruit", "tenant": tenant}],
    }


def _modern_detail_link(row, tenant, opener, deadline):
    # Public career-site route, corroborated by the detail response. Never
    # publish a constructed link without verifying the individual vacancy.
    title = row["job_title"]
    slug = re.sub(r"[\s]+", "-", title.strip())
    slug = quote(slug, safe="-")
    jobid = row["jobid"]
    if not JOB_ID.fullmatch(jobid) or not slug or len(slug) > 300:
        return None
    url = f"https://{tenant}/jobs/careers/{jobid}/{slug}?source=CareerSite"
    try:
        html = _fetch(url, tenant, opener, deadline=deadline)
        from zoho_detail import Text
        parser = Text()
        parser.feed(html)
        reject_access_gateway_text(" ".join(parser.parts))
        if not any(heading.casefold() == title.casefold() for heading in parser.h1_headings):
            return None
        if not re.search(r"(?<![0-9])" + re.escape(jobid) + r"(?![0-9])", html):
            return None
        return url
    except (OSError, ValueError, TimeoutError):
        return None


def collect(board_url, company_name, opener=None, role_family=None, diagnostics=None):
    opener = opener or _safe_opener
    board = validate_board(board_url)
    if not isinstance(company_name, str) or not company_name.strip():
        raise ValueError("company_name is required")
    tenant = urlsplit(board).hostname
    deadline = time.monotonic() + MAX_ELAPSED_SECONDS
    board_html = _fetch(board, tenant, opener, deadline=deadline)
    summaries = enumerate_board(board_html, board)
    paging_requests = 0
    capped = len(summaries) >= 100
    scoped = str(role_family or "").upper() in {"PROJECT_MANAGEMENT", "PROJECT_MANAGER"}
    if summaries and (scoped or capped):
        # Existing public modern listing is the only alternative to the capped
        # portal. Never guess page/API parameters or bypass the provider.
        from zoho_public_jobs import embedded_jobs
        try:
            metadata = embedded_jobs(_fetch("https://" + tenant + "/jobs/Careers", tenant, opener, deadline=deadline))
        except ValueError as exc:
            if capped:
                raise ValueError("Zoho public careers page reached 100 postings; pagination required; public metadata not verified") from exc
            raise
        selected = prefilter_public_metadata(metadata, role_family=role_family)
        selected_ids = {item["jobid"] for item in selected}
        relevant_portal = prefilter_public_metadata(summaries, role_family=role_family)
        if any(item["jobid"] not in selected_ids for item in relevant_portal):
            raise ValueError("inconsistent Zoho public listing surfaces; relevant portal posting missing from metadata")
        if capped:
            portal_ids = {item["jobid"] for item in summaries}
            metadata_ids = {item["jobid"] for item in metadata}
            if not portal_ids.issubset(metadata_ids) or len(metadata_ids) <= len(portal_ids):
                raise ValueError("Zoho public careers page reached 100 postings; pagination required; expanded public inventory not verified")
        if capped:
            summaries, paging_requests = _expand_public_links(
                board_html, summaries, board, tenant, opener, deadline, metadata_ids)
            if diagnostics is not None:
                diagnostics.update(public_link_count=len(summaries), paging_requests=paging_requests)
        summaries = [item for item in summaries if item["jobid"] in selected_ids]
        if capped:
            # Reserve two requests for the listing surfaces; preserve explicit
            # metadata for rows without a detail link or outside the budget.
            summaries = _rotating_details(summaries)[:MAX_REQUESTS_PER_SOURCE - 2 - paging_requests]
        available_ids = {item["jobid"] for item in summaries}
        missing_selected = [row for row in selected if row["jobid"] not in available_ids]
        if diagnostics is not None:
            diagnostics.update(portal_capped=capped, public_metadata_count=len(metadata),
                               selected_count=len(selected), missing_detail_count=len(missing_selected))
        if not summaries and not missing_selected:
            return []
    else:
        missing_selected = []
    if not summaries and not missing_selected:
        # Some modern Zoho tenants publish an embedded JSON jobs list, not portal links.
        # Only emit records if the public description field is present; classify its
        # completeness conservatively (the listing cannot prove full detail parity).
        from zoho_public_jobs import embedded_jobs, visible_description_length
        from html import unescape
        from zoho_public_jobs import _PlainText
        modern_url = "https://" + tenant + "/jobs/Careers"
        modern_html = _fetch(modern_url, tenant, opener, deadline=deadline)
        if not re.search(r"""<input\b[^>]*(?:id|name)\s*=\s*["']jobs["']""", modern_html, re.I):
            # Unknown HTML (login page, access denied, JS shell, changed widget)
            # must never be interpreted as a genuine empty job board.
            empty_hint = r"\b(?:no (?:current )?(?:job )?openings|no jobs? (?:available|found)|no (?:open )?positions|currently no vacancies)\b"
            if re.search(empty_hint, board_html, re.I) and re.search(empty_hint, modern_html, re.I):
                return []
            raise ValueError("unrecognized Zoho public board; empty state not established")
        modern = embedded_jobs(modern_html)
        modern = prefilter_public_metadata(modern, role_family=role_family)
        # Public listing rows remain useful with missing/partial descriptions.
        # _metadata_record preserves only published description and location fields,
        # rejects access-gateway text and marks provenance/completeness explicitly.
        records = [_metadata_record(row, tenant, company_name, board) for row in modern]
        # Limit to existing request/deadline budget; no retries or access bypass.
        for row, record in zip(modern[:MAX_REQUESTS_PER_SOURCE - 2], records):
            if time.monotonic() >= deadline:
                break
            link = _modern_detail_link(row, tenant, opener, deadline)
            if link:
                record["source_url"] = link
        if diagnostics is not None:
            diagnostics["missing_detail_count"] = len(records)
        return mark_careers_board_fallback(records, board)
    if len(summaries) + 2 + paging_requests > MAX_REQUESTS_PER_SOURCE:
        raise ValueError('Zoho request budget exceeded')
    records = []
    for index, item in enumerate(summaries):
        try:
            _remaining(deadline)
            detail = extract_detail(_fetch(item["source_url"], tenant, opener, deadline=deadline),
                                    expected_title=item["job_title"] or None)
            _remaining(deadline)
        except TimeoutError:
            if not capped:
                raise
            deferred = {row["jobid"] for row in summaries[index:]}
            missing_selected.extend(row for row in selected if row["jobid"] in deferred)
            if diagnostics is not None:
                diagnostics["missing_detail_count"] = len(missing_selected)
                diagnostics["deadline_exhausted"] = True
            break
        records.append({
            "id": f"zoho_recruit:{tenant}:{item['jobid']}",
            "job_title": detail["job_title"], "company": company_name.strip(),
            "description": detail["description"],
            "description_completeness": detail["description_completeness"],
            "description_provenance": detail["description_provenance"], "location": detail["location"],
            "countries": [detail["country"]] if detail.get("country") else [], "remote": None, "work_arrangement": None,
            "employment_statuses": [detail["employment_type"]] if detail["employment_type"] else [],
            "date_posted": detail["date_posted"], "source_url": item["source_url"],
            "_jscc_field_provenance": dict(detail.get("_jscc_field_provenance") or {}),
            "sources": [{"provider": "Zoho Recruit", "tenant": tenant}],
        })
    for row in missing_selected:
        records.append(_metadata_record(row, tenant, company_name, board))
    return mark_careers_board_fallback(records, board)


def collect_result(board_url, company_name, opener=None, role_family=None):
    """Adapt public postings to the JSCC canonical CollectionResult boundary."""
    import job_search as engine
    evidence = {}
    records = collect(board_url, company_name, opener=opener, role_family=role_family, diagnostics=evidence)
    tenant = urlsplit(validate_board(board_url)).hostname
    connector = f"zoho_recruit:{tenant}"
    result = [engine.CollectionResult(connector, "public_postings", True, records, len(records))]
    if evidence.get("missing_detail_count"):
        result.append(engine.CollectionResult(connector, "public_inventory_partial", False, [], 0,
            f"{evidence['missing_detail_count']} selected public posting(s) lack verified detail within existing budget",
            error_code="TIMEOUT" if evidence.get("deadline_exhausted") else "SCHEMA_ERROR",
            failure_stage="fetch" if evidence.get("deadline_exhausted") else "parse"))
    return result

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
             "details_complete":False, "description_completeness": "partial" if r["description_available"] else "missing"}
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
