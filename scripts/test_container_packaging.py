#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from validate_container_packaging import (  # noqa: E402
    ALLOWED_CANDIDATE_DATA,
    PROHIBITED_RUNTIME_FILES,
    PackagingValidationError,
    validate_dockerfile,
    validate_dockerfile_text,
)


class ContainerPackagingGuardTests(unittest.TestCase):
    def test_explicit_candidate_allowlist_passes(self):
        dockerfile = """
FROM python:3.12-slim
WORKDIR /app
COPY scripts/ ./scripts/
COPY data/sources.json data/source-categories.json data/nomenclatures.json ./data/
CMD ["python", "scripts/job_search_runner.py"]
"""
        validate_dockerfile_text(dockerfile)

    def test_broad_data_copy_fails(self):
        with self.assertRaises(PackagingValidationError):
            validate_dockerfile_text(
                "FROM python:3.12-slim\nCOPY data/ ./data/\n"
            )

    def test_broad_build_context_copy_fails(self):
        with self.assertRaises(PackagingValidationError):
            validate_dockerfile_text(
                "FROM python:3.12-slim\nCOPY . .\n"
            )

    def test_each_prohibited_runtime_file_fails(self):
        for filename in sorted(PROHIBITED_RUNTIME_FILES):
            with self.subTest(filename=filename):
                with self.assertRaises(PackagingValidationError):
                    validate_dockerfile_text(
                        f"FROM python:3.12-slim\nCOPY data/{filename} ./data/{filename}\n"
                    )

    def test_non_allowlisted_data_asset_fails(self):
        with self.assertRaises(PackagingValidationError):
            validate_dockerfile_text(
                "FROM python:3.12-slim\nCOPY data/unexpected.json ./data/unexpected.json\n"
            )

    def test_json_copy_form_is_enforced(self):
        with self.assertRaises(PackagingValidationError):
            validate_dockerfile_text(
                'FROM python:3.12-slim\nCOPY ["data/jobs.json", "/app/data/jobs.json"]\n'
            )

    def test_allowlist_is_the_architecture_contract(self):
        self.assertEqual(
            ALLOWED_CANDIDATE_DATA,
            frozenset(
                {
                    "data/sources.json",
                    "data/source-categories.json",
                    "data/nomenclatures.json",
                }
            ),
        )

    def test_cli_validator_consumes_a_real_dockerfile_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Dockerfile"
            path.write_text(
                "FROM python:3.12-slim\n"
                "COPY scripts/ ./scripts/\n"
                "COPY data/sources.json data/source-categories.json "
                "data/nomenclatures.json ./data/\n",
                encoding="utf-8",
            )
            validate_dockerfile(str(path))


if __name__ == "__main__":
    unittest.main()
