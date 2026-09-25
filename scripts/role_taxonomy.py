#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TAXONOMY_PATH = ROOT / "shared" / "role-taxonomy.json"
DEFAULT_CORPUS_PATH = ROOT / "shared" / "role-taxonomy-regression.json"

SCHEMA_VERSION = "1.0"
CANONICAL_FAMILIES = (
    "PROJECT_MANAGEMENT",
    "DELIVERY",
    "SERVICE_MANAGEMENT",
    "SCRUM_AGILE",
    "PROGRAM_PMO",
    "UNKNOWN",
)
FORBIDDEN_PROVIDER_KEYS = {
    "provider_queries",
    "provider_query",
    "query_terms",
    "source_queries",
    "retrieval_queries",
}


class TaxonomyValidationError(ValueError):
    """Raised when the shared taxonomy or its regression corpus is invalid."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise TaxonomyValidationError(message)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TaxonomyValidationError(f"{path}: cannot load JSON: {exc}") from exc
    _require(isinstance(payload, dict), f"{path}: top-level JSON must be an object")
    return payload


def normalize_title(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    text = re.sub(r"[\W_]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _assert_no_provider_query_contract(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            _require(
                key not in FORBIDDEN_PROVIDER_KEYS,
                f"{path}.{key}: provider-query contracts are forbidden in shared taxonomy",
            )
            _assert_no_provider_query_contract(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_no_provider_query_contract(child, f"{path}[{index}]")


def validate_taxonomy(taxonomy: dict[str, Any]) -> None:
    _require(taxonomy.get("schema_version") == SCHEMA_VERSION, "unsupported taxonomy schema_version")
    version = taxonomy.get("taxonomy_version")
    _require(
        isinstance(version, str) and re.fullmatch(r"\d{4}\.\d{2}\.\d{2}-\d+", version) is not None,
        "taxonomy_version must match YYYY.MM.DD-N",
    )
    canonical = taxonomy.get("canonical_families")
    _require(canonical == list(CANONICAL_FAMILIES), "canonical_families must exactly match ADR-005 order")
    families = taxonomy.get("families")
    _require(isinstance(families, dict), "families must be an object")
    _require(set(families) == set(CANONICAL_FAMILIES), "families must contain exactly ADR-005 canonical families")
    _assert_no_provider_query_contract(taxonomy)

    member_codes: set[str] = set()
    global_include_patterns: dict[str, str] = {}

    for family_code in CANONICAL_FAMILIES:
        family = families[family_code]
        _require(isinstance(family, dict), f"{family_code}: family must be an object")
        _require(isinstance(family.get("label"), str) and family["label"].strip(), f"{family_code}: label required")
        members = family.get("members")
        _require(isinstance(members, list), f"{family_code}: members must be an array")

        if family_code == "UNKNOWN":
            _require(members == [], "UNKNOWN family must not define role members")
            continue

        _require(bool(members), f"{family_code}: at least one member is required")
        for member in members:
            _require(isinstance(member, dict), f"{family_code}: member must be an object")
            code = member.get("code")
            _require(
                isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]*", code) is not None,
                f"{family_code}: invalid member code {code!r}",
            )
            _require(code not in member_codes, f"duplicate role member code: {code}")
            member_codes.add(code)
            _require(isinstance(member.get("label"), str) and member["label"].strip(), f"{code}: label required")

            includes = member.get("include_patterns")
            excludes = member.get("exclude_patterns")
            _require(isinstance(includes, list) and includes, f"{code}: include_patterns must be non-empty")
            _require(isinstance(excludes, list), f"{code}: exclude_patterns must be an array")

            include_keys: set[str] = set()
            exclude_keys: set[str] = set()
            for kind, patterns, seen in (
                ("include", includes, include_keys),
                ("exclude", excludes, exclude_keys),
            ):
                for pattern in patterns:
                    _require(isinstance(pattern, str) and pattern.strip(), f"{code}: empty {kind} pattern")
                    key = pattern.casefold()
                    _require(key not in seen, f"{code}: duplicate {kind} pattern {pattern!r}")
                    seen.add(key)
                    try:
                        re.compile(pattern, re.IGNORECASE)
                    except re.error as exc:
                        raise TaxonomyValidationError(
                            f"{code}: invalid {kind} regex {pattern!r}: {exc}"
                        ) from exc

            overlap = include_keys & exclude_keys
            _require(
                not overlap,
                f"{code}: same pattern cannot be both include and exclude: {sorted(overlap)}",
            )

            for pattern in includes:
                key = pattern.casefold()
                prior = global_include_patterns.get(key)
                _require(
                    prior is None,
                    f"conflicting include pattern {pattern!r}: assigned to both {prior} and {code}",
                )
                global_include_patterns[key] = code


def classify_title(title: object, taxonomy: dict[str, Any]) -> dict[str, Any]:
    validate_taxonomy(taxonomy)
    normalized = normalize_title(title)
    matched: list[tuple[str, str]] = []

    for family_code in CANONICAL_FAMILIES:
        if family_code == "UNKNOWN":
            continue
        for member in taxonomy["families"][family_code]["members"]:
            included = any(
                re.search(pattern, normalized, re.IGNORECASE)
                for pattern in member["include_patterns"]
            )
            if not included:
                continue
            excluded = any(
                re.search(pattern, normalized, re.IGNORECASE)
                for pattern in member["exclude_patterns"]
            )
            if not excluded:
                matched.append((family_code, member["code"]))

    if not matched:
        return {
            "classification_status": "unknown",
            "role_family": "UNKNOWN",
            "role_member": [],
        }

    family_codes = sorted({family for family, _ in matched})
    members = sorted({member for _, member in matched})
    if len(family_codes) > 1:
        return {
            "classification_status": "conflict",
            "role_family": None,
            "role_member": members,
            "family_candidates": family_codes,
        }

    return {
        "classification_status": "matched",
        "role_family": family_codes[0],
        "role_member": members,
    }


def validate_regression_corpus(
    taxonomy: dict[str, Any],
    corpus: dict[str, Any],
) -> None:
    _require(corpus.get("schema_version") == SCHEMA_VERSION, "unsupported regression schema_version")
    _require(
        corpus.get("taxonomy_version") == taxonomy.get("taxonomy_version"),
        "regression taxonomy_version must equal taxonomy taxonomy_version",
    )
    cases = corpus.get("cases")
    _require(isinstance(cases, list) and cases, "regression cases must be a non-empty array")

    case_ids: set[str] = set()
    failures: list[str] = []
    for case in cases:
        _require(isinstance(case, dict), "regression case must be an object")
        case_id = case.get("id")
        _require(isinstance(case_id, str) and case_id.strip(), "regression case id required")
        _require(case_id not in case_ids, f"duplicate regression case id: {case_id}")
        case_ids.add(case_id)
        _require(
            isinstance(case.get("title"), str) and case["title"].strip(),
            f"{case_id}: title required",
        )
        _require(
            isinstance(case.get("evidence"), str) and case["evidence"].strip(),
            f"{case_id}: evidence required",
        )
        expected = case.get("expected")
        _require(isinstance(expected, dict), f"{case_id}: expected object required")

        actual = classify_title(case["title"], taxonomy)
        if actual != expected:
            failures.append(
                f"{case_id}: title={case['title']!r} expected={expected!r} actual={actual!r}"
            )

    _require(not failures, "regression failures:\n" + "\n".join(failures))


def validate_files(
    taxonomy_path: Path = DEFAULT_TAXONOMY_PATH,
    corpus_path: Path = DEFAULT_CORPUS_PATH,
) -> tuple[dict[str, Any], dict[str, Any]]:
    taxonomy = _load_json(taxonomy_path)
    corpus = _load_json(corpus_path)
    validate_taxonomy(taxonomy)
    validate_regression_corpus(taxonomy, corpus)
    return taxonomy, corpus


def _cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Validate the shared role taxonomy and regression corpus."
    )
    parser.add_argument("command", choices=("validate",))
    parser.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY_PATH)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    args = parser.parse_args(argv)

    try:
        taxonomy, corpus = validate_files(args.taxonomy, args.corpus)
    except TaxonomyValidationError as exc:
        print(f"role taxonomy validation failed: {exc}", file=sys.stderr)
        return 1

    members = sum(
        len(taxonomy["families"][family]["members"])
        for family in CANONICAL_FAMILIES
        if family != "UNKNOWN"
    )
    print(
        "role taxonomy validation passed: "
        f"version={taxonomy['taxonomy_version']} "
        f"families={len(CANONICAL_FAMILIES)} members={members} cases={len(corpus['cases'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
