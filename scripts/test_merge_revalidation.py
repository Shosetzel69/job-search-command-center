#!/usr/bin/env python3
"""Regression tests for retained-job revalidation during incremental merge."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import job_search as engine
import job_search_optimized as optimized


NOW = datetime(2026, 9, 11, 7, 0, tzinfo=timezone.utc)


def base_config() -> dict:
    return {
        "freshness_hours": 120,
        "collection_freshness_hours": 120,
        "fit_threshold": 60,
        "keep_reposts": True,
        "work_modes": {"remote": True, "hybrid": True, "onsite": True},
        "contract_types": ["permanent", "temporary", "contract", "freelance"],
        "target_regions": ["EU", "US"],
        "target_country_codes": [],
        "excluded_regions": ["ASIA"],
        "excluded_country_codes": [],
        "excluded_company_patterns": [],
        "excluded_role_keywords": [],
        "deep_erp_terms": [],
    }


def retained_job(
    job_id: str,
    country_code: str,
    *,
    mode: str = "Onsite",
    contract_type: str = "permanent",
    title: str = "Technical Project Manager",
    company: str = "Example",
) -> dict:
    return {
        "id": job_id,
        "title": title,
        "company": company,
        "fit": 80,
        "location": country_code,
        "countries": [],
        "country_codes": [country_code],
        "remote_scope": "Country",
        "romania_eligible": None,
        "mode": mode,
        "type": "Full-Time",
        "contract_type": contract_type,
        "age": 1,
        "remote": mode == "Remote",
        "b2b": contract_type in {"contract", "freelance"},
        "repost": False,
        "status": "new",
        "pros": [],
        "risks": [],
        "url": "https://example.test/job",
        "description": "Technical project management.",
        "date_posted": "2026-09-11T05:00:00+00:00",
        "source": "test",
    }


class MergeRevalidationTests(unittest.TestCase):
    def merge_existing(self, jobs: list[dict], config: dict) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.json"
            path.write_text(
                json.dumps({"schema_version": engine.SCHEMA_VERSION, "jobs": jobs}),
                encoding="utf-8",
            )
            original_path = engine.JOBS_PATH
            try:
                engine.JOBS_PATH = path
                return optimized.merge_with_existing(
                    {"schema_version": engine.SCHEMA_VERSION, "jobs": [], "excluded_count": 0},
                    {},
                    config,
                    NOW,
                )
            finally:
                engine.JOBS_PATH = original_path

    def test_existing_japan_job_is_removed_when_asia_is_excluded(self) -> None:
        output = self.merge_existing([retained_job("jp-old", "JP")], base_config())
        self.assertEqual(output["results"], 0)
        self.assertEqual(output["criteria_revalidated_pruned"], 1)
        self.assertEqual(
            output["criteria_revalidation_reasons"],
            {"outside target or excluded geography": 1},
        )

    def test_existing_eu_and_us_jobs_remain_eligible(self) -> None:
        output = self.merge_existing(
            [
                retained_job("fr-old", "FR", company="Example France"),
                retained_job("us-old", "US", company="Example US"),
            ],
            base_config(),
        )
        self.assertEqual(output["results"], 2)
        self.assertEqual({job["id"] for job in output["jobs"]}, {"fr-old", "us-old"})
        self.assertEqual(output["criteria_revalidated_pruned"], 0)

    def test_work_mode_change_prunes_retained_job(self) -> None:
        config = base_config()
        config["work_modes"]["onsite"] = False
        output = self.merge_existing([retained_job("onsite-old", "FR", mode="Onsite")], config)
        self.assertEqual(output["results"], 0)
        self.assertEqual(
            output["criteria_revalidation_reasons"],
            {"onsite disabled by configuration": 1},
        )

    def test_contract_type_change_prunes_retained_job(self) -> None:
        config = base_config()
        config["contract_types"] = ["contract"]
        output = self.merge_existing(
            [retained_job("perm-old", "US", contract_type="permanent")],
            config,
        )
        self.assertEqual(output["results"], 0)
        self.assertEqual(
            output["criteria_revalidation_reasons"],
            {"contract type disabled by configuration": 1},
        )

    def test_configurable_role_exclusion_prunes_retained_job(self) -> None:
        config = base_config()
        config["excluded_role_keywords"] = ["event"]
        output = self.merge_existing(
            [retained_job("event-old", "FR", title="Program Manager Event")],
            config,
        )
        self.assertEqual(output["results"], 0)
        self.assertEqual(output["criteria_revalidation_reasons"], {"non-IT role": 1})


if __name__ == "__main__":
    unittest.main()
