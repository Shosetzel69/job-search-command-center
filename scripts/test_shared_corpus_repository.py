import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import job_search_apify as apify
import job_search_optimized as optimized
import shared_corpus_repository as repository


NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
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
    def test_shared_collection_envelope_is_profile_independent(self):
        config = {
            "role_groups": {"owner": {"enabled": True, "titles": ["Owner-only title"]}},
            "target_country_codes": ["RO"],
            "excluded_country_codes": ["DE"],
            "collection_freshness_hours": 24,
        }
        shared = repository.shared_collection_config(config)
        titles = shared["role_groups"]["shared_canonical_roles"]["titles"]
        self.assertIn("Project Manager", titles)
        self.assertIn("Scrum Master", titles)
        self.assertNotIn("Owner-only title", titles)
        self.assertEqual(shared["target_country_codes"], [])
        self.assertEqual(shared["excluded_country_codes"], [])
        self.assertTrue(shared["_jscc_shared_collection"])

    def test_shared_jobspipe_query_count_is_constant(self):
        config = repository.shared_collection_config({
            "collection_freshness_hours": 24,
            "jobspipe_incremental_overlap_minutes": 2,
            "jobspipe_apify_max_items_per_run": 5000,
        })
        specs = optimized.build_query_specs(config, {}, NOW)
        self.assertEqual(list(specs), ["global_scope"])
        self.assertNotIn("job_country_code_or", specs["global_scope"])
        self.assertNotIn("remote", specs["global_scope"])
        self.assertEqual(optimized.allocate_budget({"global_scope": 1000}, 14), {"global_scope": 14})
        apify_specs = apify._query_specs(config)
        self.assertEqual(len(apify_specs), 1)
        self.assertEqual(apify_specs[0][0], "global_scope")
        self.assertNotIn("countries", apify_specs[0][1])
        self.assertNotIn("remote", apify_specs[0][1])

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
            self.assertEqual(repository._work_mode({"mode": "Onsite"}), "onsite")
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
            posted_at=NOW,
            repost_of_external_job_id=None,
            payload={},
        )

    def test_new_source_posting_creates_canonical_job(self):
        cursor = FakeCursor([None, None])
        posting = self.posting()
        job_id, created = repository._upsert_posting(cursor, posting, "run-1", NOW)
        self.assertTrue(created)
        self.assertEqual(job_id, repository._job_id(posting))
        sql = "\n".join(query for query, _ in cursor.queries)
        self.assertIn("INSERT INTO canonical_jobs", sql)
        self.assertIn("INSERT INTO source_postings", sql)

    def test_new_requisition_id_same_source_is_not_auto_repost(self):
        cursor = FakeCursor([None, None])
        posting = self.posting(external_id="req-new")
        _, created = repository._upsert_posting(cursor, posting, "run-2", NOW)
        self.assertTrue(created)
        insert = next((params for query, params in cursor.queries if "INSERT INTO source_postings" in query), None)
        self.assertIsNotNone(insert)
        self.assertIsNone(insert[12])

    def test_ids_are_deterministic_for_same_posting(self):
        posting = self.posting()
        self.assertEqual(repository._posting_id(posting), repository._posting_id(posting))
        self.assertEqual(repository._job_id(posting), repository._job_id(posting))
        same_url_other_source = self.posting(source_id="src-b", external_id="req-b")
        same_source_new_req = self.posting(source_id="src-a", external_id="req-2")
        self.assertNotEqual(repository._job_id(posting), repository._job_id(same_url_other_source))
        self.assertNotEqual(repository._job_id(posting), repository._job_id(same_source_new_req))
        self.assertNotEqual(repository._posting_id(posting), repository._posting_id(same_url_other_source))

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

    def test_missing_external_id_reuses_unique_same_source_url_without_demotion(self):
        existing_posting = "00000000-0000-0000-0000-000000000080"
        existing_job = "00000000-0000-0000-0000-000000000081"
        cursor = FakeCursor([None, (existing_posting, existing_job)])
        posting = self.posting(source_id="src-a", external_id=None)
        posting = repository.SharedPosting(
            **{**posting.__dict__, "identity_kind": "CANONICAL_URL", "identity_value": posting.canonical_url}
        )
        job_id, created = repository._upsert_posting(cursor, posting, "run-fallback", NOW)
        self.assertFalse(created)
        self.assertEqual(job_id, existing_job)
        update_sql = next(
            query for query, _ in cursor.queries
            if "SET source_name" in query
        )
        self.assertIn("external_job_id = COALESCE", update_sql)
        self.assertFalse(any("INSERT INTO source_postings" in query for query, _ in cursor.queries))

    def test_exact_cross_source_url_reuses_canonical_job(self):
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

    def test_projection_gap_suppresses_lifecycle_for_affected_source(self):
        class Result:
            ok = True
            connector = "example"
            records = [{
                "_jscc_source_id": "src-a",
                "_jscc_source_name": "Example",
                "title": "Project Manager",
                "company": "Example",
            }]

        postings, skipped, incomplete, global_gap = repository.project_collection([Result()])
        self.assertEqual(postings, [])
        self.assertEqual(skipped, 1)
        self.assertEqual(incomplete, {"src-a"})
        self.assertFalse(global_gap)

    def test_non_mapping_projection_gap_is_global_fail_safe(self):
        class Result:
            ok = True
            connector = "example"
            records = ["not-a-record"]

        postings, skipped, incomplete, global_gap = repository.project_collection([Result()])
        self.assertEqual(postings, [])
        self.assertEqual(skipped, 1)
        self.assertEqual(incomplete, set())
        self.assertTrue(global_gap)

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

    def test_persist_collection_preserves_exact_connection_string_and_db_identity(self):
        seen = {}
        cursor = FakeCursor([("jobsearch_dev",)])

        class CursorContext:
            def __enter__(self):
                return cursor

            def __exit__(self, exc_type, exc, tb):
                return False

        class Connection:
            def cursor(self):
                return CursorContext()

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def connect(connection_string):
            seen["connection_string"] = connection_string
            return Connection()

        url = "postgresql://user:p%20x@db.example/jobsearch_dev?sslmode=require"
        result = repository.persist_collection(
            [],
            [],
            run_id="run-db",
            now=NOW,
            env={"APP_ENV": "dev", "NILE_DATABASE_URL": url},
            connect=connect,
        )
        self.assertEqual(result["status"], "persisted")
        self.assertEqual(seen["connection_string"], url)

    def test_lifecycle_sql_is_two_stage_and_sets_90_day_retention(self):
        cursor = FakeCursor()
        repository._advance_lifecycle(cursor, {"src-a"}, "run-life", NOW)
        sql = "\n".join(query for query, _ in cursor.queries)
        self.assertIn("WHEN lifecycle_status = 'ACTIVE' THEN 'UNCONFIRMED'", sql)
        self.assertIn("WHEN lifecycle_status = 'UNCONFIRMED' THEN 'INACTIVE'", sql)
        self.assertIn("interval '90 days'", sql)
        self.assertIn("seen_run_id IS DISTINCT FROM", sql)

    def test_migration_encodes_identity_lifecycle_and_retention_contracts(self):
        sql = (ROOT / "command-api/migrations/002_shared_job_corpus.sql").read_text(encoding="utf-8")
        self.assertIn("UNIQUE(source_id, identity_kind, identity_value)", sql)
        self.assertIn("'ACTIVE', 'UNCONFIRMED', 'INACTIVE'", sql)
        self.assertIn("retention_until", sql)
        self.assertIn("repost_of_posting_id", sql)
        self.assertIn("work_mode IN ('remote', 'hybrid', 'onsite', 'unknown')", sql)
        self.assertIn("identity_value = external_job_id", sql)
        self.assertIn("identity_value = canonical_url", sql)
        self.assertIn("ON DELETE RESTRICT", sql)


if __name__ == "__main__":
    unittest.main()
