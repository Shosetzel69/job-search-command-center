"""Unit tests for #593 exact-source cap patch and fail-closed behavior."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/gcp/patch_workspace_manager_limit.py"
spec = importlib.util.spec_from_file_location("cap_patch", SCRIPT)
cap_patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cap_patch)


class SourcePatchTests(unittest.TestCase):
    def test_80_to_100(self):
        source = "MAX_FILES = 80\nMAX_TOTAL = 2097152\nMAX_FILE = 131072\n"
        changed, status = cap_patch.patch_text(source, apply=True)
        self.assertEqual(status, "PATCH_READY")
        self.assertEqual(changed, source.replace("MAX_FILES = 80", "MAX_FILES = 100"))
        self.assertIn("MAX_TOTAL = 2097152", changed)
        self.assertIn("MAX_FILE = 131072", changed)

    def test_dry_run_is_unchanged(self):
        source = "MAX_FILES=80  # limit\n"
        result, status = cap_patch.patch_text(source)
        self.assertEqual(result, source)
        self.assertEqual(status, "PATCH_READY")

    def test_idempotent_100(self):
        source = "MAX_FILES=100\n"
        self.assertEqual(cap_patch.patch_text(source, apply=True), (source, "ALREADY_100"))

    def test_unexpected_limit_rejected(self):
        with self.assertRaisesRegex(ValueError, "unexpected MAX_FILES"):
            cap_patch.patch_text("MAX_FILES=95\n", apply=True)

    def test_multiple_declarations_rejected(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            cap_patch.patch_text("MAX_FILES=80\nMAX_FILES=80\n", apply=True)

    def test_missing_declaration_rejected(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            cap_patch.patch_text("MAX_TOTAL=2097152\n", apply=True)


if __name__ == "__main__":
    unittest.main()
