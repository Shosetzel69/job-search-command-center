"""PostgreSQL repository for the shared canonical job corpus.

ATC-275-03 keeps provider retrieval shared/system-owned. This module owns the
Python Cloud Run Job persistence boundary and deliberately contains no profile
or user inputs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlsplit

import nomenclatures as canonical_nomenclatures
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
    work_mode: str
    role_family: str
    posted_at: datetime | None
    repost_of_external_job_id: str | None
    payload: dict[str, Any]
    role_subfamily: tuple[str, ...] = ()
    seniority: str = "unknown"
    contract_type: str = "unknown"
    remote_scope: str = "unknown"
    classification_status: str = "unknown"
    classification_confidence: float = 0.0
    classification_version: str = "legacy"
    evaluation_basis_hash: str = ""


def _text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _json_safe(value: object) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


@lru_cache(maxsize=1)
def _taxonomy() -> dict[str, Any]:
    payload = json.loads(role_taxonomy.DEFAULT_TAXONOMY_PATH.read_text(encoding="utf-8"))
    role_taxonomy.validate_taxonomy(payload)
    return payload


def _role_classification(title: str) -> dict[str, Any]:
    classification = role_taxonomy.classify_title(title, _taxonomy())
    family = classification.get("role_family")
    if family not in role_taxonomy.CANONICAL_FAMILIES:
        family = "UNKNOWN"
    return {
        "role_family": str(family or "UNKNOWN"),
        "role_subfamily": tuple(sorted(str(x) for x in classification.get("role_member", []) if x)),
        "classification_status": str(classification.get("classification_status") or "unknown"),
    }


def _role_family(title: str) -> tuple[str, str]:
    classification = _role_classification(title)
    return classification["role_family"], classification["classification_status"]


def _contract_type(record: Mapping[str, Any]) -> str:
    explicit = _text(record.get("contract_type")).casefold()
    if explicit in {"permanent", "temporary", "contract", "freelance"}:
        return explicit
    raw_value = (
        record.get("employment_statuses")
        or record.get("employment_type")
        or record.get("employment_status")
        or record.get("job_type")
        or ""
    )
    values = raw_value if isinstance(raw_value, list) else [raw_value]
    raw = " ".join(_text(value) for value in values).casefold()
    if "freelance" in raw:
        return "freelance"
    if re.search(r"contract|contractor|b2b", raw):
        return "contract"
    if re.search(r"temporary|fixed[- ]term", raw):
        return "temporary"
    if re.search(r"permanent|full[- ]time", raw):
        return "permanent"
    return "unknown"


def _normalize_remote_scope(value: object) -> str:
    normalized = role_taxonomy.normalize_title(value)
    if not normalized:
        return "unknown"
    if normalized in {"worldwide", "global", "global remote", "anywhere", "work from anywhere", "anywhere in the world"}:
        return "Worldwide"
    if normalized == "emea":
        return "EMEA"
    if normalized in {"eu", "europe", "european union", "eu only", "europe only", "within europe", "across europe"}:
        return "EU"
    if normalized in {"country", "country only", "national", "specific country"}:
        return "Country"
    return "unknown"


def _remote_scope(record: Mapping[str, Any], work_mode: str, country_codes: tuple[str, ...]) -> str:
    explicit = _text(record.get("remote_scope"))
    if explicit:
        return _normalize_remote_scope(explicit)
    if work_mode != "remote":
        return "unknown"
    if country_codes:
        return "Country"
    countries = record.get("countries") if isinstance(record.get("countries"), list) else []
    remote_locations = record.get("remote_locations") if isinstance(record.get("remote_locations"), list) else []
    text = " ".join([
        _text(record.get("location")),
        *(_text(value) for value in countries),
        *(_text(value) for value in remote_locations),
        _text(record.get("description"))[:5000],
    ])
    if re.search(r"worldwide|work from anywhere|anywhere in the world|global remote", text, re.I):
        return "Worldwide"
    if re.search(r"\bEMEA\b", text, re.I):
        return "EMEA"
    if re.search(r"\b(EU|European Union|Europe only|within Europe|across Europe|Europe)\b", text, re.I):
        return "EU"
    return "unknown"


def _seniority(record: Mapping[str, Any]) -> str:
    raw = _text(record.get("seniority") or record.get("seniority_level") or record.get("experience_level"))
    if not raw:
        return "unknown"
    normalized = role_taxonomy.normalize_title(raw).replace(" ", "_")
    return normalized or "unknown"


def _evaluation_basis_hash(
    *,
    title: str,
    company: str,
    location: str | None,
    country_codes: tuple[str, ...],
    work_mode: str,
    role_family: str,
    role_subfamily: tuple[str, ...],
    seniority: str,
    contract_type: str,
    remote_scope: str,
    description: object,
) -> str:
    basis = {
        "title": _text(title),
        "company": _text(company),
        "location": _text(location),
        "country_codes": sorted(country_codes),
        "work_mode": work_mode,
        "role_family": role_family,
        "role_subfamily": sorted(role_subfamily),
        "seniority": seniority,
        "contract_type": contract_type,
        "remote_scope": remote_scope,
        "description": _text(description),
    }
    encoded = json.dumps(basis, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def _nomenclatures() -> dict[str, Any]:
    return canonical_nomenclatures.load_nomenclatures()


def _work_mode(record: Mapping[str, Any]) -> str:
    raw = _text(record.get("work_arrangement") or record.get("work_mode") or record.get("mode"))
    if bool(record.get("remote")):
        return "remote"
    if bool(record.get("hybrid")):
        return "hybrid"
    return canonical_nomenclatures.normalize_work_mode(raw, _nomenclatures())


def _country_codes(record: Mapping[str, Any]) -> tuple[str, ...]:
    codes: set[str] = set()
    active = canonical_nomenclatures.active_country_codes(_nomenclatures())
    aliases = canonical_nomenclatures.country_name_to_code(_nomenclatures())

    raw_values: list[object] = []
    if isinstance(record.get("country_codes"), list):
        raw_values.extend(record["country_codes"])
    raw_values.extend([record.get("country_code"), record.get("job_country_code")])

    countries = record.get("countries")
    if isinstance(countries, list):
        raw_values.extend(countries)
    elif countries:
        raw_values.append(countries)

    for value in raw_values:
        if isinstance(value, Mapping):
            value = value.get("code") or value.get("country") or value.get("name")
        text = _text(value)
        if not text:
            continue
        upper = text.upper()
        if upper in active:
            codes.add(upper)
            continue
        mapped = aliases.get(text.casefold())
        if mapped:
            codes.add(mapped)

    return tuple(sorted(codes))


def _posted_at(record: Mapping[str, Any]) -> datetime | None:
    text = _text(record.get("date_posted") or record.get("posted_at"))
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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
    role_details = _role_classification(title)
    if role_details["role_family"] != family:
        role_details = {
            **role_details,
            "role_family": family,
            "role_subfamily": (),
            "classification_status": classification_status,
        }
    country_codes = _country_codes(record)
    work_mode = _work_mode(record)
    contract_type = _contract_type(record)
    remote_scope = _remote_scope(record, work_mode, country_codes)
    seniority = _seniority(record)
    role_subfamily = tuple(role_details["role_subfamily"])
    confidence = 1.0 if classification_status == "matched" else 0.0
    classification_version = str(_taxonomy()["taxonomy_version"])
    basis_hash = _evaluation_basis_hash(
        title=title,
        company=company,
        location=_text(record.get("location") or record.get("short_location")) or None,
        country_codes=country_codes,
        work_mode=work_mode,
        role_family=family,
        role_subfamily=role_subfamily,
        seniority=seniority,
        contract_type=contract_type,
        remote_scope=remote_scope,
        description=record.get("description"),
    )
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
        country_codes=country_codes,
        work_mode=work_mode,
        role_family=family,
        posted_at=_posted_at(record),
        repost_of_external_job_id=repost_of,
        payload=_payload(record, classification_status),
        role_subfamily=role_subfamily,
        seniority=seniority,
        contract_type=contract_type,
        remote_scope=remote_scope,
        classification_status=classification_status,
        classification_confidence=confidence,
        classification_version=classification_version,
        evaluation_basis_hash=basis_hash,
    )


def project_collection(
    collection: Sequence[object],
) -> tuple[list[SharedPosting], int, set[str], bool]:
    postings: list[SharedPosting] = []
    skipped = 0
    incomplete_source_ids: set[str] = set()
    global_projection_gap = False

    for result in collection:
        if not bool(getattr(result, "ok", False)):
            continue
        connector = _text(getattr(result, "connector", ""))
        source_hint = "JobsPipe" if connector.casefold().startswith("jobspipe") else connector
        for record in getattr(result, "records", []) or []:
            if not isinstance(record, Mapping):
                skipped += 1
                global_projection_gap = True
                continue
            posting = prepare_posting(record, source_hint=source_hint)
            if posting is None:
                skipped += 1
                source_id = _text(record.get("_jscc_source_id"))
                if source_id:
                    incomplete_source_ids.add(source_id)
                else:
                    global_projection_gap = True
            else:
                postings.append(posting)

    return postings, skipped, incomplete_source_ids, global_projection_gap


def expected_database(env: Mapping[str, str]) -> tuple[str, str]:
    app_env = _text(env.get("APP_ENV")).casefold()
    expected = EXPECTED_DATABASES.get(app_env)
    if not expected:
        raise SharedCorpusError("APP_ENV must be dev, test or prod for shared-corpus persistence")
    connection_string = str(env.get("NILE_DATABASE_URL") or "").strip()
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


def _posting_id(posting: SharedPosting) -> str:
    identity = f"{posting.source_id}\0{posting.identity_kind}\0{posting.identity_value}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "urn:jscc:source-posting:" + identity))


def _job_id(posting: SharedPosting) -> str:
    # A new requisition from the same source remains a distinct canonical job.
    # Cross-source exact-URL reuse is decided by the repository lookup before
    # this ID is created, avoiding URL-only false merges inside one source.
    identity = f"{posting.source_id}\0{posting.identity_kind}\0{posting.identity_value}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "urn:jscc:canonical-job:" + identity))


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

    # If a provider upgrades a posting from URL-only identity to an external ID,
    # promote the existing same-source row instead of manufacturing a duplicate.
    # External ID remains the authoritative identity after this transition.
    if not existing and posting.identity_kind == "EXTERNAL_ID" and posting.canonical_url:
        cursor.execute(
            """
            SELECT posting_id, job_id
            FROM source_postings
            WHERE source_id = %s
              AND identity_kind = 'CANONICAL_URL'
              AND canonical_url = %s
            """,
            (posting.source_id, posting.canonical_url),
        )
        url_identity = cursor.fetchone()
        if url_identity:
            existing = url_identity
            cursor.execute(
                """
                UPDATE source_postings
                   SET identity_kind = 'EXTERNAL_ID',
                       identity_value = %s,
                       external_job_id = %s
                 WHERE posting_id = %s
                """,
                (posting.external_job_id, posting.external_job_id, str(url_identity[0])),
            )

    if not existing and posting.identity_kind == "CANONICAL_URL" and posting.canonical_url:
        # External ID remains authoritative when a later provider response omits
        # it. Reuse a same-source URL only when that URL is unambiguous.
        cursor.execute(
            """
            SELECT posting_id, job_id
            FROM (
                SELECT posting_id, job_id, count(*) OVER () AS match_count
                FROM source_postings
                WHERE source_id = %s
                  AND canonical_url = %s
            ) AS candidate
            WHERE match_count = 1
            LIMIT 1
            """,
            (posting.source_id, posting.canonical_url),
        )
        existing = cursor.fetchone()

    repost_of_posting_id = _resolve_repost(cursor, posting)

    if existing:
        posting_id, job_id = str(existing[0]), str(existing[1])
        cursor.execute(
            """
            UPDATE source_postings
               SET source_name = %s,
                   external_job_id = COALESCE(%s, external_job_id),
                   canonical_url = %s,
                   posted_at = %s,
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
                posting.posted_at,
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
            job_id = _job_id(posting)
            cursor.execute(
                """
                INSERT INTO canonical_jobs(
                    job_id, title, company, location, country_codes, work_mode,
                    role_family, role_subfamily, seniority, contract_type, remote_scope,
                    classification_status, classification_confidence, classification_version,
                    evaluation_basis_hash, lifecycle_status, first_seen_at, last_seen_at, payload
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    'ACTIVE', %s, %s, %s::jsonb
                )
                """,
                (
                    job_id,
                    posting.title,
                    posting.company,
                    posting.location,
                    list(posting.country_codes),
                    posting.work_mode,
                    posting.role_family,
                    list(posting.role_subfamily),
                    posting.seniority,
                    posting.contract_type,
                    posting.remote_scope,
                    posting.classification_status,
                    posting.classification_confidence,
                    posting.classification_version,
                    posting.evaluation_basis_hash,
                    now,
                    now,
                    json.dumps(posting.payload, ensure_ascii=False),
                ),
            )

        posting_id = _posting_id(posting)
        cursor.execute(
            """
            INSERT INTO source_postings(
                posting_id, job_id, source_id, source_name, external_job_id,
                canonical_url, identity_kind, identity_value, posted_at, lifecycle_status,
                first_seen_at, last_seen_at, seen_run_id, repost_of_posting_id, payload
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ACTIVE',
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
                posting.posted_at,
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
           SET job_version = CASE
                 WHEN evaluation_basis_hash IS DISTINCT FROM %s THEN job_version + 1
                 ELSE job_version
               END,
               title = %s,
               company = %s,
               location = %s,
               country_codes = %s,
               work_mode = %s,
               role_family = %s,
               role_subfamily = %s,
               seniority = %s,
               contract_type = %s,
               remote_scope = %s,
               classification_status = %s,
               classification_confidence = %s,
               classification_version = %s,
               evaluation_basis_hash = %s,
               lifecycle_status = 'ACTIVE',
               last_seen_at = %s,
               inactive_at = NULL,
               retention_until = NULL,
               payload = %s::jsonb
         WHERE job_id = %s
        """,
        (
            posting.evaluation_basis_hash,
            posting.title,
            posting.company,
            posting.location,
            list(posting.country_codes),
            posting.work_mode,
            posting.role_family,
            list(posting.role_subfamily),
            posting.seniority,
            posting.contract_type,
            posting.remote_scope,
            posting.classification_status,
            posting.classification_confidence,
            posting.classification_version,
            posting.evaluation_basis_hash,
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
    advance_lifecycle: bool = True,
) -> dict[str, Any]:
    runtime_env = os.environ if env is None else env
    connection_string = str(runtime_env.get("NILE_DATABASE_URL") or "").strip()
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

    postings, skipped, incomplete_source_ids, global_projection_gap = project_collection(collection)
    complete_source_ids = _complete_source_ids(plan)
    if not advance_lifecycle or global_projection_gap:
        complete_source_ids = set()
    else:
        complete_source_ids.difference_update(incomplete_source_ids)

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
        "lifecycle_suppressed_sources": sorted(incomplete_source_ids),
        "global_projection_gap": global_projection_gap,
        "lifecycle_suppressed_targeted": not advance_lifecycle,
    }


def shared_collection_config(
    config: Mapping[str, Any],
    retrieve_scope: Mapping[str, Any] | None = None,
    request_signature: str | None = None,
) -> dict[str, Any]:
    """Build a system-owned collection envelope, optionally bounded by R1 scope."""
    taxonomy = _taxonomy()
    scopes = retrieve_scope.get("scopes") if isinstance(retrieve_scope, Mapping) else []
    scopes = [item for item in scopes or [] if isinstance(item, Mapping)]
    selected_families = {
        _text(item.get("role_family")).upper()
        for item in scopes
        if _text(item.get("role_family")).upper() in role_taxonomy.CANONICAL_FAMILIES
        and _text(item.get("role_family")).upper() != "UNKNOWN"
    }
    families = [
        family for family in role_taxonomy.CANONICAL_FAMILIES
        if family != "UNKNOWN" and (not selected_families or family in selected_families)
    ]

    titles: list[str] = []
    for family in families:
        for member in taxonomy["families"][family]["members"]:
            label = _text(member.get("label"))
            if label and label not in titles:
                titles.append(label)

    shared = {
        key: config[key]
        for key in SYSTEM_COLLECTION_KEYS
        if key in config
    }
    shared["role_groups"] = {
        "shared_canonical_roles": {
            "enabled": True,
            "titles": titles,
        }
    }

    if scopes:
        shared["target_regions"] = sorted({
            _text(value).upper()
            for scope in scopes for value in (scope.get("target_regions") or [])
            if _text(value)
        })
        shared["target_country_codes"] = sorted({
            _text(value).upper()
            for scope in scopes for value in (scope.get("target_country_codes") or [])
            if _text(value)
        })
        shared["search_country_codes"] = list(shared["target_country_codes"])
        shared["eligible_remote_country_codes"] = sorted({
            _text(value).upper()
            for scope in scopes for value in (scope.get("remote_eligible_country_codes") or [])
            if _text(value)
        })
        work_modes = {
            _text(value).casefold()
            for scope in scopes for value in (scope.get("work_modes") or [])
            if _text(value)
        }
        shared["work_modes"] = {mode: mode in work_modes for mode in ("remote", "hybrid", "onsite")}
        shared["contract_types"] = sorted({
            _text(value).casefold()
            for scope in scopes for value in (scope.get("contract_types") or [])
            if _text(value)
        })
        shared["_jscc_shared_collection"] = False
        shared["_jscc_targeted_collection"] = True
        shared["_jscc_retrieve_scope"] = _json_safe(retrieve_scope)
        shared["_jscc_request_signature"] = _text(request_signature).casefold()
    else:
        shared["target_regions"] = []
        shared["target_country_codes"] = []
        shared["search_country_codes"] = []
        shared["excluded_regions"] = []
        shared["excluded_country_codes"] = []
        shared["_jscc_shared_collection"] = True

    shared["excluded_regions"] = []
    shared["excluded_country_codes"] = []
    return shared


SYSTEM_COLLECTION_KEYS = (
    "collection_freshness_hours",
    "source_strategy",
    "web_browser_fallback_enabled",
    "jobspipe_credit_budget_per_run",
    "jobspipe_monthly_credit_guard",
    "jobspipe_incremental_overlap_minutes",
    "jobspipe_mode",
    "jobspipe_apify_max_items_per_run",
    "coverage_min_corpus_volume",
    "coverage_max_corpus_volume",
    "coverage_min_source_diversity",
    "coverage_refresh_cooldown_hours",
)


def _db_connect(runtime_env: Mapping[str, str], connect: Any | None = None):
    expected, connection_string = expected_database(runtime_env)
    if connect is None:
        try:
            import psycopg
        except ImportError as exc:
            raise SharedCorpusError("psycopg is required for PostgreSQL persistence") from exc
        connect = psycopg.connect
    return expected, connection_string, connect


def apply_collection_policy(
    config: Mapping[str, Any],
    *,
    env: Mapping[str, str] | None = None,
    connect: Any | None = None,
) -> dict[str, Any]:
    """Overlay only system-owned collection settings from PostgreSQL.

    Profile criteria remain outside this system policy. The legacy file is still
    accepted as the transitional collector baseline until final JSON retirement.
    """
    runtime_env = os.environ if env is None else env
    connection_string = str(runtime_env.get("NILE_DATABASE_URL") or "").strip()
    if not connection_string:
        if _is_cloud_runtime(runtime_env):
            raise SharedCorpusError("NILE_DATABASE_URL is required in container/GCP runtime")
        return dict(config)

    expected, connection_string, connector = _db_connect(runtime_env, connect)
    with connector(connection_string) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            row = cursor.fetchone()
            if not row or str(row[0]) != expected:
                raise SharedCorpusError(f"Connected database does not match environment binding: expected {expected}")
            cursor.execute("SELECT policy FROM collection_policy WHERE singleton = true")
            row = cursor.fetchone()
            policy = row[0] if row and isinstance(row[0], dict) else {}

    merged = dict(config)
    for key in SYSTEM_COLLECTION_KEYS:
        if key in policy:
            merged[key] = policy[key]
    return merged


def persist_run_started(
    run_id: str,
    started_at: datetime,
    metadata: Mapping[str, Any] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    connect: Any | None = None,
) -> dict[str, Any]:
    """Establish the system-owned run in PostgreSQL before provider work begins."""
    runtime_env = os.environ if env is None else env
    connection_string = str(runtime_env.get("NILE_DATABASE_URL") or "").strip()
    if not connection_string:
        if _is_cloud_runtime(runtime_env):
            raise SharedCorpusError("NILE_DATABASE_URL is required in container/GCP runtime")
        return {"status": "local_not_configured", "run_id": run_id}

    expected, connection_string, connector = _db_connect(runtime_env, connect)
    run_id = _text(run_id)
    if not run_id:
        raise SharedCorpusError("run_id is required for run start persistence")
    payload = {
        "schema_version": "1.0",
        "run_id": run_id,
        "status": "running",
        "started_at": started_at.isoformat(),
        "completed_at": None,
        **_json_safe(dict(metadata or {})),
    }
    with connector(connection_string) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            row = cursor.fetchone()
            if not row or str(row[0]) != expected:
                raise SharedCorpusError(f"Connected database does not match environment binding: expected {expected}")
            cursor.execute(
                """
                INSERT INTO search_runs(
                    run_id, status, started_at, completed_at, records_inspected,
                    jobs_published, excluded, payload
                )
                VALUES (%s, 'running', %s, NULL, 0, 0, 0, %s::jsonb)
                ON CONFLICT(run_id)
                DO UPDATE SET status='running',
                              started_at=EXCLUDED.started_at,
                              completed_at=NULL,
                              payload=EXCLUDED.payload
                """,
                (run_id, started_at, json.dumps(payload, ensure_ascii=False)),
            )
    return {"status": "persisted", "run_id": run_id}



def _coverage_allowed_countries(scope: Mapping[str, Any]) -> list[str]:
    countries = {
        _text(value).upper()
        for value in (scope.get("target_country_codes") or [])
        if _text(value)
    }
    regions = canonical_nomenclatures.region_countries()
    for region in scope.get("target_regions") or []:
        countries.update(regions.get(_text(region).upper(), set()))
    return sorted(countries)


def _coverage_scope_metrics(cursor: Any, scope: Mapping[str, Any]) -> tuple[int, int, list[str]]:
    role_family = _text(scope.get("role_family")).upper()
    role_subfamilies = sorted({
        _text(value)
        for value in (scope.get("role_subfamilies") or [])
        if _text(value)
    })
    work_modes = sorted({
        _text(value).casefold()
        for value in (scope.get("work_modes") or [])
        if _text(value)
    })
    contract_types = sorted({
        _text(value).casefold()
        for value in (scope.get("contract_types") or [])
        if _text(value)
    })
    allowed_countries = _coverage_allowed_countries(scope)

    cursor.execute(
        """
        SELECT
          count(DISTINCT j.job_id)::integer AS corpus_volume,
          count(DISTINCT sp.source_id)::integer AS source_diversity,
          COALESCE(
            array_agg(DISTINCT sp.source_id) FILTER (WHERE sp.source_id IS NOT NULL),
            ARRAY[]::text[]
          ) AS source_ids
        FROM canonical_jobs j
        LEFT JOIN source_postings sp
          ON sp.job_id = j.job_id
         AND sp.lifecycle_status <> 'INACTIVE'
        WHERE j.lifecycle_status <> 'INACTIVE'
          AND j.role_family = %s
          AND (
            cardinality(%s::text[]) = 0
            OR j.role_subfamily && %s::text[]
          )
          AND (
            cardinality(%s::text[]) = 0
            OR j.work_mode = 'unknown'
            OR j.work_mode = ANY(%s::text[])
          )
          AND (
            cardinality(%s::text[]) = 0
            OR j.contract_type = 'unknown'
            OR j.contract_type = ANY(%s::text[])
          )
          AND (
            cardinality(%s::text[]) = 0
            OR cardinality(j.country_codes) = 0
            OR j.country_codes && %s::text[]
            OR (
              j.work_mode = 'remote'
              AND j.remote_scope IN ('Worldwide', 'EMEA', 'EU')
            )
          )
        """,
        (
            role_family,
            role_subfamilies,
            role_subfamilies,
            work_modes,
            work_modes,
            contract_types,
            contract_types,
            allowed_countries,
            allowed_countries,
        ),
    )
    row = cursor.fetchone() or (0, 0, [])
    return int(row[0] or 0), int(row[1] or 0), sorted(str(value) for value in (row[2] or []))


def _persist_coverage_observations(cursor: Any, status: Mapping[str, Any]) -> int:
    if _text(status.get("status")) not in {"completed", "completed_with_errors"}:
        return 0
    shared = status.get("shared_corpus")
    if not isinstance(shared, Mapping) or _text(shared.get("status")) != "persisted":
        return 0
    retrieve_scope = status.get("retrieve_scope")
    scopes = retrieve_scope.get("scopes") if isinstance(retrieve_scope, Mapping) else []
    completed_at = status.get("completed_at")
    run_id = _text(status.get("run_id"))
    if not completed_at or not run_id:
        return 0

    updated = 0
    for raw_scope in scopes or []:
        if not isinstance(raw_scope, Mapping):
            continue
        scope_key = _text(raw_scope.get("scope_key")).casefold()
        role_family = _text(raw_scope.get("role_family")).upper()
        if not re.fullmatch(r"[0-9a-f]{64}", scope_key):
            raise SharedCorpusError("Coverage scope_key is missing or invalid")
        if role_family not in set(role_taxonomy.CANONICAL_FAMILIES) - {"UNKNOWN"}:
            raise SharedCorpusError("Coverage role_family is invalid")

        canonical_scope = {
            "role_family": role_family,
            "role_subfamilies": sorted({_text(value) for value in (raw_scope.get("role_subfamilies") or []) if _text(value)}),
            "target_regions": sorted({_text(value).upper() for value in (raw_scope.get("target_regions") or []) if _text(value)}),
            "target_country_codes": sorted({_text(value).upper() for value in (raw_scope.get("target_country_codes") or []) if _text(value)}),
            "remote_eligible_country_codes": sorted({_text(value).upper() for value in (raw_scope.get("remote_eligible_country_codes") or []) if _text(value)}),
            "work_modes": sorted({_text(value).casefold() for value in (raw_scope.get("work_modes") or []) if _text(value)}),
            "contract_types": sorted({_text(value).casefold() for value in (raw_scope.get("contract_types") or []) if _text(value)}),
        }
        corpus_volume, source_diversity, source_ids = _coverage_scope_metrics(cursor, canonical_scope)
        cursor.execute(
            """
            INSERT INTO coverage_scope_state(
              scope_key, role_family, role_subfamilies, scope, last_usable_run_id, last_usable_at,
              corpus_volume, source_diversity, source_ids, updated_at
            )
            VALUES (%s, %s, %s::text[], %s::jsonb, %s, %s, %s, %s, %s::text[], now())
            ON CONFLICT(scope_key)
            DO UPDATE SET
              role_family=EXCLUDED.role_family,
              role_subfamilies=EXCLUDED.role_subfamilies,
              scope=EXCLUDED.scope,
              last_usable_run_id=EXCLUDED.last_usable_run_id,
              last_usable_at=EXCLUDED.last_usable_at,
              corpus_volume=EXCLUDED.corpus_volume,
              source_diversity=EXCLUDED.source_diversity,
              source_ids=EXCLUDED.source_ids,
              updated_at=now()
            """,
            (
                scope_key,
                role_family,
                canonical_scope["role_subfamilies"],
                json.dumps(canonical_scope, ensure_ascii=False),
                run_id,
                completed_at,
                corpus_volume,
                source_diversity,
                source_ids,
            ),
        )
        updated += 1
    return updated


def persist_operational_run(
    status: Mapping[str, Any],
    *,
    env: Mapping[str, str] | None = None,
    connect: Any | None = None,
) -> dict[str, Any]:
    """Persist run history as system-owned PostgreSQL state."""
    runtime_env = os.environ if env is None else env
    connection_string = str(runtime_env.get("NILE_DATABASE_URL") or "").strip()
    if not connection_string:
        if _is_cloud_runtime(runtime_env):
            raise SharedCorpusError("NILE_DATABASE_URL is required in container/GCP runtime")
        return {"status": "local_not_configured"}

    expected, connection_string, connector = _db_connect(runtime_env, connect)
    run_id = _text(status.get("run_id"))
    if not run_id:
        raise SharedCorpusError("run_id is required for operational history persistence")

    with connector(connection_string) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            row = cursor.fetchone()
            if not row or str(row[0]) != expected:
                raise SharedCorpusError(f"Connected database does not match environment binding: expected {expected}")

            cursor.execute(
                """
                INSERT INTO search_runs(
                    run_id, status, started_at, completed_at, records_inspected,
                    jobs_published, excluded, payload
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT(run_id)
                DO UPDATE SET status = EXCLUDED.status,
                              started_at = EXCLUDED.started_at,
                              completed_at = EXCLUDED.completed_at,
                              records_inspected = EXCLUDED.records_inspected,
                              jobs_published = EXCLUDED.jobs_published,
                              excluded = EXCLUDED.excluded,
                              payload = EXCLUDED.payload
                """,
                (
                    run_id,
                    _text(status.get("status")) or "unknown",
                    status.get("started_at"),
                    status.get("completed_at"),
                    int(status.get("records_inspected") or 0),
                    int(status.get("jobs_published") or 0),
                    int(status.get("excluded") or 0),
                    json.dumps(_json_safe(dict(status)), ensure_ascii=False),
                ),
            )

            for item in status.get("source_results") or []:
                if not isinstance(item, Mapping):
                    continue
                execution_id = _text(item.get("source_execution_id"))
                if not execution_id:
                    continue
                cursor.execute(
                    """
                    INSERT INTO source_run_results(
                        source_execution_id, run_id, source_id, source, connector,
                        collection_method, outcome, records, error_code,
                        failure_stage, http_status, payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT(source_execution_id)
                    DO UPDATE SET outcome = EXCLUDED.outcome,
                                  records = EXCLUDED.records,
                                  error_code = EXCLUDED.error_code,
                                  failure_stage = EXCLUDED.failure_stage,
                                  http_status = EXCLUDED.http_status,
                                  payload = EXCLUDED.payload
                    """,
                    (
                        execution_id,
                        run_id,
                        item.get("source_id"),
                        item.get("source"),
                        item.get("connector"),
                        item.get("collection_method"),
                        item.get("outcome"),
                        int(item.get("records") or 0),
                        item.get("error_code"),
                        item.get("failure_stage"),
                        item.get("http_status"),
                        json.dumps(_json_safe(dict(item)), ensure_ascii=False),
                    ),
                )

            coverage_updated = _persist_coverage_observations(cursor, status)

            cursor.execute(
                """
                INSERT INTO scheduler_state(singleton, last_triggered_at, last_run_id, state, updated_at)
                VALUES (true, %s, %s, %s::jsonb, now())
                ON CONFLICT(singleton)
                DO UPDATE SET last_triggered_at = EXCLUDED.last_triggered_at,
                              last_run_id = EXCLUDED.last_run_id,
                              state = EXCLUDED.state,
                              updated_at = now()
                """,
                (
                    status.get("started_at"),
                    run_id,
                    json.dumps({
                        "status": status.get("status"),
                        "completed_at": status.get("completed_at"),
                    }, ensure_ascii=False),
                ),
            )

    return {"status": "persisted", "run_id": run_id, "coverage_updated": coverage_updated}