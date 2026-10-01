import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import shared_corpus_repository as repository


NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone)
ROOT = Path(__file__).resolve().parents[1]


class FakeCursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.queries = []
        self.rowcount = 0

    def execute(self, sql, params=None):
        self.queries.append((" ".join(sql.split()), params))
        self.rowcount = 0
        return self

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class SharedCorpusProjectionTests(unittest.TestCase):
    def test_external_id_precedes_url_and_personal_fields_are_not_persisted(self):
        with patch.object(repository, "_role_family", return_value=("PROJECT_MANAGEMENT", "matched")):
            posting = repository.prepare_posting({
                "_jscc_source_id": "src-1",
                "_jscc_source_name": "Example",
                "id": "external-42",
                "title": "Technical Project Manager",
                "company": "Example",
                "url": "https://jobs.example/42?utm_source=test",
                "fit": 91,
                "status": "new",
                "pros": ["x"],
                "risks": ["y"],
            })
        self.assertEqual(posting.identity_kind, "EXTERNAL_ID")
        self.assertEqual(posting.identity_value, "external-42")
        self.assertEqual(posting.canonical_url, "https://jobs.example/42")
        for field in repository.PERSONAL_FIELDS:
            self.assertNotIn(field, posting.payload)

    def test_work_mode_uses_canonical_nomenclature(self):
        with patch.object(repository, "_nomenclatures", return_value={
            "domains": {
                "work_modes": {
                    "values": [
                        {"code": "remote", "label": "Remote", "aliases": [], "active": True},
                        {"code": "hybrid", "label": "Hibrid", "aliases": ["Hybrid"], "active": True},
                        {"code": "onsite", "label": "Onsite", "aliases": ["On-site"], "active": True},
                    ]
                }
            }
        }):
            self.assertEqual(repository._work_mode({"work_mode": "Hybrid"}), "hybrid")
            self.assertEqual(repository._work_mode({"work_mode": "provider-special"}), "unknown")

    def test_url_is_fallback_identity(self):
        with patch.object(repository, "_role_family", return_value=("UNKNOWN", "unknown")):
            posting = repository.prepare_posting({
                "_jscc_source_id": "src-1",
                "_jscc_source_name": "Example",
                "title": "Project Coordinator",
                "company": "Example",
                "url": "https://jobs.example/42",
            })
        self.assertEqual(posting.identity_kind, "CANONICAL_URL")
        self.assertEqual(posting.identity_value, "https://jobs.example/42")

    def test_record_without_identity_is_rejected(self):
        with patch.object(repository, "_role_family", return_value=("UNKNOWN", "unknown")):
            posting = repository.prepare_posting({
                "_jscc_source_id": "src-1",
                "_jscc_source_name": "Example",
                "title": "Project Manager",
                "company": "Example",
            })
        self.assertIsNone(posting)


class SharedCorpusRepositoryTests(unittest.TestCase):
    def posting(self, source_id="src-a", external_id="req-1", url="https://jobs.example/1"):
        return repository.SharedPosting(
            source_id=source_id,
            source_name=source_id,
            external_job_id=external_id,
            canonical_url=url,
            identity_kind="EXTERNAL_ID",
            identity_value=external_id,
            title="Project Manager",
            company="Example",
            location="Bucharest",
            country_codes=("RO",),
            work_mode="hybrid",
            role_family="PROJECT_MANAGEMENT",
            posted_at=NOW.isoformat(),
            repost_of_external_job_id=None,
            payload={},
        )

    @patch.object(repository.uuid, "uuid4", side_effect=[
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
    ])
    def test_new_source_posting_creates_canonical_job(self, _uuid):
        cursor = FakeCursor([None, None])
        job_id, created = repository._upsert_posting(cursor, self.posting(), "run-1", NOW)
        self.assertTrue(created)
        self.assertEqual(job_id, "00000000-0000-0000-0000-000000000001")
        sql = "\n".join(query for query, _ in cursor.queries)
        self.assertIn("INSERT INTO canonical_jobs", sql)
        self.assertIn("INSERT INTO source_postings", sql)

    @patch.object(repository.uuid, "uuid4", side_effect=[
        "00000000-0000-0000-0000-000000000003",
        "00000000-0000-0000-0000-000000000004",
    ])
    def test_new_requisition_id_same_source_is_not_auto_repost(self, _uuid):
        cursor = FakeCursor([None, None])
        posting = self.posting(external_id="req-new")
        _, created = repository._upsert_posting(cursor, posting, "run-2", NOW)
        self.assertTrue(created)
        insert = next((params for query, params in cursor.queries if "INSERT INTO source_postings" in query), None)
        self.assertIsNotNone(insert)
        self.assertIsNone(insert[11])

    def test_external_id_promotes_existing_same_source_url_identity(self):
        existing_posting = "00000000-0000-0000-0000-000000000070"
        existing_job = "00000000-0000-0000-0000-000000000071"
        cursor = FakeCursor([None, (existing_posting, existing_job)])
        job_id, created = repository._upsert_posting(
            cursor,
            self.posting(source_id="src-a", external_id="req-promoted"),
            "run-promote",
            NOW,
        )
        self.assertFalse(created)
        self.assertEqual(job_id, existing_job)
        identity_update = next(
            (params for query, params in cursor.queries if "SET identity_kind = 'EXTERNAL_ID'" in query),
            None,
        )
        self.assertEqual(identity_update, ("req-promoted", "req-promoted", existing_posting))
        self.assertFalse(any("INSERT INTO source_postings" in query for query, _ in cursor.queries))

    @patch.object(repository.uuid, "uuid4", return_value="00000000-0000-0000-0000-000000000005")
    def test_exact_cross_source_url_reuses_canonical_job(self, _uuid):
        existing_job = "00000000-0000-0000-0000-000000000099"
        cursor = FakeCursor([None, None, (existing_job,)])
        job_id, created = repository._upsert_posting(
            cursor,
            self.posting(source_id="src-b", external_id="req-b"),
            "run-3",
            NOW,
        )
        self.assertTrue(created)
        self.assertEqual(job_id, existing_job)
        sql = "\n".join(query for query, _ in cursor.queries)
        self.assertNotIn("INSERT INTO canonical_jobs", sql)

    def test_only_complete_sources_advance_lifecycle(self):
        plan = [
            {"source_id": "src-a", "outcome": "success"},
            {"source_id": "src-b", "outcome": "success_empty"},
            {"source_id": "src-c", "outcome": "partial"},
            {"source_id": "src-d", "outcome": "failed"},
            {"source_id": "src-e", "outcome": "blocked"},
        ]
        self.assertEqual(repository._complete_source_ids(plan), {"src-a", "src-b"})

    def test_database_binding_is_fail_closed(self):
        expected, _ = repository.expected_database({
            "APP_ENV": "dev",
            "NILE_DATABASE_URL": "postgresql://u:p@db.example/jobsearch_dev",
        })
        self.assertEqual(expected, "jobsearch_dev")
        with self.assertRaisesRegex(repository.SharedCorpusError, "mismatch"):
            repository.expected_database({
                "APP_ENV": "dev",
                "NILE_DATABASE_URL": "postgresql://u:p@db.example/jobsearch_prod",
            })

    def test_cloud_runtime_without_db_binding_fails(self):
        with self.assertRaisesRegex(repository.SharedCorpusError, "NILE_DATABASE_URL"):
            repository.persist_collection(
                [],
                [],
                run_id="run",
                now=NOW,
                env={"APP_ENV": "dev", "JSCC_RUNTIME_MODE": "container"},
            )

    def test_local_without_db_binding_is_explicit_noop(self):
        result = repository.persist_collection([], [], run_id="run", now=NOW, env={})
        self.assertEqual(result["status"], "local_not_configured")

    def test_migration_encodes_identity_lifecycle_and_retention_contracts(self):
        sql = (ROOT / "command-api/migrations/002_shared_job_corpus.sql").read_text(encoding="utf-8")
        self.assertIn("UNIQUE(source_id, identity_kind, identity_value)", sql)
        self.assertIn("'ACTIVE', 'UNCONFIRMED', 'INACTIVE'", sql)
        self.assertIn("retention_until", sql)
        self.assertIn("repost_of_posting_id", sql)
        self.assertIn("work_mode IN ('remote', 'hybrid', 'onsite', 'unknown')", sql)


if __name__ == "__main__":
    unittest.main()
