#!/usr/bin/env bash
set -euo pipefail

: "${NILE_PROD_DATABASE_URL:?NILE_PROD_DATABASE_URL is required}"
: "${BACKUP_DIR:=/tmp/jscc-backup}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/jscc-prod-$stamp.dump"
checksum="$dump.sha256"

case "$NILE_PROD_DATABASE_URL" in
  */jobsearch_prod|*/jobsearch_prod\?*) ;;
  *) echo "Refusing backup: source is not jobsearch_prod" >&2; exit 2 ;;
esac

pg_dump --format=custom --no-owner --no-acl --file="$dump" "$NILE_PROD_DATABASE_URL"
sha256sum "$dump" > "$checksum"

if [[ -n "${R2_BACKUP_UPLOAD_URL:-}" ]]; then
  curl --fail --silent --show-error --upload-file "$dump" "$R2_BACKUP_UPLOAD_URL"
fi
if [[ -n "${R2_CHECKSUM_UPLOAD_URL:-}" ]]; then
  curl --fail --silent --show-error --upload-file "$checksum" "$R2_CHECKSUM_UPLOAD_URL"
fi

printf '{"dump":"%s","checksum":"%s"}\n' "$dump" "$checksum"
