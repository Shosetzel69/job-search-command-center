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
            "target_role_families": ["PROJECT_DELIVERY_MANAGEMENT"],
            "target_role_subfamilies": ["project_management"],
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




class JobsPipeConfigurationTests(unittest.TestCase):
    def test_test_style_disabled_mode_accepts_zero_apify_limit(self) -> None:
        config = {
            "jobspipe_mode": "disabled",
            "jobspipe_apify_max_items_per_run": 0,
            "jobspipe_credit_budget_per_run": 0,
            "jobspipe_monthly_credit_guard": 0,
        }
        self.assertEqual(engine.validate_jobspipe_config(config), "disabled")

    def test_apify_mode_still_rejects_zero_limit(self) -> None:
        config = {
            "jobspipe_mode": "apify",
            "jobspipe_apify_max_items_per_run": 0,
        }
        with self.assertRaisesRegex(RuntimeError, "must be 100-20000"):
            engine.validate_jobspipe_config(config)


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
            "target_role_families": ["PROJECT_DELIVERY_MANAGEMENT"],
            "target_role_subfamilies": ["project_management"],
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
            "target_role_families": ["PROJECT_DELIVERY_MANAGEMENT"],
            "target_role_subfamilies": ["project_management"],
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



    def test_role_filter_audit_separates_near_misses_from_generic_keyword_matches(self) -> None:
        config = {
            "freshness_hours": 720,
            "collection_freshness_hours": 720,
            "fit_threshold": 60,
            "keep_reposts": True,
            "work_modes": {"remote": True, "hybrid": True, "onsite": True},
            "contract_types": ["permanent", "temporary", "contract", "freelance"],
            "target_regions": ["EU"],
            "target_country_codes": ["RO"],
            "excluded_regions": [],
            "excluded_country_codes": [],
            "target_role_families": ["PROJECT_DELIVERY_MANAGEMENT", "SERVICE_OPERATIONS_MANAGEMENT"],
            "target_role_subfamilies": ["project_management", "service_management"],
        }
        now = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)
        fresh = "2026-09-25T08:00:00+00:00"
        records = [
            {"id":"explicit","job_title":"Senior IT Project Manager","company":"A","remote":True,"location":"Remote","date_posted":fresh},
            {"id":"generic","job_title":"Service Desk Operator","company":"B","remote":True,"location":"Remote","date_posted":fresh},
            {"id":"transition","job_title":"Transition Manager","company":"C","remote":True,"location":"Remote","date_posted":fresh},
            {"id":"agile","job_title":"Agile Coach","company":"D","remote":True,"location":"Remote","date_posted":fresh},
            {"id":"release","job_title":"Release Train Engineer","company":"E","remote":True,"location":"Remote","date_posted":fresh},
        ]
        output = engine.process_records(
            config,
            [engine.CollectionResult("jobspipe", "q", True, records, len(records))],
            now,
        )
        audit = output["role_filter_audit"]
        self.assertEqual(audit["role_gate_evaluated"], 5)
        self.assertEqual(audit["role_rejected_total"], 4)
        self.assertEqual(audit["rejected_near_miss_total"], 3)
        self.assertEqual(audit["accepted_title_gate_total"], 1)
        self.assertEqual(audit["explicit_role_match_count"], 1)
        self.assertEqual(audit["generic_keyword_only_count"], 0)
        self.assertEqual(audit["generic_keyword_only_by_keyword"], {})
        self.assertEqual(audit["rejected_near_miss_by_signal"], {
            "agile": 1,
            "manager": 1,
            "release": 1,
            "transition": 1,
        })
        self.assertEqual(audit["rejected_near_miss_examples"]["transition"][0]["title"], "Transition Manager")

    def test_process_records_reports_complete_exclusion_counts(self) -> None:
        config = {
            "freshness_hours": 24,
            "collection_freshness_hours": 24,
            "fit_threshold": 60,
            "keep_reposts": True,
            "work_modes": {"remote": True, "hybrid": True, "onsite": False},
            "contract_types": ["permanent", "temporary", "contract", "freelance"],
            "target_regions": [],
            "target_country_codes": ["RO"],
            "excluded_regions": [],
            "excluded_country_codes": [],
            "target_role_families": ["PROJECT_DELIVERY_MANAGEMENT"],
            "target_role_subfamilies": ["project_management"],
        }
        now = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)
        fresh = "2026-09-25T08:00:00+00:00"
        old = "2026-09-23T08:00:00+00:00"
        records = [
            {"id":"ok","job_title":"Project Manager","company":"A","country_code":"RO","location":"Bucharest","work_arrangement":"hybrid","date_posted":fresh},
            {"id":"ok","job_title":"Project Manager","company":"A","country_code":"RO","location":"Bucharest","work_arrangement":"hybrid","date_posted":fresh},
            {"id":"date","job_title":"Project Manager","company":"B","country_code":"RO","location":"Bucharest","work_arrangement":"hybrid"},
            {"id":"role","job_title":"Software Engineer","company":"C","country_code":"RO","location":"Bucharest","work_arrangement":"hybrid","date_posted":fresh},
            {"id":"onsite","job_title":"Project Manager","company":"D","country_code":"RO","location":"Bucharest","work_arrangement":"onsite","date_posted":fresh},
            {"id":"geo","job_title":"Project Manager","company":"E","country_code":"US","location":"New York","work_arrangement":"hybrid","date_posted":fresh},
            {"id":"old","job_title":"Project Manager","company":"F","country_code":"RO","location":"Bucharest","work_arrangement":"hybrid","date_posted":old},
        ]
        collection = [engine.CollectionResult("web:test", "q", True, records, len(records))]
        output = engine.process_records(config, collection, now)
        self.assertEqual(output["results"], 1)
        self.assertEqual(output["excluded_count"], 6)
        self.assertEqual(output["excluded_by_category"], {
            "date": 1,
            "duplicate": 1,
            "freshness": 1,
            "geo": 1,
            "role": 1,
            "work_mode": 1,
        })
        self.assertEqual(output["excluded_by_reason"]["duplicate"], 1)
        self.assertEqual(output["excluded_by_reason"]["web publication date unavailable"], 1)
        self.assertEqual(output["excluded_by_reason"]["title outside target"], 1)
        self.assertEqual(output["excluded_by_reason"]["onsite disabled by configuration"], 1)
        self.assertEqual(output["excluded_by_reason"]["outside target or excluded geography"], 1)
        self.assertEqual(output["excluded_by_reason"]["older than 24 hours"], 1)

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