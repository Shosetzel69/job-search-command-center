"""PostgreSQL repository for the shared canonical job corpus.

ATC-275-03 keeps provider retrieval shared/system-owned. This module owns the
Python Cloud Run Job persistence boundary and deliberately contains no profile
or user inputs.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlsplit

import role_taxonomy
from job_identity import canonical_url

EXPECTED_DATABASES = {
    "dev": "jobsearch_dev",
    "test": "jobsearch_test",
    "prod": "jobsearch_prod",
}

PERSONAL_FIELDS = frozenset({
    "fit",
    "status",
    "pros",
    "risks",
    "repost",
    "romania_eligible",
})

COMPLETE_SOURCE_OUTCOMES = frozenset({"success", "success_empty"})


class SharedCorpusError(RuntimeError):
    """Raised when shared-corpus persistence cannot safely proceed."""


@dataclass(frozen=True)
class SharedPosting:
    source_id: str
    source_name: str
    external_job_id: str | None
    canonical_url: str | None
    identity_kind: str
    identity_value: str
    title: str
    company: str
    location: str | None
    country_codes: tuple[str, ...]
    work_mode: str | None
    role_family: str
    posted_at: str | None
    repost_of_external_job_id: str | None
    payload: dict[str, Any]


def _text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _json_safe(value: object) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


@lru_cache(maxsize=1)
def _taxonomy() -> dict[str, Any]:
    payload = json.loads(role_taxonomy.DEFAULT_TAXONOMY_PATH.read_text(encoding="utf-8"))
    role_taxonomy.validate_taxonomy(payload)
    return payload


def _role_family(title: str) -> tuple[str, str]:
    classification = role_taxonomy.classify_title(title, _taxonomy())
    family = classification.get("role_family")
    if family not in role_taxonomy.CANONICAL_FAMILIES:
        family = "UNKNOWN"
    return str(family), str(classification.get("classification_status") or "unknown")


def _work_mode(record: Mapping[str, Any]) -> str | None:
    raw = _text(record.get("work_arrangement") or record.get("work_mode")).casefold()
    if bool(record.get("remote")) or raw == "remote":
        return "REMOTE"
    if bool(record.get("hybrid")) or raw == "hybrid":
        return "HYBRID"
    if raw in {"onsite", "on-site", "on site"}:
        return "ONSITE"
    return raw.upper() if raw else None


def _country_codes(record: Mapping[str, Any]) -> tuple[str, ...]:
    values: list[object] = []
    if isinstance(record.get("country_codes"), list):
        values.extend(record["country_codes"])
    values.extend([record.get("country_code"), record.get("job_country_code")])
    return tuple(sorted({_text(value).upper() for value in values if _text(value)}))


def _external_job_id(record: Mapping[str, Any]) -> str | None:
    for key in ("external_job_id", "job_id", "requisition_id", "id"):
        value = _text(record.get(key))
        if value:
            return value
    return None


def _posting_url(record: Mapping[str, Any]) -> str | None:
    return canonical_url(record.get("final_url") or record.get("source_url") or record.get("url"))


def _payload(record: Mapping[str, Any], classification_status: str) -> dict[str, Any]:
    payload = {
        str(key): _json_safe(value)
        for key, value in record.items()
        if key not in PERSONAL_FIELDS and not str(key).startswith("_jscc_")
    }
    payload["role_classification_status"] = classification_status
    return payload


def prepare_posting(record: Mapping[str, Any], source_hint: str | None = None) -> SharedPosting | None:
    source_id = _text(record.get("_jscc_source_id"))
    source_name = _text(record.get("_jscc_source_name") or record.get("source") or source_hint)
    if not source_id:
        if not source_name:
            return None
        source_id = "legacy:" + re.sub(r"[^a-z0-9]+", "-", source_name.casefold()).strip("-")

    external_job_id = _external_job_id(record)
    url = _posting_url(record)
    if external_job_id:
        identity_kind = "EXTERNAL_ID"
        identity_value = external_job_id
    elif url:
        identity_kind = "CANONICAL_URL"
        identity_value = url
    else:
        return None

    title = _text(record.get("job_title") or record.get("title"))
    company = _text(record.get("company") or record.get("company_name"))
    if not title or not company:
        return None

    family, classification_status = _role_family(title)
    repost_of = _text(record.get("repost_of_external_job_id") or record.get("repost_of_id")) or None

    return SharedPosting(
        source_id=source_id,
        source_name=source_name or source_id,
        external_job_id=external_job_id,
        canonical_url=url,
        identity_kind=identity_kind,
        identity_value=identity_value,
        title=title,
        company=company,
        location=_text(record.get("location") or record.get("short_location")) or None,
        country_codes=_country_codes(record),
        work_mode=_work_mode(record),
        role_family=family,
        posted_at=_text(record.get("date_posted") or record.get("posted_at")) or None,
        repost_of_external_job_id=repost_of,
        payload=_payload(record, classification_status),
    )


def project_collection(collection: Sequence[object]) -> tuple[list[SharedPosting], int]:
    postings: list[SharedPosting] = []
    skipped = 0
    for result in collection:
        if not bool(getattr(result, "ok", False)):
            continue
        connector = _text(getattr(result, "connector", ""))
        source_hint = "JobsPipe" if connector.casefold().startswith("jobspipe") else connector
        for record in getattr(result, "records", []) or []:
            posting = prepare_posting(record, source_hint=source_hint)
            if posting is None:
                skipped += 1
            else:
                postings.append(posting)
    return postings, skipped


def expected_database(env: Mapping[str, str]) -> tuple[str, str]:
    app_env = _text(env.get("APP_ENV")).casefold()
    expected = EXPECTED_DATABASES.get(app_env)
    if not expected:
        raise SharedCorpusError("APP_ENV must be dev, test or prod for shared-corpus persistence")
    connection_string = _text(env.get("NILE_DATABASE_URL"))
    if not connection_string:
        raise SharedCorpusError("NILE_DATABASE_URL is required for shared-corpus persistence")
    try:
        parsed = urlsplit(connection_string)
    except ValueError as exc:
        raise SharedCorpusError("NILE_DATABASE_URL is invalid") from exc
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise SharedCorpusError("NILE_DATABASE_URL must use PostgreSQL")
    actual = parsed.path.lstrip("/")
    if actual != expected:
        raise SharedCorpusError(f"Database binding mismatch: expected {expected}")
    return expected, connection_string


def _is_cloud_runtime(env: Mapping[str, str]) -> bool:
    mode = _text(env.get("JSCC_RUNTIME_MODE")).casefold()
    return bool(
        mode in {"container", "gcp", "cloud-run"}
        or env.get("K_SERVICE")
        or env.get("CLOUD_RUN_JOB")
        or env.get("CLOUD_RUN_EXECUTION")
    )


def _resolve_repost(cursor: Any, posting: SharedPosting) -> str | None:
    if not posting.repost_of_external_job_id:
        return None
    cursor.execute(
        """
        SELECT posting_id
        FROM source_postings
        WHERE source_id = %s
          AND identity_kind = 'EXTERNAL_ID'
          AND identity_value = %s
        """,
        (posting.source_id, posting.repost_of_external_job_id),
    )
    row = cursor.fetchone()
    return str(row[0]) if row else None


def _upsert_posting(cursor: Any, posting: SharedPosting, run_id: str, now: datetime) -> tuple[str, bool]:
    cursor.execute(
        """
        SELECT posting_id, job_id
        FROM source_postings
        WHERE source_id = %s
          AND identity_kind = %s
          AND identity_value = %s
        """,
        (posting.source_id, posting.identity_kind, posting.identity_value),
    )
    existing = cursor.fetchone()
    repost_of_posting_id = _resolve_repost(cursor, posting)

    if existing:
        posting_id, job_id = str(existing[0]), str(existing[1])
        cursor.execute(
            """
            UPDATE source_postings
               SET source_name = %s,
                   external_job_id = %s,
                   canonical_url = %s,
                   lifecycle_status = 'ACTIVE',
                   last_seen_at = %s,
                   inactive_at = NULL,
                   seen_run_id = %s,
                   repost_of_posting_id = %s,
                   payload = %s::jsonb
             WHERE posting_id = %s
            """,
            (
                posting.source_name,
                posting.external_job_id,
                posting.canonical_url,
                now,
                run_id,
                repost_of_posting_id,
                json.dumps(posting.payload, ensure_ascii=False),
                posting_id,
            ),
        )
        created = False
    else:
        job_id: str | None = None
        if posting.canonical_url:
            cursor.execute(
                """
                SELECT job_id
                FROM source_postings
                WHERE canonical_url = %s
                  AND source_id <> %s
                ORDER BY first_seen_at ASC, posting_id ASC
                LIMIT 1
                """,
                (posting.canonical_url, posting.source_id),
            )
            cross_source = cursor.fetchone()
            if cross_source:
                job_id = str(cross_source[0])

        if not job_id:
            job_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO canonical_jobs(
                    job_id, title, company, location, country_codes, work_mode,
                    role_family, lifecycle_status, first_seen_at, last_seen_at, payload
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'ACTIVE', %s, %s, %s::jsonb)
                """,
                (
                    job_id,
                    posting.title,
                    posting.company,
                    posting.location,
                    list(posting.country_codes),
                    posting.work_mode,
                    posting.role_family,
                    now,
                    now,
                    json.dumps(posting.payload, ensure_ascii=False),
                ),
            )

        posting_id = str(uuid.uuid4())
        cursor.execute(
            """
            INSERT INTO source_postings(
                posting_id, job_id, source_id, source_name, external_job_id,
                canonical_url, identity_kind, identity_value, lifecycle_status,
                first_seen_at, last_seen_at, seen_run_id, repost_of_posting_id, payload
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, 'ACTIVE',
                %s, %s, %s, %s, %s::jsonb
            )
            """,
            (
                posting_id,
                job_id,
                posting.source_id,
                posting.source_name,
                posting.external_job_id,
                posting.canonical_url,
                posting.identity_kind,
                posting.identity_value,
                now,
                now,
                run_id,
                repost_of_posting_id,
                json.dumps(posting.payload, ensure_ascii=False),
            ),
        )
        created = True

    cursor.execute(
        """
        UPDATE canonical_jobs
           SET title = %s,
               company = %s,
               location = %s,
               country_codes = %s,
               work_mode = %s,
               role_family = %s,
               lifecycle_status = 'ACTIVE',
               last_seen_at = %s,
               inactive_at = NULL,
               retention_until = NULL,
               payload = %s::jsonb
         WHERE job_id = %s
        """,
        (
            posting.title,
            posting.company,
            posting.location,
            list(posting.country_codes),
            posting.work_mode,
            posting.role_family,
            now,
            json.dumps(posting.payload, ensure_ascii=False),
            job_id,
        ),
    )
    return job_id, created


def _advance_lifecycle(cursor: Any, complete_source_ids: Iterable[str], run_id: str, now: datetime) -> int:
    source_ids = sorted({_text(value) for value in complete_source_ids if _text(value)})
    if not source_ids:
        return 0

    cursor.execute(
        """
        UPDATE source_postings
           SET lifecycle_status = CASE
                   WHEN lifecycle_status = 'ACTIVE' THEN 'UNCONFIRMED'
                   WHEN lifecycle_status = 'UNCONFIRMED' THEN 'INACTIVE'
                   ELSE lifecycle_status
               END,
               inactive_at = CASE
                   WHEN lifecycle_status = 'UNCONFIRMED' THEN %s
                   ELSE inactive_at
               END
         WHERE source_id = ANY(%s)
           AND seen_run_id IS DISTINCT FROM %s
           AND lifecycle_status IN ('ACTIVE', 'UNCONFIRMED')
        """,
        (now, source_ids, run_id),
    )
    advanced = int(getattr(cursor, "rowcount", 0) or 0)

    cursor.execute(
        """
        WITH states AS (
            SELECT job_id,
                   bool_or(lifecycle_status = 'ACTIVE') AS has_active,
                   bool_or(lifecycle_status = 'UNCONFIRMED') AS has_unconfirmed
            FROM source_postings
            GROUP BY job_id
        ),
        next_state AS (
            SELECT job_id,
                   CASE
                       WHEN has_active THEN 'ACTIVE'
                       WHEN has_unconfirmed THEN 'UNCONFIRMED'
                       ELSE 'INACTIVE'
                   END AS lifecycle_status
            FROM states
        )
        UPDATE canonical_jobs AS job
           SET lifecycle_status = state.lifecycle_status,
               inactive_at = CASE
                   WHEN state.lifecycle_status = 'INACTIVE'
                        AND job.lifecycle_status <> 'INACTIVE' THEN %s
                   WHEN state.lifecycle_status <> 'INACTIVE' THEN NULL
                   ELSE job.inactive_at
               END,
               retention_until = CASE
                   WHEN state.lifecycle_status = 'INACTIVE'
                        AND job.lifecycle_status <> 'INACTIVE' THEN %s + interval '90 days'
                   WHEN state.lifecycle_status <> 'INACTIVE' THEN NULL
                   ELSE job.retention_until
               END
          FROM next_state AS state
         WHERE job.job_id = state.job_id
        """,
        (now, now),
    )
    return advanced


def _complete_source_ids(plan: Sequence[Mapping[str, Any]]) -> set[str]:
    return {
        _text(item.get("source_id"))
        for item in plan
        if item.get("outcome") in COMPLETE_SOURCE_OUTCOMES and _text(item.get("source_id"))
    }


def persist_collection(
    collection: Sequence[object],
    plan: Sequence[Mapping[str, Any]],
    *,
    run_id: str,
    now: datetime,
    env: Mapping[str, str] | None = None,
    connect: Any | None = None,
) -> dict[str, Any]:
    runtime_env = os.environ if env is None else env
    connection_string = _text(runtime_env.get("NILE_DATABASE_URL"))
    if not connection_string:
        if _is_cloud_runtime(runtime_env):
            raise SharedCorpusError("NILE_DATABASE_URL is required in container/GCP runtime")
        return {
            "status": "local_not_configured",
            "records_projected": 0,
            "records_skipped": 0,
            "postings_created": 0,
            "postings_updated": 0,
            "lifecycle_advanced": 0,
        }

    expected, connection_string = expected_database(runtime_env)
    if connect is None:
        try:
            import psycopg
        except ImportError as exc:
            raise SharedCorpusError("psycopg is required for shared-corpus persistence") from exc
        connect = psycopg.connect

    postings, skipped = project_collection(collection)
    complete_source_ids = _complete_source_ids(plan)

    created = 0
    updated = 0
    with connect(connection_string) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            row = cursor.fetchone()
            actual = str(row[0]) if row else ""
            if actual != expected:
                raise SharedCorpusError(
                    f"Connected database does not match environment binding: expected {expected}"
                )

            for posting in postings:
                _, was_created = _upsert_posting(cursor, posting, run_id, now)
                if was_created:
                    created += 1
                else:
                    updated += 1

            advanced = _advance_lifecycle(cursor, complete_source_ids, run_id, now)

    return {
        "status": "persisted",
        "records_projected": len(postings),
        "records_skipped": skipped,
        "postings_created": created,
        "postings_updated": updated,
        "lifecycle_advanced": advanced,
        "complete_sources": len(complete_source_ids),
    }
