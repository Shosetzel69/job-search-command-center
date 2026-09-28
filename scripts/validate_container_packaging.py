#!/usr/bin/env python3
"""Fail closed if container packaging can include mutable runtime data."""
from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import PurePosixPath

ALLOWED_CANDIDATE_DATA = frozenset(
    {
        "data/sources.json",
        "data/source-categories.json",
        "data/nomenclatures.json",
    }
)

PROHIBITED_RUNTIME_FILES = frozenset(
    {
        "applications.json",
        "jobs.json",
        "run-history.json",
        "run-status.json",
        "search-config.json",
        "search-state.json",
    }
)


class PackagingValidationError(ValueError):
    pass


def _logical_lines(text: str) -> list[tuple[int, str]]:
    lines: list[tuple[int, str]] = []
    buffer = ""
    start_line = 0

    for number, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not buffer and (not stripped or stripped.startswith("#")):
            continue

        if not buffer:
            start_line = number

        if raw.rstrip().endswith("\\"):
            buffer += raw.rstrip()[:-1] + " "
            continue

        buffer += raw
        logical = buffer.strip()
        if logical and not logical.startswith("#"):
            lines.append((start_line, logical))
        buffer = ""

    if buffer.strip():
        lines.append((start_line, buffer.strip()))

    return lines


def _copy_sources(payload: str) -> list[str]:
    payload = payload.strip()
    if not payload:
        raise PackagingValidationError("COPY/ADD instruction has no arguments")

    if payload.startswith("["):
        try:
            values = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise PackagingValidationError(f"invalid JSON COPY/ADD form: {exc}") from exc
        if not isinstance(values, list) or len(values) < 2 or not all(
            isinstance(value, str) for value in values
        ):
            raise PackagingValidationError(
                "JSON COPY/ADD form must contain source(s) and one destination"
            )
        return values[:-1]

    try:
        tokens = shlex.split(payload, comments=False, posix=True)
    except ValueError as exc:
        raise PackagingValidationError(f"invalid COPY/ADD arguments: {exc}") from exc

    while tokens and tokens[0].startswith("--"):
        tokens.pop(0)

    if len(tokens) < 2:
        raise PackagingValidationError("COPY/ADD must contain source(s) and one destination")
    return tokens[:-1]


def _normalise_source(source: str) -> str:
    source = source.replace("\\", "/").strip()
    while source.startswith("./"):
        source = source[2:]
    return source.rstrip("/")


def _validate_source(source: str, line_number: int) -> None:
    normalized = _normalise_source(source)
    lowered = normalized.lower()

    if normalized in {"", "."}:
        raise PackagingValidationError(
            f"line {line_number}: broad build-context copy is prohibited: {source!r}"
        )

    if any(char in normalized for char in "*?["):
        raise PackagingValidationError(
            f"line {line_number}: wildcard COPY/ADD source is prohibited by the "
            f"candidate-data boundary: {source!r}"
        )

    parts = [part for part in PurePosixPath(lowered).parts if part not in {"/", "."}]
    if any(part in PROHIBITED_RUNTIME_FILES for part in parts):
        raise PackagingValidationError(
            f"line {line_number}: prohibited runtime file can enter the image: {source!r}"
        )

    if "data" not in parts:
        return

    data_index = parts.index("data")
    candidate_path = "/".join(parts[data_index:])

    if candidate_path not in ALLOWED_CANDIDATE_DATA:
        raise PackagingValidationError(
            f"line {line_number}: non-allowlisted data asset can enter the image: "
            f"{source!r}; allowed={sorted(ALLOWED_CANDIDATE_DATA)}"
        )


def validate_dockerfile_text(text: str) -> None:
    found_packaging_instruction = False

    for line_number, logical in _logical_lines(text):
        keyword, _, payload = logical.partition(" ")
        instruction = keyword.upper()
        if instruction not in {"COPY", "ADD"}:
            continue

        found_packaging_instruction = True
        for source in _copy_sources(payload):
            _validate_source(source, line_number)

    if not found_packaging_instruction:
        raise PackagingValidationError(
            "Dockerfile contains no COPY/ADD instruction; packaging contract cannot be proven"
        )


def validate_dockerfile(path: str) -> None:
    with open(path, "r", encoding="utf-8") as handle:
        validate_dockerfile_text(handle.read())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate that a Dockerfile cannot package JSCC mutable runtime data."
    )
    parser.add_argument("dockerfile", help="Dockerfile path to validate")
    args = parser.parse_args()

    try:
        validate_dockerfile(args.dockerfile)
    except (OSError, PackagingValidationError) as exc:
        print(f"PACKAGING_GUARD_FAIL: {exc}", file=sys.stderr)
        return 1

    print("PACKAGING_GUARD_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
