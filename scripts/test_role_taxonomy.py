from __future__ import annotations

import copy
import unittest

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

    def test_unknown_is_non_negative(self) -> None:
        self.assertEqual(
            role_taxonomy.classify_title("Service Desk Operator", self.taxonomy),
            {
                "classification_status": "unknown",
                "role_family": "UNKNOWN",
                "role_member": [],
            },
        )

    def test_multi_match_within_family_is_preserved(self) -> None:
        result = role_taxonomy.classify_title(
            "Technical Project Manager",
            self.taxonomy,
        )
        self.assertEqual(result["classification_status"], "matched")
        self.assertEqual(result["role_family"], "PROJECT_MANAGEMENT")
        self.assertEqual(
            result["role_member"],
            ["project_manager", "technical_project_manager"],
        )

    def test_member_exclusion_does_not_cancel_other_member(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["families"]["PROJECT_MANAGEMENT"]["members"] = [
            {
                "code": "manager",
                "label": "Manager",
                "include_patterns": [r"\bmanager\b"],
                "exclude_patterns": [r"\btechnical\s+manager\b"],
            },
            {
                "code": "technical_manager",
                "label": "Technical Manager",
                "include_patterns": [r"\btechnical\s+manager\b"],
                "exclude_patterns": [],
            },
        ]
        for code in (
            "DELIVERY",
            "SERVICE_MANAGEMENT",
            "SCRUM_AGILE",
            "PROGRAM_PMO",
        ):
            taxonomy["families"][code]["members"] = [
                {
                    "code": f"placeholder_{code.casefold()}",
                    "label": "Placeholder",
                    "include_patterns": [rf"\bplaceholder_{code.casefold()}\b"],
                    "exclude_patterns": [],
                }
            ]

        result = role_taxonomy.classify_title("Technical Manager", taxonomy)
        self.assertEqual(result["classification_status"], "matched")
        self.assertEqual(result["role_member"], ["technical_manager"])

    def test_duplicate_include_pattern_is_rejected(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["families"]["DELIVERY"]["members"][0]["include_patterns"] = [
            r"\bproject\s+manager\b"
        ]
        with self.assertRaisesRegex(
            role_taxonomy.TaxonomyValidationError,
            "conflicting include pattern",
        ):
            role_taxonomy.validate_taxonomy(taxonomy)

    def test_invalid_regex_is_rejected(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["families"]["DELIVERY"]["members"][0]["include_patterns"] = ["("]
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
        taxonomy["taxonomy_version"] = "2026.09.25-2"
        taxonomy["families"]["PROGRAM_PMO"]["members"].append(
            {
                "code": "portfolio_manager",
                "label": "Portfolio Manager",
                "include_patterns": [r"\bportfolio\s+manager\b"],
                "exclude_patterns": [],
            }
        )
        role_taxonomy.validate_taxonomy(taxonomy)

        result = role_taxonomy.classify_title("Portfolio Manager", taxonomy)
        self.assertEqual(result["role_family"], "PROGRAM_PMO")
        self.assertEqual(result["role_member"], ["portfolio_manager"])

    def test_regression_version_mismatch_is_rejected(self) -> None:
        corpus = copy.deepcopy(self.corpus)
        corpus["taxonomy_version"] = "2026.09.25-999"
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
        result = role_taxonomy.classify_title(
            "IT—Project_Manager",
            self.taxonomy,
        )
        self.assertEqual(result["role_family"], "PROJECT_MANAGEMENT")
        self.assertEqual(
            result["role_member"],
            ["it_project_manager", "project_manager"],
        )


if __name__ == "__main__":
    unittest.main()
