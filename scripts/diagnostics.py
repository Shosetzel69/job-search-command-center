"""Structured, sanitized diagnostic events for job-search execution."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SERVICE_NAME = "job-search-runner"
MAX_MESSAGE_LENGTH = 800

SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "apikey",
    "secret",
    "password",
    "credential",
    "credentials",
    "connection_string",
    "dsn",
    "github_token",
}

SENSITIVE_QUERY_KEYS = {
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "apikey",
    "key",
    "secret",
    "signature",
    "sig",
    "x-amz-signature",
    "x-goog-signature",
    "code",
}

TOKEN_PATTERNS = (
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"),
)

KEY_VALUE_PATTERN = re.compile(
    r"(?i)\b(authorization|cookie|set-cookie|token|access_token|id_token|refresh_token|api[_-]?key|secret|password|credential)\b\s*[:=]\s*([^\s,;]+)"
)


def _sanitize_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return value

    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    netloc = hostname + port
    query = []
    for key, item in parse_qsl(parsed.query, keep_blank_values=True):
        query.append((key, "[REDACTED]" if key.casefold() in SENSITIVE_QUERY_KEYS else item))
    return urlunsplit((parsed.scheme, netloc, parsed.path, urlencode(query), parsed.fragment))


def sanitize_text(value: Any) -> str:
    text = str(value or "")
    if not text:
        return text

    text = KEY_VALUE_PATTERN.sub(lambda match: f"{match.group(1)}=[REDACTED]", text)
    for pattern in TOKEN_PATTERNS:
        text = pattern.sub("[REDACTED]", text)

    # Sanitize URL query/userinfo without requiring callers to identify URL fields.
    parts = text.split()
    sanitized_parts = []
    for part in parts:
        stripped = part.strip("()[]{}<>,;'\"")
        if stripped.startswith(("http://", "https://")):
            sanitized = _sanitize_url(stripped)
            sanitized_parts.append(part.replace(stripped, sanitized))
        else:
            sanitized_parts.append(part)
    text = " ".join(sanitized_parts)

    if len(text) > MAX_MESSAGE_LENGTH:
        text = text[:MAX_MESSAGE_LENGTH] + "...[TRUNCATED]"
    return text


def sanitize(value: Any, key: str | None = None) -> Any:
    if key and key.casefold() in SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): sanitize(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return sanitize_text(value)
    return value


def environment_name() -> str:
    return (os.environ.get("APP_ENV") or os.environ.get("ENVIRONMENT") or "unknown").strip().lower() or "unknown"


def build_event(event_name: str, level: str = "INFO", **fields: Any) -> dict[str, Any]:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": str(level).upper(),
        "event_name": event_name,
        "service": SERVICE_NAME,
        "environment": environment_name(),
        **fields,
    }
    return sanitize(payload)


def emit_event(event_name: str, level: str = "INFO", **fields: Any) -> dict[str, Any]:
    payload = build_event(event_name, level, **fields)
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return payload


def source_fields(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_execution_id": item.get("source_execution_id"),
        "source_id": item.get("source_id"),
        "source": item.get("source"),
        "connector": item.get("connector"),
        "collection_method": item.get("collection_method"),
    }


def source_level(item: dict[str, Any]) -> str:
    outcome = item.get("outcome")
    if outcome == "failed":
        return "WARN"
    if outcome == "blocked_credentials":
        return "WARN"
    return "INFO"
