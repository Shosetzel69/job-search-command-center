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
    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == "meta" and fields.get("name", "").lower() == "description":
            self.meta_description = fields.get("content")
        if tag in {"script", "style", "noscript"}:
            self.skip += 1
        if tag in {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr"}:
            self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self.skip:
            self.skip -= 1
        if tag in {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr"}:
            self.parts.append("\n")
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


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
    from datetime import datetime
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return None

def extract_detail(html, expected_title=None):
    if not isinstance(html, str) or len(html) > 3_145_728:
        raise ValueError("invalid or oversized Zoho detail")
    full = embedded_full_description(html)
    if full:
        full["job_title"] = expected_title or full["job_title"]
        return full
    parser = Text()
    parser.feed(html)
    lines = [" ".join(line.split()) for line in "".join(parser.parts).splitlines()]
    lines = [x for x in lines if x and x != "\u200b"]
    if not lines:
        raise ValueError("empty Zoho detail")
    lower = [x.casefold() for x in lines]
    try:
        idx = lower.index("job description")
    except ValueError as exc:
        if parser.meta_description and len(parser.meta_description.strip()) >= 80:
            return {"description": parser.meta_description.strip(), "description_completeness": "summary", "description_provenance": "html_meta_description",
                    "location": "", "date_posted": None, "industry": None,
                    "job_title": expected_title or "Untitled",
                    "employment_type": None, "country": None}
        raise ValueError("Zoho detail lacks Job Description") from exc
    start = idx + 1
    finish = next((k for k in range(start, len(lines)) if lines[k] in {"Apply Now", "Apply", "Similar Jobs"}), len(lines))
    description = "\n".join(lines[start:finish]).strip()
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
    result = {"description": description, "description_completeness": "partial", "description_provenance": "visible_html_section", "location": ", ".join(filter(None,(meta.get("City"),meta.get("State/Province")))), "date_posted": (m.group(1) if m else date_opened), "industry": meta.get("Industry")}
    result["job_title"] = expected_title or lines[0]
    result["employment_type"] = meta.get("Job Type") or next((s.split("|")[0].strip() for s in lines[:idx] if "|" in s and "time" in s.lower()), None)
    result["country"] = meta.get("Country")
    return result
