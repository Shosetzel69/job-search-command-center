#!/usr/bin/env python3
"""Canonical nomenclature loader shared by search-engine logic."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
NOMENCLATURES_PATH = ROOT / "data" / "nomenclatures.json"
SCHEMA_VERSION = "1.0"
REQUIRED_DOMAINS = {
    "regions",
    "countries",
    "work_modes",
    "contract_types",
    "application_statuses",
    "seniority",
}


def load_nomenclatures(path: Path = NOMENCLATURES_PATH) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError(f"Unsupported nomenclature schema: {payload.get('schema_version')}")
    domains = payload.get("domains")
    if not isinstance(domains, dict) or set(domains) != REQUIRED_DOMAINS:
        raise RuntimeError("Invalid nomenclature domains")
    for name, domain in domains.items():
        if domain.get("kind") not in {"system", "extensible"}:
            raise RuntimeError(f"Invalid nomenclature kind: {name}")
        if bool(domain.get("extensible")) != (domain.get("kind") == "extensible"):
            raise RuntimeError(f"Inconsistent extensibility: {name}")
        if not isinstance(domain.get("values"), list):
            raise RuntimeError(f"Invalid nomenclature values: {name}")
    return payload


def domain_values(name: str, *, active_only: bool = False, payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    source = payload or load_nomenclatures()
    values = list(source["domains"][name]["values"])
    values.sort(key=lambda item: (int(item.get("sort_order", 0)), str(item.get("label", ""))))
    return [item for item in values if item.get("active") is True] if active_only else values


def active_codes(name: str, payload: dict[str, Any] | None = None) -> set[str]:
    return {str(item["code"]) for item in domain_values(name, active_only=True, payload=payload)}


def region_countries(payload: dict[str, Any] | None = None) -> dict[str, set[str]]:
    return {
        str(item["code"]).upper(): {str(code).upper() for code in item.get("country_codes", [])}
        for item in domain_values("regions", payload=payload)
    }


def country_names(payload: dict[str, Any] | None = None) -> dict[str, str]:
    return {
        str(item["code"]).upper(): str(item["label"])
        for item in domain_values("countries", payload=payload)
    }


def country_name_to_code(payload: dict[str, Any] | None = None) -> dict[str, str]:
    output: dict[str, str] = {}
    for item in domain_values("countries", payload=payload):
        code = str(item["code"]).upper()
        for name in [item.get("label"), *(item.get("aliases") or [])]:
            text = str(name or "").strip().lower()
            if text:
                output[text] = code
    return output


def active_region_codes(payload: dict[str, Any] | None = None) -> set[str]:
    return {code.upper() for code in active_codes("regions", payload)}


def active_country_codes(payload: dict[str, Any] | None = None) -> set[str]:
    return {code.upper() for code in active_codes("countries", payload)}


def work_mode_aliases(payload: dict[str, Any] | None = None) -> dict[str, str]:
    output: dict[str, str] = {}
    for item in domain_values("work_modes", payload=payload):
        code = str(item["code"]).lower()
        for value in [item.get("code"), item.get("label"), *(item.get("aliases") or [])]:
            text = str(value or "").strip().lower()
            if text:
                output[text] = code
    return output


def contract_type_aliases(payload: dict[str, Any] | None = None) -> dict[str, str]:
    output: dict[str, str] = {}
    for item in domain_values("contract_types", payload=payload):
        code = str(item["code"]).lower()
        for value in [item.get("code"), item.get("label"), *(item.get("aliases") or [])]:
            text = str(value or "").strip().lower()
            if text:
                output[text] = code
    return output


def normalize_work_mode(value: Any, payload: dict[str, Any] | None = None) -> str:
    text = str(value or "").strip().lower()
    return work_mode_aliases(payload).get(text, "unknown")


def normalize_contract_type(values: Any, payload: dict[str, Any] | None = None) -> str:
    raw_values = values if isinstance(values, list) else ([] if values in (None, "") else [values])
    aliases = contract_type_aliases(payload)
    matches: set[str] = set()
    for value in raw_values:
        text = str(value or "").strip().lower().replace("_", " ")
        if text in aliases:
            matches.add(aliases[text])
        compact = " ".join(text.split())
        if compact in aliases:
            matches.add(aliases[compact])
    return next(iter(matches)) if len(matches) == 1 else "unknown"


def contract_type_label(code: str, payload: dict[str, Any] | None = None) -> str | None:
    for item in domain_values("contract_types", payload=payload):
        if str(item.get("code")) == code:
            return str(item.get("label"))
    return None
