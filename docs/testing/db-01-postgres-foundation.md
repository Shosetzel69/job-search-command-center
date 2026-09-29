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
