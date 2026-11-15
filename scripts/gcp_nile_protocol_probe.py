#!/usr/bin/env python3
"""Isolated Nile CI and read-only managed DEV protocol regression probe.

Default mode never writes. --ci-native-write is restricted to the existing
ephemeral GitHub Nile instance; it exercises the real repository entrypoints.
No credentials, SQL values, or connection strings are printed.
"""
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

import psycopg
import shared_corpus_repository as repository


def run():
    env = dict(os.environ)
    assert env.get("APP_ENV") == "dev"
    env["JSCC_RUNTIME_MODE"] = "container"
    expected, dsn, connect = repository._db_connect(env)
    assert expected == "jobsearch_dev"
    ci_write = sys.argv[1:] == ["--ci-native-write"]
    if sys.argv[1:] and not ci_write:
        raise RuntimeError("Unknown probe option")
    if ci_write:
        parsed = urlsplit(dsn)
        assert os.environ.get("GITHUB_ACTIONS") == "true"
        assert os.environ.get("W025_NILE_CONTAINER_ID")
        assert parsed.hostname == "127.0.0.1" and parsed.port == 55432
        assert dsn == env.get("NILE_TEST_DATABASE_URL")
    now = datetime.now(timezone.utc)
    key = "a" * 64
    scope = {"scopes": [{"scope_key": key, "role_family": "PROJECT_DELIVERY_MANAGEMENT",
                         "role_subfamilies": ["project_management"]}]}
    # Regression: live traces crashed at both parameterized SELECT and
    # Coverage's ANY(text[]) query. Check round-trip text escaping as well.
    value = "O'Reilly; SELECT 999; -- \\ snow 雪"
    with connect(dsn) as c:
        c.read_only = True
        with c.cursor() as cur:
            assert isinstance(cur, psycopg.ClientCursor)
            assert cur.execute("SELECT current_database()").fetchone()[0] == expected
            row = cur.execute("SELECT %s::text, %s::timestamptz, %s::jsonb, %s::text[]",
                              (value, now, json.dumps(scope), [key, value])).fetchone()
            assert row[0] == value and row[1] == now and row[2] == scope
            assert row[3] == [key, value]
            result = repository._coverage_snapshot(cur, scope, now)
            assert len(result) == 1 and result[0]["scope_key"] == key
            print("DEV_NILE_CLIENT_BINDING_READONLY=PASS", flush=True)
        c.rollback()
    if not ci_write:
        return
    run_id = "run-" + str(uuid.uuid4())
    assert repository.persist_run_started(run_id, now, {"retrieve_scope": scope}, env=env)["status"] == "persisted"
    status = {"run_id": run_id, "status": "failed", "started_at": now.isoformat(),
              "completed_at": now.isoformat(), "retrieve_scope": scope,
              "records_inspected": 0, "jobs_published": 0, "excluded": 0,
              "source_results": []}
    result = repository.persist_operational_run(status, env=env)
    assert result["status"] == "persisted" and result["coverage_updated"] == 0
    assert len(result["coverage_before"]) == len(result["coverage_after"]) == 1
    assert repository.persist_collection([], [], run_id=run_id, now=now, env=env)["status"] == "persisted"
    with connect(dsn) as c:
        c.read_only = True
        with c.cursor() as cur:
            row = cur.execute("SELECT status,payload FROM search_runs WHERE run_id=%s", (run_id,)).fetchone()
            assert row[0] == "failed" and row[1]["run_id"] == run_id
        c.rollback()
    print("DEV_NILE_CLIENT_BINDING_REPOSITORY=PASS", flush=True)


if __name__ == "__main__":
    run()
