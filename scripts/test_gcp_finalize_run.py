#!/usr/bin/env python3
"""Deterministic publication checks; no GCP account or network access required."""
import io
import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gcp_finalize_run


class FakeGCS:
    def __init__(self, reject=None):
        self.reject = reject
        self.writes = []
        self.generations = {"latest-run.json": "5", "current.json": "8"}

    def __call__(self, req):
        url = req.full_url
        if "metadata.google.internal" in url:
            return io.BytesIO(b'{"access_token":"dummy"}')
        if "upload/storage" not in url:
            return io.BytesIO(json.dumps({"generation": self.generations["latest-run.json"]}).encode())
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        name = query["name"][0]
        generation = query["ifGenerationMatch"][0]
        if name == self.reject or generation != (
            "0" if name.startswith("run-completions/") else self.generations[name]
        ):
            raise urllib.error.HTTPError(url, 412, "Precondition Failed", {}, None)
        content = json.loads(req.data)
        self.writes.append((name, generation, content))
        return io.BytesIO(b"{}")


class FinalizerTests(unittest.TestCase):
    def run_case(self, state, reject=None):
        with tempfile.TemporaryDirectory() as tmp:
            run_id = "run-00000000-0000-4000-8000-000000000001"
            Path(tmp, "run-status.json").write_text(json.dumps({
                "run_id": run_id, "status": state, "completed_at": "2026-10-12T12:04:12Z"
            }))
            gcs = FakeGCS(reject)
            env = {"JSCC_RUN_ID": run_id, "GCP_RUNTIME_BUCKET": "test-bucket",
                   "GCP_CURRENT_GENERATION": "8", "JSCC_RUNTIME_DATA_DIR": tmp,
                   "CLOUD_RUN_EXECUTION": "jscc-search-dev-5zgsw"}
            return env, gcs, lambda: gcp_finalize_run.finalize(env=env, request=gcs)

    def test_failed_worker_records_terminal_without_corpus(self):
        env, gcs, run = self.run_case("failed")
        run()
        self.assertEqual([x[0] for x in gcs.writes],
                         ["run-completions/" + env["JSCC_RUN_ID"] + ".json", "latest-run.json"])
        self.assertEqual(gcs.writes[0][2]["cloud_run_execution"], "jscc-search-dev-5zgsw")
        self.assertEqual(gcs.writes[0][2]["run_id"], env["JSCC_RUN_ID"])

    def test_success_only_publishes_with_original_generation(self):
        env, gcs, run = self.run_case("completed")
        run()
        self.assertEqual(gcs.writes[-1][0], "current.json")
        self.assertEqual(gcs.writes[-1][1], "8")
        self.assertEqual(gcs.writes[-1][2]["run_id"], env["JSCC_RUN_ID"])

    def test_current_pointer_412_does_not_retry(self):
        env, gcs, run = self.run_case("completed", reject="current.json")
        with self.assertRaises(urllib.error.HTTPError) as found:
            run()
        self.assertEqual(found.exception.code, 412)
        self.assertFalse(any(x[0] == "current.json" for x in gcs.writes))
        self.assertEqual(len(gcs.writes), 2)

    def test_latest_pointer_412_does_not_publish_jobs(self):
        env, gcs, run = self.run_case("completed", reject="latest-run.json")
        with self.assertRaises(urllib.error.HTTPError) as found:
            run()
        self.assertEqual(found.exception.code, 412)
        self.assertEqual(len(gcs.writes), 1)

    def test_status_run_mismatch_fails_before_network(self):
        env, gcs, run = self.run_case("completed")
        env["JSCC_RUN_ID"] = "another-run"
        with self.assertRaisesRegex(RuntimeError, "ownership mismatch"):
            run()
        self.assertEqual(gcs.writes, [])


if __name__ == "__main__":
    unittest.main()
