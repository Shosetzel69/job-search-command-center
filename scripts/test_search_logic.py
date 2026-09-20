#!/usr/bin/env python3
"""Focused regression tests for geography and source semantics."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

import job_search as engine


class GeographyTests(unittest.TestCase):
    def test_remote_without_territory_is_worldwide(self) -> None:
        countries, codes, scope, eligible = engine.normalize_job_geography(
            {"remote": True, "location": "Remote"},
            True,
        )
        self.assertEqual(countries, [])
        self.assertEqual(codes, [])
        self.assertEqual(scope, "Worldwide")
        self.assertTrue(eligible)

    def test_remote_with_explicit_romania_is_eligible(self) -> None:
        _, codes, scope, eligible = engine.normalize_job_geography(
            {"country_code": "RO", "remote": True},
            True,
        )
        self.assertEqual(codes, ["RO"])
        self.assertEqual(scope, "Country")
        self.assertTrue(eligible)

    def test_remote_with_explicit_foreign_country_requires_romania(self) -> None:
        _, codes, scope, eligible = engine.normalize_job_geography(
            {"country_code": "DE", "remote": True, "description": "Remote in Germany"},
            True,
        )
        self.assertEqual(codes, ["DE"])
        self.assertEqual(scope, "Country")
        self.assertFalse(eligible)

    def test_worldwide_survives_regional_exclusion_with_explicit_target(self) -> None:
        config = {
            "target_regions": [],
            "target_country_codes": ["RO"],
            "excluded_regions": ["EU"],
            "excluded_country_codes": [],
        }
        self.assertTrue(engine.geography_matches(set(), "Worldwide", config, True))

    def test_eu_scope_does_not_match_us_only_target(self) -> None:
        config = {
            "target_regions": ["US"],
            "target_country_codes": [],
            "excluded_regions": [],
            "excluded_country_codes": [],
        }
        self.assertFalse(engine.geography_matches(set(), "EU", config, True))

    def test_multicountry_keeps_allowed_target_after_other_country_excluded(self) -> None:
        config = {
            "target_regions": [],
            "target_country_codes": ["RO"],
            "excluded_regions": [],
            "excluded_country_codes": ["US"],
        }
        self.assertTrue(engine.geography_matches({"RO", "US"}, "Country", config, False))

    def test_conflicting_region_and_country_is_rejected(self) -> None:
        config = {
            "target_regions": ["EU"],
            "target_country_codes": [],
            "excluded_regions": [],
            "excluded_country_codes": ["RO"],
        }
        with self.assertRaises(RuntimeError):
            engine.validate_geography_config(config)

    def test_empty_target_geography_is_rejected(self) -> None:
        config = {
            "target_regions": [],
            "target_country_codes": [],
            "excluded_regions": [],
            "excluded_country_codes": [],
        }
        with self.assertRaisesRegex(RuntimeError, "At least one target"):
            engine.validate_geography_config(config)
        self.assertFalse(engine.geography_matches({"JP"}, "Country", config, False))

    def test_hybrid_japan_is_excluded_for_ro_be_lu_targets(self) -> None:
        config = {
            "freshness_hours": 24,
            "collection_freshness_hours": 120,
            "fit_threshold": 60,
            "keep_reposts": True,
            "work_modes": {"remote": True, "hybrid": True, "onsite": False},
            "contract_types": ["permanent", "temporary", "contract", "freelance"],
            "target_regions": [],
            "target_country_codes": ["RO", "BE", "LU"],
            "excluded_regions": [],
            "excluded_country_codes": [],
            "role_groups": {"pm": {"enabled": True, "titles": ["Technical Project Manager"]}},
        }
        record = {
            "id": "bosch-yokohama-regression",
            "job_title": "System Engineer/Technical Project Manager",
            "company": "Example Automotive",
            "country_code": "JP",
            "location": "Yokohama, Japan",
            "remote": False,
            "hybrid": True,
            "work_arrangement": "hybrid",
            "description": "Technical project management for embedded systems.",
            "date_posted": "2026-09-08T08:00:00+00:00",
            "sources": [{"provider": "web"}],
        }
        collection = [engine.CollectionResult("web:test", "regression", True, [record], 1)]
        output = engine.process_records(config, collection, datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(output["results"], 0)
        self.assertTrue(any(item.get("reason") == "outside target or excluded geography" for item in output["excluded_sample"]))

    def test_unknown_nonremote_geography_is_not_assumed_eligible(self) -> None:
        config = {
            "target_regions": [],
            "target_country_codes": ["RO"],
            "excluded_regions": [],
            "excluded_country_codes": [],
        }
        self.assertFalse(engine.geography_matches(set(), "Unknown", config, False))


class CanonicalNomenclatureTests(unittest.TestCase):
    def test_work_mode_alias_maps_to_onsite(self) -> None:
        self.assertEqual(
            engine.canonical_nomenclatures.normalize_work_mode("in-office", engine.NOMENCLATURES),
            "onsite",
        )

    def test_known_contract_type_maps_to_canonical_code(self) -> None:
        self.assertEqual(
            engine.canonical_nomenclatures.normalize_contract_type(["contract"], engine.NOMENCLATURES),
            "contract",
        )

    def test_unknown_contract_type_is_not_forced(self) -> None:
        self.assertEqual(
            engine.canonical_nomenclatures.normalize_contract_type(["full_time_provider_specific"], engine.NOMENCLATURES),
            "unknown",
        )


class OutputTests(unittest.TestCase):
    def test_jobspipe_apify_counts_as_jobspipe_source(self) -> None:
        self.assertEqual(engine.canonical_source_name("jobspipe-apify"), "JobsPipe")
        self.assertEqual(engine.canonical_source_name("jobspipe"), "JobsPipe")

    def test_process_records_publishes_country_and_contract_fields(self) -> None:
        config = {
            "freshness_hours": 24,
            "collection_freshness_hours": 120,
            "fit_threshold": 80,
            "keep_reposts": True,
            "work_modes": {"remote": True, "hybrid": True, "onsite": False},
            "contract_types": ["permanent", "temporary", "contract", "freelance"],
            "target_regions": [],
            "target_country_codes": ["RO"],
            "excluded_regions": [],
            "excluded_country_codes": [],
            "role_groups": {"pm": {"enabled": True, "titles": ["IT Project Manager"]}},
        }
        record = {
            "id": "test-1",
            "job_title": "IT Project Manager",
            "company": "Example",
            "country_code": "RO",
            "location": "Bucharest",
            "remote": False,
            "work_arrangement": "hybrid",
            "employment_statuses": ["contract"],
            "description": "IT project delivery in a regulated bank.",
            "date_posted": "2026-09-06T08:00:00+00:00",
            "sources": [{"provider": "jobspipe"}],
        }
        collection = [engine.CollectionResult("jobspipe-apify", "target_geography", True, [record], 1)]
        output = engine.process_records(config, collection, datetime(2026, 9, 6, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(output["results"], 1)
        self.assertEqual(output["jobs"][0]["country_codes"], ["RO"])
        self.assertEqual(output["jobs"][0]["countries"], ["Romania"])
        self.assertEqual(output["jobs"][0]["contract_type"], "contract")
        self.assertEqual(output["jobs"][0]["employment_type_raw"], "contract")

    def test_unknown_contract_type_survives_without_forced_classification(self) -> None:
        config = {
            "freshness_hours": 24,
            "collection_freshness_hours": 120,
            "fit_threshold": 80,
            "keep_reposts": True,
            "work_modes": {"remote": True, "hybrid": True, "onsite": False},
            "contract_types": ["contract"],
            "target_regions": [],
            "target_country_codes": ["RO"],
            "excluded_regions": [],
            "excluded_country_codes": [],
            "role_groups": {"pm": {"enabled": True, "titles": ["IT Project Manager"]}},
        }
        record = {
            "id": "unknown-contract",
            "job_title": "IT Project Manager",
            "company": "Example",
            "country_code": "RO",
            "location": "Bucharest",
            "work_arrangement": "hybrid",
            "employment_statuses": ["provider-special"],
            "description": "IT project delivery.",
            "date_posted": "2026-09-06T08:00:00+00:00",
            "sources": [{"provider": "web"}],
        }
        collection = [engine.CollectionResult("web:test", "target_geography", True, [record], 1)]
        output = engine.process_records(config, collection, datetime(2026, 9, 6, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(output["results"], 1)
        self.assertEqual(output["jobs"][0]["contract_type"], "unknown")
        self.assertEqual(output["jobs"][0]["employment_type_raw"], "provider-special")



    def test_country_aliases_are_deduplicated_to_canonical_label(self):
        job = {
            "title": "Project Manager",
            "company": "Example",
            "location": "Brussels",
            "countries": ["Belgium", "Belgia"],
            "country_codes": ["BE"],
            "remote": False,
            "mode": "onsite",
            "date_posted": "2026-09-20T08:00:00+00:00",
        }
        countries, codes, scope, eligible = engine.normalize_job_geography(job, False)
        self.assertEqual(countries, ["Belgia"])
        self.assertEqual(codes, ["BE"])
        self.assertEqual(scope, "Country")
        self.assertTrue(eligible)

if __name__ == "__main__":
    unittest.main()