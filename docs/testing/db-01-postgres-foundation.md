# DB-01 — DEV PostgreSQL foundation runbook

Scope: #293, DEV only.

## Runtime contract

- Cloud Run Service/Job receive `NILE_DATABASE_URL` only from DEV Secret Manager.
- `APP_ENV=dev` must resolve to database `jobsearch_dev`.
- Any URL bound to `jobsearch_test`, `jobsearch_prod`, or an unknown database fails closed before a query is issued.
- Application/API modules do not receive raw PostgreSQL credentials or a generic SQL client.

## Readiness

Inside the DEV Service image:

```bash
npm --prefix command-api run db:readiness
```

Expected non-secret output:

```json
{"status":"ok","environment":"dev","database":"jobsearch_dev","server_version":"..."}
```

The command performs reads only.

## Migrations

Migrations live under `command-api/migrations` and use ordered names such as:

```text
001_schema_migrations.sql
```

Apply in DEV only:

```bash
npm --prefix command-api run db:migrate
```

The runner:
1. detects whether `schema_migrations` exists;
2. loads ordered SQL migrations;
3. computes a SHA-256 checksum for each file;
4. applies each pending migration in a transaction;
5. records version/name/checksum;
6. rejects checksum drift on already-applied versions.

The initial migration creates only the technical `schema_migrations` table. It does not migrate JSCC domain data.

### Nile DEV/TEST shared-role exception

The canonical target remains a distinct runtime DML principal and migration/DDL principal. Nile may map multiple credentials for one database to the same effective PostgreSQL role. The approved architecture permits that broad DDL authority temporarily in DEV/TEST controlled migration work, but not as a PROD Multiuser privilege-gate substitute.

For a controlled DEV/TEST migration only, the operator may bind the same environment-scoped URL to both variables and opt in explicitly:

```bash
export NILE_DATABASE_URL="..."
export NILE_MIGRATION_DATABASE_URL="$NILE_DATABASE_URL"
export JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE=true
npm --prefix command-api run db:migrate
unset JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE NILE_MIGRATION_DATABASE_URL NILE_DATABASE_URL
```

Rules:
- the override is accepted only for `APP_ENV=dev|test`;
- `prod` remains fail-closed even if the flag is present;
- the override is migration-process configuration only and must never be injected into the Cloud Run runtime;
- FORCE RLS and tenant-isolation negative tests remain mandatory;
- runtime-vs-migration privilege separation remains a hard gate before Multiuser PROD cutover.

## Rollback

DB-01 contains no domain tables or migrated records. If the foundation must be removed before later migrations depend on it:

```sql
DROP TABLE IF EXISTS schema_migrations;
```

Execute rollback only with explicit migration authority and only in DEV for this slice.

## Evidence required

- exact candidate SHA and immutable Service digest;
- unit/CI tests PASS;
- `/health/db` or `db:readiness` confirms `jobsearch_dev`;
- migration command creates version `001`;
- a second migration run applies zero migrations;
- no TEST/PROD database mutation.
