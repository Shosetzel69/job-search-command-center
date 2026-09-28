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

    def test_validate_only_runs_with_external_runtime_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp)
            for name in RUNTIME_FILES:
                source = ROOT / "data" / name
                if source.exists():
                    (runtime / name).write_bytes(source.read_bytes())

            # The source-controlled runtime snapshot predates jobs provenance
            # stamping. Normalize only the temporary fixture so validate-only
            # tests the external runtime boundary against a coherent snapshot.
            status = json.loads((runtime / "run-status.json").read_text(encoding="utf-8"))
            jobs = json.loads((runtime / "jobs.json").read_text(encoding="utf-8"))
            if jobs.get("generated_at") == status.get("started_at"):
                jobs["run_id"] = status.get("run_id")
                jobs["run_status"] = status.get("status")
                if status.get("source_sha"):
                    jobs["source_sha"] = status.get("source_sha")
                (runtime / "jobs.json").write_text(
                    json.dumps(jobs, ensure_ascii=False, indent=2) + "\\n",
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
