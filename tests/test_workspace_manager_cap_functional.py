"""Functional boundary tests against the imported effective Workspace Manager source.

Runs entirely offline, with a fake GCS client: no credentials, bucket writes or deploys.
"""
import base64
from pathlib import Path
import sys
import unittest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "ops/workspace-manager"))
from service import backend, common, worker


class Blob:
    def __init__(self, i, size=1):
        self.name = f"workspace/v3/f{i:03d}.py"
        self.size = size
        self.generation = i + 1
        self.payload = b"x" * size

    def download_as_bytes(self, if_generation_match):
        if if_generation_match != self.generation:
            raise AssertionError("generation mismatch")
        return self.payload


class FakeClient:
    def __init__(self, n, size=1):
        self.objects = [Blob(i, size) for i in range(n)]
        self.requested_limit = None

    def list_blobs(self, bucket_name, prefix, max_results):
        if bucket_name != "dev-test" or prefix != "workspace/v3/":
            raise AssertionError("unexpected bucket or prefix")
        self.requested_limit = max_results
        return self.objects[:max_results]


def snapshot(n, size=1):
    storage = object.__new__(backend.GCSBackend)
    storage.client = FakeClient(n, size)
    storage.bucket_name = "dev-test"
    return storage.client, storage


class Cap100FunctionalTests(unittest.TestCase):
    def test_cap_100_and_unchanged_byte_caps(self):
        self.assertEqual(common.MAX_FILES, 100)
        self.assertEqual(common.MAX_FILE, 128 * 1024)
        self.assertEqual(common.MAX_TOTAL, 2 * 1024 * 1024)

    def test_gcs_99_allowed(self):
        client, storage = snapshot(99)
        self.assertEqual(len(storage.snapshot()), 99)
        self.assertEqual(client.requested_limit, 101)

    def test_gcs_100_allowed(self):
        client, storage = snapshot(100)
        self.assertEqual(len(storage.snapshot()), 100)
        self.assertEqual(client.requested_limit, 101)

    def test_gcs_101_rejected(self):
        client, storage = snapshot(101)
        with self.assertRaisesRegex(ValueError, "file_count_limit"):
            storage.snapshot()
        self.assertEqual(client.requested_limit, 101)

    def test_encoded_worker_snapshot_100_allowed(self):
        files = {f"f{i}.py": base64.b64encode(b"x").decode() for i in range(100)}
        self.assertEqual(len(common.checked_files(files)), 100)

    def test_encoded_worker_snapshot_101_rejected(self):
        files = {f"f{i}.py": base64.b64encode(b"x").decode() for i in range(101)}
        with self.assertRaisesRegex(ValueError, "file_count_limit"):
            common.checked_files(files)

    def test_actual_worker_executes_with_100_files(self):
        files = {f"sample_{i:03d}.txt": base64.b64encode(b"x").decode()
                 for i in range(100)}
        result = worker.execute(files, "command",
                                ["python3", "-c", "print('WORKER_CAP100_OK')"])
        self.assertEqual(result["exit_code"], 0)
        self.assertIn("WORKER_CAP100_OK", result["stdout"])
        self.assertFalse(result["timed_out"])

    def test_actual_worker_rejects_101_files(self):
        files = {f"sample_{i:03d}.txt": base64.b64encode(b"x").decode()
                 for i in range(101)}
        with self.assertRaisesRegex(ValueError, "file_count_limit"):
            worker.execute(files, "command",
                           ["python3", "-c", "print('MUST_NOT_RUN')"])

    def test_invalid_path_still_denied(self):
        with self.assertRaisesRegex(ValueError, "invalid_path"):
            common.checked_path("../secret")

    def test_total_cap_still_enforced_by_gcs(self):
        _, storage = snapshot(17, size=128 * 1024)
        with self.assertRaisesRegex(ValueError, "workspace_too_large"):
            storage.snapshot()

    def test_per_file_cap_still_enforced_by_gcs(self):
        _, storage = snapshot(1, size=128 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, "file_too_large"):
            storage.snapshot()


if __name__ == "__main__":
    unittest.main()
