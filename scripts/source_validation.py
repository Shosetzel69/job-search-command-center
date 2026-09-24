"""Manual, bounded DEV validation for an explicit source cohort.

This module is intentionally separate from the normal search runner. It reuses the
canonical source planning/collection code but never processes, merges or publishes
jobs and never mutates source registry state.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import diagnostics
import job_search as engine
import source_orchestration as orchestration

MAX_COHORT = 20
ALLOWED_VALIDATION_DISABLED_REASON = "live_api_route_not_validated"
PROHIBITED_CONNECTORS = {"jobspipe"}
RESTRICTED_SOURCE_STATUSES = {"blocked_credentials", "excluded_policy", "deferred", "unsupported"}


class ValidationError(ValueError):
    """Fail-closed validation/preflight error."""


def parse_source_ids(value: str) -> list[str]:
    source_ids = [part.strip() for part in str(value or "").split(",") if part.strip()]
    if not source_ids:
        raise ValidationError("At least one canonical source ID is required")
    if len(source_ids) > MAX_COHORT:
        raise ValidationError(f"Source cohort must contain at most {MAX_COHORT} IDs")
    if len(source_ids) != len(set(source_ids)):
        raise ValidationError("Duplicate source IDs are not allowed")
    return source_ids


def normalize_source_sha(value: str) -> str:
    source_sha = str(value or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValidationError("source_sha must be an exact 40-character commit SHA")
    return source_sha


def verify_checkout(source_sha: str, runner=subprocess.run) -> str:
    expected = normalize_source_sha(source_sha)
    result = runner(
        ["git", "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    actual = str(result.stdout or "").strip().lower()
    if actual != expected:
        raise ValidationError(f"Checked-out SHA mismatch: expected {expected}, got {actual or 'unknown'}")
    return actual


def load_catalog(path: Path | None = None) -> dict:
    catalog_path = path or orchestration.SOURCES_PATH
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("sources"), list):
        raise ValidationError("Source catalog must contain a sources array")
    return payload


def _catalog_index(catalog: dict) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for source in catalog.get("sources") or []:
        source_id = str(source.get("id") or "").strip()
        if not source_id:
            continue
        if source_id in index:
            raise ValidationError(f"Duplicate canonical source ID in catalog: {source_id}")
        index[source_id] = source
    return index


def _reset_for_validation(item: dict, reason: str) -> None:
    item.update(
        active=True,
        status="pending",
        outcome=None,
        records=0,
        error=None,
        failure_reason=None,
        error_code=None,
        failure_stage=None,
        http_status=None,
        validation_override=reason,
    )


def prepare_validation_items(catalog: dict, source_ids: list[str]) -> list[dict]:
    """Validate the entire cohort before any external request is allowed."""
    if not source_ids or len(source_ids) > MAX_COHORT or len(source_ids) != len(set(source_ids)):
        raise ValidationError("Invalid source cohort")

    index = _catalog_index(catalog)
    unknown = [source_id for source_id in source_ids if source_id not in index]
    if unknown:
        raise ValidationError("Unknown canonical source IDs: " + ", ".join(unknown))

    prepared: list[dict] = []
    for source_id in source_ids:
        original = index[source_id]
        source_status = str(original.get("validation_status") or "").strip().lower()
        if source_status in RESTRICTED_SOURCE_STATUSES:
            raise ValidationError(f"{source_id} is not eligible for public DEV validation: {source_status}")
        if bool(original.get("policy_excluded")) or orchestration.policy_excluded(original):
            raise ValidationError(f"{source_id} is excluded by source policy")

        candidate_source = copy.deepcopy(original)
        was_inactive = candidate_source.get("active") is False
        candidate_source["active"] = True
        plan = orchestration.build_plan({"sources": [candidate_source]})
        if len(plan) != 1:
            raise ValidationError(f"{source_id} did not resolve to exactly one collection plan item")
        item = plan[0]

        connector = str(item.get("connector") or "")
        route = item.get("connector_config") or {}
        disabled_reason = str(route.get("disabled_reason") or "")

        if connector in PROHIBITED_CONNECTORS:
            raise ValidationError(f"{source_id} uses prohibited connector {connector}")
        if connector == "deferred" or item.get("outcome") == "deferred_provider":
            raise ValidationError(f"{source_id} is a deferred provider root")
        if item.get("outcome") == "excluded_policy":
            raise ValidationError(f"{source_id} is excluded by source policy")
        if item.get("outcome") == "blocked_credentials" or disabled_reason == "connector_requires_credentials":
            raise ValidationError(f"{source_id} requires credentials and cannot use this validation surface")
        if item.get("status") == "unsupported" or not connector:
            raise ValidationError(f"{source_id} has no safe collection route")

        if route.get("enabled") is False:
            if disabled_reason != ALLOWED_VALIDATION_DISABLED_REASON:
                raise ValidationError(
                    f"{source_id} has disabled route not eligible for validation override: "
                    f"{disabled_reason or 'unspecified'}"
                )
            _reset_for_validation(item, "validation_pending")
        elif was_inactive:
            _reset_for_validation(item, "inactive_source")
        else:
            item["validation_override"] = None

        prepared.append(item)

    return prepared


def _source_evidence(item: dict, duration_ms: int) -> dict:
    return {
        "source_id": item.get("source_id"),
        "source": item.get("source"),
        "connector": item.get("connector"),
        "outcome": item.get("outcome"),
        "records": int(item.get("records") or 0),
        "error": diagnostics.sanitize_text(item.get("error")) if item.get("error") else None,
        "error_code": item.get("error_code"),
        "failure_stage": item.get("failure_stage"),
        "http_status": item.get("http_status"),
        "duration_ms": duration_ms,
        "validation_override": item.get("validation_override"),
        "publication": "none",
    }


def execute_validation(
    catalog: dict,
    config: dict,
    source_sha: str,
    source_ids: list[str],
    *,
    collector=orchestration.collect_sources,
    now: datetime | None = None,
) -> dict:
    source_sha = normalize_source_sha(source_sha)
    items = prepare_validation_items(catalog, source_ids)
    now = now or datetime.now(timezone.utc)
    evidence = {
        "schema_version": "1.0",
        "source_sha": source_sha,
        "generated_at": now.isoformat(),
        "requested_source_ids": list(source_ids),
        "publication": "none",
        "source_results": [],
    }

    for index, prepared in enumerate(items):
        item = copy.deepcopy(prepared)
        run_id = f"source-validation-{index + 1}-{item['source_id']}"
        started = time.monotonic()
        try:
            collector(config, {}, now, [item], run_id=run_id)
        except Exception as exc:
            raise RuntimeError(
                f"Validation system failure for {item['source_id']}: {diagnostics.sanitize_text(exc)}"
            ) from exc
        duration_ms = int((time.monotonic() - started) * 1000)
        orchestration.finalize_source_outcomes([item], run_id)
        evidence["source_results"].append(_source_evidence(item, duration_ms))

    failures = [item for item in evidence["source_results"] if item["outcome"] == "failed"]
    evidence["status"] = "completed_with_source_failures" if failures else "completed"
    evidence["sources_requested"] = len(items)
    evidence["sources_failed"] = len(failures)
    evidence["sources_succeeded"] = len(items) - len(failures)
    return evidence


def validate_output_path(path: Path) -> Path:
    resolved = path.resolve()
    data_root = engine.DATA.resolve()
    if resolved == data_root or data_root in resolved.parents:
        raise ValidationError("Validation evidence must not be written under application data/")
    return path


def write_evidence(path: Path, evidence: dict) -> None:
    path = validate_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def failure_evidence(source_sha: str, source_ids: list[str], status: str, error: Exception) -> dict:
    return {
        "schema_version": "1.0",
        "source_sha": str(source_sha or "").strip().lower() or None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "requested_source_ids": list(source_ids),
        "publication": "none",
        "status": status,
        "error": diagnostics.sanitize_text(error),
        "source_results": [],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Controlled DEV validation for canonical job sources")
    parser.add_argument("--source-sha", required=True, help="Exact 40-character candidate commit SHA")
    parser.add_argument("--source-ids", required=True, help="Comma-separated canonical source IDs (1..20)")
    parser.add_argument(
        "--output",
        default="validation-evidence/source-validation.json",
        help="Evidence JSON path; application data/ paths are rejected",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output = Path(args.output)
    source_ids: list[str] = []
    try:
        source_ids = parse_source_ids(args.source_ids)
        source_sha = verify_checkout(args.source_sha)
        catalog = load_catalog()
        config = engine.load_config()
        evidence = execute_validation(catalog, config, source_sha, source_ids)
        write_evidence(output, evidence)
        print(json.dumps({
            "status": evidence["status"],
            "source_sha": evidence["source_sha"],
            "sources_requested": evidence["sources_requested"],
            "sources_failed": evidence["sources_failed"],
            "publication": "none",
        }))
        return 0
    except ValidationError as exc:
        try:
            write_evidence(output, failure_evidence(args.source_sha, source_ids, "preflight_failed", exc))
        except Exception:
            pass
        print(f"source validation preflight failed: {diagnostics.sanitize_text(exc)}", file=sys.stderr)
        return 2
    except Exception as exc:
        try:
            write_evidence(output, failure_evidence(args.source_sha, source_ids, "system_failed", exc))
        except Exception:
            pass
        print(f"source validation system failure: {diagnostics.sanitize_text(exc)}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
