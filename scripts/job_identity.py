"""Conservative cross-source deduplication for normalized published jobs."""

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def canonical_url(value):
    try:
        url = urlsplit(str(value or ""))
        if url.scheme not in {"http", "https"} or not url.hostname:
            return None
        query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True)
                 if not k.lower().startswith("utm_") and k.lower() not in {"gclid", "fbclid"}]
        return urlunsplit((url.scheme, url.netloc.lower(), url.path.rstrip("/"), urlencode(sorted(query)), ""))
    except ValueError:
        return None


def deduplicate(jobs):
    retained, urls, identities = [], set(), {}
    for job in jobs:
        url = canonical_url(job.get("url"))
        clean = lambda value: re.sub(r"\s+", " ", str(value or "").strip().casefold())
        title, company = clean(job.get("title")), clean(job.get("company"))
        geography = tuple(sorted(job.get("country_codes") or [])) or (clean(job.get("location")),)
        identity = (title, company, geography, clean(job.get("mode")))
        provider = clean(job.get("source"))
        other_sources = identities.get(identity, set())
        # Same-source requisitions with different IDs/URLs remain distinct.
        duplicate = bool(url and url in urls) or bool(title and company and other_sources - {provider})
        if duplicate:
            continue
        retained.append(job)
        if url:
            urls.add(url)
        identities.setdefault(identity, set()).add(provider)
    return retained
