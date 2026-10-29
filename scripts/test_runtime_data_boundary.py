#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
RUNTIME_FILES = (
    "applications.json",
    "jobs.json",
    "run-history.json",
    "run-status.json",
    "search-config.json",
    "search-state.json",
)
CANDIDATE_FILES = (
    "sources.json",
    "source-categories.json",
    "nomenclatures.json",
)


class RuntimeDataBoundaryTests(unittest.TestCase):
    def run_python(self, code: str, env: dict[str, str]):
        merged = os.environ.copy()
        merged.update(env)
        merged["PYTHONPATH"] = str(SCRIPTS)
        return subprocess.run(
            [sys.executable, "-c", code],
            cwd=ROOT,
            env=merged,
            text=True,
            capture_output=True,
        )

    def test_container_mode_requires_explicit_runtime_root(self):
        env = {
            "JSCC_RUNTIME_MODE": "container",
            "JSCC_RUNTIME_DATA_DIR": "",
        }
        result = self.run_python("import job_search", env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("JSCC_RUNTIME_DATA_DIR is required", result.stderr)

    def test_external_runtime_root_separates_mutable_and_candidate_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp)
            for name in RUNTIME_FILES:
                source = ROOT / "data" / name
                if source.exists():
                    (runtime / name).write_bytes(source.read_bytes())

            code = """
import json
import job_search as engine
import job_search_optimized as optimized
import job_search_runner as runner
import source_orchestration as orchestration

payload = {
    "runtime": str(engine.RUNTIME_DATA),
    "candidate": str(engine.CANDIDATE_DATA),
    "config": str(engine.CONFIG_PATH),
    "jobs": str(engine.JOBS_PATH),
    "status": str(engine.STATUS_PATH),
    "history": str(runner.HISTORY_PATH),
    "state": str(optimized.STATE_PATH),
    "sources": str(orchestration.SOURCES_PATH),
}
print(json.dumps(payload))
"""
            result = self.run_python(
                code,
                {
                    "JSCC_RUNTIME_MODE": "container",
                    "JSCC_RUNTIME_DATA_DIR": str(runtime),
                },
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            paths = json.loads(result.stdout)
            self.assertEqual(Path(paths["runtime"]), runtime.resolve())
            for key in ("config", "jobs", "status", "history", "state"):
                self.assertEqual(Path(paths[key]).parent, runtime.resolve())
            self.assertEqual(
                Path(paths["sources"]),
                (ROOT / "data" / "sources.json").resolve(),
            )
            self.assertNotEqual(Path(paths["candidate"]), runtime.resolve())

    def test_only_dev_container_reads_source_registry_from_runtime_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = """
import json
import source_orchestration as orchestration
print(json.dumps({"sources":str(orchestration.SOURCES_PATH)}))
"""
            for environment in ("dev", "test", "prod"):
                output = self.run_python(code, {
                    "APP_ENV": environment,
                    "JSCC_RUNTIME_MODE": "container",
                    "JSCC_RUNTIME_DATA_DIR": tmp,
                })
                self.assertEqual(output.returncode, 0, output.stderr)
                actual = Path(json.loads(output.stdout)["sources"])
                expected = (Path(tmp) if environment == "dev" else ROOT / "data") / "sources.json"
                self.assertEqual(actual, expected.resolve(), environment)

    def test_manual_scope_validates_without_seed_role_criteria(self):
        """A bounded DEV USER refresh must not depend on legacy global roles."""
        code = """
import json
import job_search as engine
import shared_corpus_repository as shared

seed = json.loads(engine.CONFIG_PATH.read_text(encoding="utf-8"))
seed["target_role_families"] = []
seed["target_role_subfamilies"] = []
scope = {
    "scopes": [{
        "role_family": "PROJECT_DELIVERY_MANAGEMENT",
        "role_subfamilies": ["project_management"],
        "target_regions": [],
        "target_country_codes": ["RO"],
        "remote_eligible_country_codes": ["RO"],
        "work_modes": ["remote"],
        "contract_types": ["permanent", "contract"],
    }],
    "effective_source_ids": [],
}
try:
    engine.load_config(seed)
except RuntimeError as error:
    assert "target_role_families" in str(error)
else:
    raise AssertionError("global empty role selection should still fail closed")
effective = shared.shared_collection_config(seed, scope, "a" * 64)
effective["schema_version"] = seed["schema_version"]
validated = engine.load_config(effective)
assert validated["target_role_families"] == ["PROJECT_DELIVERY_MANAGEMENT"]
assert validated["target_role_subfamilies"] == ["project_management"]
assert validated["target_country_codes"] == ["RO"]
print("SCOPED_CONFIG_VALIDATION_PASS")
"""
        result = self.run_python(code, {"JSCC_RUNTIME_MODE": ""})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SCOPED_CONFIG_VALIDATION_PASS", result.stdout)

    def test_runner_env_scope_and_stale_failure_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp)
            seed = json.loads((ROOT / "data/search-config.json").read_text())
            seed["target_role_families"] = []
            seed["target_role_subfamilies"] = []
            (runtime / "search-config.json").write_text(json.dumps(seed))
            prior = {"run_id": "previous", "status": "completed",
                     "started_at": "2001-01-01", "jobs_published": 55,
                     "limitations": ["previous-only"]}
            scope = {"scopes": [{"role_family": "PROJECT_DELIVERY_MANAGEMENT",
                     "role_subfamilies": ["project_management"],
                     "target_country_codes": ["RO"], "work_modes": ["remote"],
                     "contract_types": ["permanent"]}]}
            code = """
import json, os
from unittest.mock import patch
import job_search_runner as runner
import source_orchestration as orchestration
import shared_corpus_repository as shared
def stop(config, now, **kw):
    assert config["target_role_families"] == ["PROJECT_DELIVERY_MANAGEMENT"]
    assert kw["run_id"] == "new-run"
    raise RuntimeError("test-stop")
with patch.object(shared, "apply_collection_policy", side_effect=lambda c: c), patch.object(shared, "persist_run_started") as begin, patch.object(shared, "persist_operational_run"), patch.object(runner, "append_run_history"), patch.object(runner, "stamp_jobs_provenance"), patch.object(runner, "validate_history"), patch.object(orchestration, "run", side_effect=stop) as invoke:
    assert runner.main() == 2
    expected = 1 if os.environ.get("JSCC_RETRIEVE_SCOPE_JSON") else 0
    assert invoke.call_count == expected
    assert begin.call_count == expected
status = json.loads(runner.engine.STATUS_PATH.read_text())
assert status["run_id"] == "new-run"
assert status["status"] == "failed"
assert status["jobs_published"] == 0
assert status["started_at"] != "2001-01-01"
assert "previous-only" not in status["limitations"]
"""
            for scoped in (True, False):
                (runtime / "run-status.json").write_text(json.dumps(prior))
                result = self.run_python(code, {
                    "JSCC_RUNTIME_MODE": "container",
                    "JSCC_RUNTIME_DATA_DIR": str(runtime),
                    "JSCC_RUN_ID": "new-run",
                    "JSCC_REQUEST_SIGNATURE": "a" * 64 if scoped else "",
                    "JSCC_RETRIEVE_SCOPE_JSON": json.dumps(scope) if scoped else "",
                    "NILE_DATABASE_URL": "",
                })
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_validate_only_runs_with_external_runtime_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp)

            # Keep the real search-config contract, but use deterministic minimal
            # runtime artifacts so this test validates the external boundary
            # rather than historical source-controlled runtime snapshots.
            (runtime / "search-config.json").write_bytes(
                (ROOT / "data" / "search-config.json").read_bytes()
            )
            (runtime / "jobs.json").write_text(
                json.dumps({
                    "schema_version": "1.0",
                    "generated_at": "2026-01-01T00:00:00+00:00",
                    "freshness_hours": 24,
                    "criteria": {},
                    "records_inspected": 0,
                    "results": 0,
                    "excluded_count": 0,
                    "jobs": [],
                }) + "\n",
                encoding="utf-8",
            )
            (runtime / "run-status.json").write_text(
                json.dumps({
                    "schema_version": "1.0",
                    "run_id": "boundary-validation",
                    "status": "running",
                    "started_at": "2026-01-01T00:00:01+00:00",
                    "completed_at": None,
                    "sources": [],
                    "sources_processed": 0,
                    "records_inspected": 0,
                    "jobs_published": 0,
                    "excluded": 0,
                    "limitations": [],
                }) + "\n",
                encoding="utf-8",
            )
            (runtime / "run-history.json").write_text(
                json.dumps({"schema_version": "1.0", "runs": []}) + "\n",
                encoding="utf-8",
            )
            (runtime / "search-state.json").write_text(
                json.dumps({
                    "schema_version": "1.0",
                    "query_progress": {},
                    "job_first_seen": {},
                    "usage": {},
                }) + "\n",
                encoding="utf-8",
            )

            env = os.environ.copy()
            env.update({
                "JSCC_RUNTIME_MODE": "container",
                "JSCC_RUNTIME_DATA_DIR": str(runtime),
            })
            result = subprocess.run(
                [sys.executable, "scripts/job_search_runner.py", "--validate-only"],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("valid", result.stdout.lower())

    def test_candidate_allowlist_is_exact(self):
        self.assertEqual(
            set(CANDIDATE_FILES),
            {"sources.json", "source-categories.json", "nomenclatures.json"},
        )
        self.assertTrue(set(CANDIDATE_FILES).isdisjoint(RUNTIME_FILES))


if __name__ == "__main__":
    unittest.main()
