from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

import role_taxonomy


class RoleTaxonomyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.taxonomy, cls.corpus = role_taxonomy.validate_files()

    def test_canonical_families_are_exact(self) -> None:
        self.assertEqual(
            self.taxonomy["canonical_families"],
            list(role_taxonomy.CANONICAL_FAMILIES),
        )

    def test_regression_corpus_passes(self) -> None:
        role_taxonomy.validate_regression_corpus(self.taxonomy, self.corpus)

    def test_gate_order_is_schema_compile_conflict(self) -> None:
        order: list[str] = []
        with (
            patch.object(role_taxonomy, "_validate_schema", side_effect=lambda _: order.append("schema")),
            patch.object(role_taxonomy, "_compile_patterns", side_effect=lambda _: order.append("compile")),
            patch.object(role_taxonomy, "_detect_pattern_conflicts", side_effect=lambda _: order.append("conflict")),
        ):
            role_taxonomy.validate_taxonomy(self.taxonomy)
        self.assertEqual(order, ["schema", "compile", "conflict"])

    def test_unknown_is_non_negative(self) -> None:
        self.assertEqual(
            role_taxonomy.classify_title("Service Desk Operator", self.taxonomy),
            {
                "classification_status": "unknown",
                "role_family": "UNKNOWN",
                "role_member": [],
            },
        )

    def test_family_and_subfamily_are_classified(self) -> None:
        result = role_taxonomy.classify_title("Technical Project Manager", self.taxonomy)
        self.assertEqual(result["classification_status"], "matched")
        self.assertEqual(result["role_family"], "PROJECT_DELIVERY_MANAGEMENT")
        self.assertEqual(result["role_member"], ["project_management"])

    def test_cross_family_conflicts_remain_explicit(self) -> None:
        for title in ("Business Analyst / Product Owner", "Technical Lead Project Manager"):
            with self.subTest(title=title):
                result = role_taxonomy.classify_title(title, self.taxonomy)
                self.assertEqual(result["classification_status"], "conflict")
                self.assertEqual(result["role_family"], "UNKNOWN")

    def test_same_family_multi_member_does_not_invent_single_subfamily(self) -> None:
        result = role_taxonomy.classify_title("Technical Customer Success Manager", self.taxonomy)
        self.assertIn(result["classification_status"], ("matched", "conflict"))
        if result["classification_status"] == "conflict":
            self.assertEqual(result["role_family"], "UNKNOWN")

    def test_member_exclusion_does_not_cancel_other_member(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["families"]["PROJECT_DELIVERY_MANAGEMENT"]["members"].append(
            {
                "code": "technical_management_test",
                "label": "Technical Management Test",
                "include_patterns": [r"\btechnical\s+manager\b"],
                "exclude_patterns": [],
            }
        )
        taxonomy["families"]["PROJECT_DELIVERY_MANAGEMENT"]["members"][0]["include_patterns"].append(
            r"\bmanager\b"
        )
        taxonomy["families"]["PROJECT_DELIVERY_MANAGEMENT"]["members"][0]["exclude_patterns"].append(
            r"\btechnical\s+manager\b"
        )

        result = role_taxonomy.classify_title("Technical Manager", taxonomy)
        self.assertEqual(result["classification_status"], "matched")
        self.assertEqual(result["role_family"], "PROJECT_DELIVERY_MANAGEMENT")
        self.assertEqual(result["role_member"], ["technical_management_test"])

    def test_duplicate_include_pattern_is_rejected(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["families"]["SERVICE_OPERATIONS_MANAGEMENT"]["members"][0]["include_patterns"] = [
            taxonomy["families"]["PROJECT_DELIVERY_MANAGEMENT"]["members"][0]["include_patterns"][0]
        ]
        with self.assertRaisesRegex(
            role_taxonomy.TaxonomyValidationError,
            "conflicting include pattern",
        ):
            role_taxonomy.validate_taxonomy(taxonomy)

    def test_invalid_regex_is_rejected(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["families"]["SERVICE_OPERATIONS_MANAGEMENT"]["members"][0]["include_patterns"] = ["("]
        with self.assertRaisesRegex(
            role_taxonomy.TaxonomyValidationError,
            "invalid include regex",
        ):
            role_taxonomy.validate_taxonomy(taxonomy)

    def test_provider_query_contract_is_rejected(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["provider_queries"] = ["Project Manager"]
        with self.assertRaisesRegex(
            role_taxonomy.TaxonomyValidationError,
            "provider-query contracts are forbidden",
        ):
            role_taxonomy.validate_taxonomy(taxonomy)

    def test_taxonomy_data_can_change_without_classifier_code_change(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["taxonomy_version"] = "2026.10.08-2"
        taxonomy["families"]["PROJECT_DELIVERY_MANAGEMENT"]["members"].append(
            {
                "code": "portfolio_management",
                "label": "Portfolio Management",
                "include_patterns": [r"\bportfolio\s+manager\b"],
                "exclude_patterns": [],
            }
        )
        role_taxonomy.validate_taxonomy(taxonomy)

        result = role_taxonomy.classify_title("Portfolio Manager", taxonomy)
        self.assertEqual(result["role_family"], "PROJECT_DELIVERY_MANAGEMENT")
        self.assertEqual(result["role_member"], ["portfolio_management"])

    def test_regression_version_mismatch_is_rejected(self) -> None:
        corpus = copy.deepcopy(self.corpus)
        corpus["taxonomy_version"] = "2026.10.08-999"
        with self.assertRaisesRegex(
            role_taxonomy.TaxonomyValidationError,
            "taxonomy_version",
        ):
            role_taxonomy.validate_regression_corpus(self.taxonomy, corpus)

    def test_title_normalization_is_deterministic(self) -> None:
        self.assertEqual(
            role_taxonomy.normalize_title("  IT—Project_Manager  "),
            "it project manager",
        )
        result = role_taxonomy.classify_title("IT—Project_Manager", self.taxonomy)
        self.assertEqual(result["role_family"], "PROJECT_DELIVERY_MANAGEMENT")
        self.assertEqual(result["role_member"], ["project_management"])


if __name__ == "__main__":
    unittest.main()