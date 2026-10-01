#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${BACKUP_SHA256_FILE:?BACKUP_SHA256_FILE is required}"

case "$RESTORE_DATABASE_URL" in
  */jobsearch_prod|*/jobsearch_prod\?*)
    echo "Refusing restore into PROD" >&2
    exit 2
    ;;
esac

sha256sum --check "$BACKUP_SHA256_FILE"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
SELECT json_build_object(
  'database', current_database(),
  'app_user', COALESCE((SELECT count(*) FROM app_user),0),
  'canonical_jobs', COALESCE((SELECT count(*) FROM canonical_jobs),0),
  'source_postings', COALESCE((SELECT count(*) FROM source_postings),0),
  'applications', COALESCE((SELECT count(*) FROM applications),0),
  'schema_migrations', COALESCE((SELECT count(*) FROM schema_migrations),0)
)::text;
"
