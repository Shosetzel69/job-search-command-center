from __future__ import annotations

import unittest
from datetime import datetime, timezone

from qa_seed_dev import SOURCE_ID, fixture_records


class DevQaSeedTests(unittest.TestCase):
    def test_synthetic_fixture_covers_every_family_and_unknown(self) -> None:
        records, summary = fixture_records(datetime(2026, 10, 9, tzinfo=timezone.utc))
        self.assertEqual(summary["provenance"], "SYNTHETIC")
        self.assertEqual(summary["records"], 14)
        self.assertEqual(len(summary["families"]), 7)
        self.assertGreaterEqual(summary["families"]["UNKNOWN"], 2)
        self.assertEqual(len(set(record["external_job_id"] for record in records)), 14)

    def test_fixtures_cannot_masquerade_as_real_jobs(self) -> None:
        records, _ = fixture_records(datetime(2026, 10, 9, tzinfo=timezone.utc))
        for record in records:
            with self.subTest(id=record["external_job_id"]):
                self.assertEqual(record["_jscc_source_id"], SOURCE_ID)
                self.assertTrue(record["title"].startswith("[QA SYNTHETIC] "))
                self.assertIn("SYNTHETIC", record["company"])
                self.assertTrue(record["url"].startswith("https://example.invalid/"))
                self.assertEqual(record["date_posted"], "2026-10-09T00:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
