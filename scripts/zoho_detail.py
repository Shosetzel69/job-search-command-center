"""Parse public Zoho Recruit job detail HTML without private APIs."""
import re
import json
from html.parser import HTMLParser

HEADINGS = {"Job Information", "Job Description", "Requirements", "Competencies", "Skill Set", "Education"}
LABELS = {"Industry", "City", "State/Province", "Zip/Postal Code", "Country", "Job Type", "Date Opened"}
DATE = re.compile(r"(?:Posted On)\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{4})", re.I)

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
        self.meta_description = None
        self.headings = []
        self._heading_tag = None
        self._heading_parts = []
    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag in {"h1", "h2"}:
            self._heading_tag = tag
            self._heading_parts = []
        if tag == "meta" and fields.get("name", "").lower() == "description":
            self.meta_description = fields.get("content")
        if tag in {"script", "style", "noscript"}:
            self.skip += 1
        if tag in {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr"}:
            self.parts.append("\n")
    def handle_endtag(self, tag):
        if self._heading_tag == tag:
            self.headings.append(" ".join("".join(self._heading_parts).split()))
            self._heading_tag = None
            self._heading_parts = []
        if tag in {"script", "style", "noscript"} and self.skip:
            self.skip -= 1
        if tag in {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr"}:
            self.parts.append("\n")
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self._heading_tag is not None:
                self._heading_parts.append(data)


def embedded_full_description(html):
    """Read the public Zoho JS data literal; reject malformed/unbounded documents."""
    match = re.search(r'\bdata\s*=\s*(\{.*?\})\s*;', html, re.S)
    if not match:
        return None
    raw = match.group(1).replace('\\-', '-')
    raw = re.sub(r'\\x([0-9a-fA-F]{2})', lambda x: '\\u00' + x.group(1), raw)
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    entries = payload.get("jobDescriptionDetails")
    if not isinstance(entries, list):
        return None
    parts = []
    for entry in entries[:12]:
        if not isinstance(entry, dict):
            continue
        rich = entry.get("richText")
        if not isinstance(rich, dict) or rich.get("fieldLabel") != "Job Description":
            continue
        body = rich.get("value")
        if not isinstance(body, str) or not body.strip():
            continue
        parser = Text()
        parser.feed(body)
        text = " ".join("".join(parser.parts).split())
        if text:
            parts.append(text)
    if not parts:
        return None
    result = "\n".join(parts)
    return {"description": result, "description_completeness": "full",
            "description_provenance": "public_embedded_jobDescriptionDetails",
            "date_posted": normalize_date(payload.get("postedOn")),
            "country": payload.get("country"), "location": payload.get("location") or "",
            "employment_type": payload.get("jobType"),
            "job_title": payload.get("jobTitle"), "industry": None}


def normalize_date(value):
    """Normalize explicit public dates; never guess ambiguous slash-formats."""
    from datetime import datetime
    raw = str(value or "").strip()
    fmt = None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        fmt = "%Y-%m-%d"
    elif re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{4}", raw):
        fmt = "%d.%m.%Y"
    elif re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", raw):
        first, second, _ = (int(part) for part in raw.split("/"))
        if first > 12 and 1 <= second <= 12:
            fmt = "%d/%m/%Y"
        elif second > 12 and 1 <= first <= 12:
            fmt = "%m/%d/%Y"
    if fmt:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            return None
    return None

# Explicit provider-gateway instructions, not generic words such as "security",
# "login", "SSO" or "cookies" that may appear in a real security job description.
_ACCESS_GATEWAY_PROMPT = re.compile(
    r"\b(?:please\s+|you\s+(?:must|need\s+to|are\s+required\s+to)\s+)"
    r"(?:sign[\s-]?in|log[\s-]?in)\s+to\s+(?:view|see|read|access|continue|apply|proceed)\b"
    r"|\b(?:sign[\s-]?in|log[\s-]?in)\s+to\s+(?:view|access)\s+(?:this|the)\s+"
    r"(?:job|vacancy|position|posting)\b"
    r"|\b(?:please\s+)?(?:accept|allow)\s+(?:all\s+)?cookies\s+(?:to|before)\s+"
    r"(?:view|access|continue|proceed)\b"
    r"|\b(?:cookie\s+)?consent\s+(?:is\s+)?required\s+(?:to|before)\s+"
    r"(?:view|access|continue|proceed)\b"
    r"|\b(?:access\s+denied|session\s+expired|authentication\s+required)"
    r"\s*(?:[.!]|$)",
    re.I,
)


# A whole standalone CTA is stronger evidence of a provider gateway than
# the presence of "login", "SSO" or "cookies" in legitimate requirements.
# Accept a sequence of such terse messages, but not arbitrary role prose.
_STANDALONE_GATEWAY_CTA = re.compile(
    r"(?:(?:please\s+)?(?:sign[\s-]?in|log[\s-]?in|login)"
    r"(?:\s+to\s+(?:continue|proceed|view|access|apply|see|read)"
    r"(?:\s+(?:this|the)\s+(?:job|vacancy|position|posting|page|application|content))?"
    r"|\s+(?:required|first))?"
    r"|(?:please\s+)?(?:accept|allow)\s+(?:all\s+)?cookies"
    r"(?:\s+to\s+(?:continue|proceed|view|access))?"
    r"|(?:cookie\s+)?consent\s+(?:is\s+)?required(?:\s+to\s+continue)?"
    r"|(?:access\s+denied|session\s+expired|authentication\s+required))"
    r"(?:\s*[.!:]\s*|\s+)*",
    re.I,
)


def reject_access_gateway_text(text):
    """Fail closed on provider gateway prose, without banning security jobs."""
    normalized = " ".join(str(text or "").split())
    # A provider can repeat two or more terse notices. Every sentence
    # must independently be a gateway command; free-form security-role prose
    # (including words such as login/SSO) must not trigger this check.
    fragments = [part.strip() for part in re.split(r"[.!:]+", normalized) if part.strip()]
    standalone_gateway = (
        0 < len(normalized) <= 240
        and bool(fragments)
        and all(_STANDALONE_GATEWAY_CTA.fullmatch(part) for part in fragments)
    )
    if _ACCESS_GATEWAY_PROMPT.search(normalized) or standalone_gateway:
        raise ValueError("Zoho detail lacks Job Description; access gateway detected")


def extract_detail(html, expected_title=None):
    if not isinstance(html, str) or len(html) > 3_145_728:
        raise ValueError("invalid or oversized Zoho detail")
    # Evaluate access and consent evidence BEFORE trusting any path: embedded JS,
    # visible Job Description sections or a long <meta name="description"> summary.
    parser = Text()
    parser.feed(html)
    reject_access_gateway_text(" ".join(parser.parts))
    reject_access_gateway_text(parser.meta_description)
    # A login form or access/consent heading may coexist with a template
    # "Job Description" heading. Reject the access shell before any partial
    # HTML section is accepted as real job content.
    access_heading = re.search(
        r"\b(?:sign[ -]?in|log[ -]?in|login|access denied|unauthorized|"
        r"authentication required|consent required|session expired)\b",
        " ".join(parser.headings), re.I,
    )
    password_form = re.search(
        r"<input\b[^>]*\btype\s*=\s*['\"]?password\b",
        html, re.I,
    )
    if access_heading or password_form:
        raise ValueError("Zoho detail lacks Job Description; access gateway detected")
    full = embedded_full_description(html)
    if full:
        reject_access_gateway_text(full.get("description"))
        # Public portal anchors can be job-type labels ("Full time"), not role titles.
        # Prefer the structured jobTitle when it is a genuine title; never publish
        # employment-type placeholders as titles.
        def valid_title(value):
            title = " ".join(value.split()) if isinstance(value, str) else ""
            generic = {"full time", "full-time", "fulltime", "part time",
                       "part-time", "parttime", "contract", "contractor",
                       "temporary", "permanent", "internship", "freelance"}
            return title if title and title.casefold() not in generic else None

        full["job_title"] = valid_title(full.get("job_title")) or valid_title(expected_title)
        if not full["job_title"]:
            raise ValueError("Zoho detail lacks a valid job title")

        return full
    lines = [" ".join(line.split()) for line in "".join(parser.parts).splitlines()]
    lines = [x for x in lines if x and x != "\u200b"]
    if not lines:
        raise ValueError("empty Zoho detail")
    lower = [x.casefold() for x in lines]
    try:
        idx = lower.index("job description")
    except ValueError as exc:
        meta = (parser.meta_description or "").strip()
        # A generic sign-in/consent/widget shell must not become the description
        # of the job identified by the portal link. Require an exact visible
        # heading for that job and reject common access-control indicators.
        # The shared gateway detector already checked visible HTML and meta.
        # Do not blacklist "SSO", "login" or "cookie consent" as job skills.
        title = " ".join(str(expected_title or "").split()).casefold()
        exact_heading = bool(title and any(
            heading.casefold() == title for heading in parser.headings
        ))
        if meta and len(meta) >= 80 and exact_heading:
            return {"description": meta, "description_completeness": "summary", "description_provenance": "html_meta_description",
                    "location": "", "date_posted": None, "industry": None,
                    "job_title": expected_title or "Untitled",
                    "employment_type": None, "country": None}
        raise ValueError("Zoho detail lacks Job Description") from exc
    start = idx + 1
    finish = next((k for k in range(start, len(lines)) if lines[k] in {"Apply Now", "Apply", "Similar Jobs"}), len(lines))
    description = "\n".join(lines[start:finish]).strip()
    reject_access_gateway_text(description)
    if not description:
        raise ValueError("empty Zoho job description")
    meta = {}
    for key in LABELS:
        try:
            i = lower.index(key.casefold())
            if i + 1 < len(lines) and lines[i+1] not in HEADINGS | LABELS:
                meta[key] = lines[i+1]
        except ValueError:
            pass
    m = DATE.search(" ".join(lines[:idx]))
    date_opened = meta.get("Date Opened")
    result = {"description": description, "description_completeness": "partial", "description_provenance": "visible_html_section", "location": ", ".join(filter(None,(meta.get("City"),meta.get("State/Province")))), "date_posted": normalize_date(m.group(1) if m else date_opened), "industry": meta.get("Industry")}
    result["job_title"] = expected_title or lines[0]
    result["employment_type"] = meta.get("Job Type") or next((s.split("|")[0].strip() for s in lines[:idx] if "|" in s and "time" in s.lower()), None)
    result["country"] = meta.get("Country")
    return result
