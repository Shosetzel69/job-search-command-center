"""F-02 browser egress policy contract. Fail closed; no network calls.

Actual enforcement MUST occur outside Chromium in an isolated network namespace
or container with direct egress denied and a separately reviewed CONNECT proxy.
This module validates requests handed to that proxy, not a substitute for it.
"""
from urllib.parse import urlsplit

ALLOWED_HOSTS = frozenset({
    "osf-global.zohorecruit.com",
    "madiffpl.zohorecruit.com",
})

def authorize_connect(authority):
    if not isinstance(authority, str) or not authority or any(c.isspace() for c in authority):
        return False
    try:
        parsed = urlsplit("https://" + authority)
        return (parsed.hostname in ALLOWED_HOSTS
                and parsed.port == 443
                and parsed.username is None and parsed.password is None
                and parsed.path == "" and parsed.query == "" and parsed.fragment == ""
                and authority == parsed.hostname + ":443")
    except ValueError:
        return False

def authorize_navigation(url):
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS
                and parsed.username is None and parsed.password is None
                and parsed.port in (None, 443)
                and not parsed.fragment)
    except ValueError:
        return False
