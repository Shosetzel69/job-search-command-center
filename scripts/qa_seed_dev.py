"""DEV-only synthetic jobs for Role Family E2E QA.

Default is validation only (no network/database writes).
--apply requires explicit opt-in, DEV identity and an existing jobsearch_dev DB.
Never run against TEST/PROD. Records are visibly synthetic and versioned.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from shared_corpus_repository import (
    expected_database,
    persist_collection,
    prepare_posting,
)

DATASET = Path(__file__).resolve().parents[1] / "data/qa/role-family-v1-dev-fixtures.json"
SOURCE_ID = "jscc-dev-qa-role-family-v1"
CONFIRM = "APPLY_DEV_SYNTHETIC"


def fixture_records(now: datetime) -> tuple[list[dict], dict]:
    document = json.loads(DATASET.read_text(encoding="utf-8"))
    if (
        document.get("schema_version") != "1.0"
        or document.get("environment") != "dev"
        or document.get("provenance") != "SYNTHETIC"
        or document.get("source_id") != SOURCE_ID
    ):
        raise ValueError("DEV QA fixture contract mismatch")

    cases = document.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("DEV QA fixture cases required")
    seen: set[str] = set()
    records: list[dict] = []
    family_counts: Counter[str] = Counter()

    for case in cases:
        fixture_id = str(case.get("id", ""))
        title = str(case.get("title", "")).strip()
        if not fixture_id.startswith("qa-") or fixture_id in seen or not title:
            raise ValueError("Invalid or duplicate fixture identity")
        seen.add(fixture_id)
        record = {
            "external_job_id": fixture_id,
            "title": f"[QA SYNTHETIC] {title}",
            "company": "JSCC QA SYNTHETIC — NOT A REAL EMPLOYER",
            "location": case["location"],
            "country_codes": case["country_codes"],
            "work_mode": case["work_mode"],
            "contract_type": case["contract_type"],
            "description": "Synthetic DEV-only job record for automated acceptance testing. Not an employment opportunity.",
            "date_posted": now.isoformat(),
            "url": f"https://example.invalid/jscc-qa/{fixture_id}",
            "_jscc_source_id": SOURCE_ID,
            "_jscc_source_name": document["source_name"],
        }
        prepared = prepare_posting(record)
        if prepared is None:
            raise ValueError(f"{fixture_id}: unable to prepare canonical posting")
        if (
            prepared.role_family != case.get("expected_role_family")
            or prepared.classification_status != case.get("expected_classification_status")
        ):
            raise ValueError(
                f"{fixture_id}: classification drift: "
                f"{prepared.role_family}/{prepared.classification_status}"
            )
        family_counts[prepared.role_family] += 1
        records.append(record)

    return records, {
        "dataset_id": document["dataset_id"],
        "provenance": "SYNTHETIC",
        "source_id": SOURCE_ID,
        "records": len(records),
        "families": dict(sorted(family_counts.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Persist fixtures in DEV only")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    records, summary = fixture_records(now)
    if not args.apply:
        print(json.dumps({"status": "DRY_RUN_PASS", **summary}, indent=2))
        return

    env = os.environ
    if env.get("APP_ENV") != "dev" or env.get("JSCC_DEV_QA_SEED_CONFIRM") != CONFIRM:
        raise SystemExit("Refused: requires APP_ENV=dev and explicit DEV QA seed confirmation")
    expected_database(env)  # verifies postgresql://.../jobsearch_dev binding

    result = persist_collection(
        [SimpleNamespace(ok=True, connector="qa-fixture", records=records)],
        [],
        run_id="qa-fixture-role-family-v1",
        now=now,
        env=env,
        advance_lifecycle=False,  # never expire real source postings
    )
    if result.get("status") != "persisted" or result.get("records_projected") != len(records):
        raise RuntimeError("DEV QA fixture persistence incomplete")
    print(json.dumps({"status": "DEV_FIXTURES_PERSISTED", **summary, "persistence": result}, indent=2))


if __name__ == "__main__":
    main()
