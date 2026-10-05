#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
ENVIRONMENT="${2:-}"
CANDIDATE_SHA="${3:-}"
SERVICE_DIGEST="${4:-}"
MODE="${5:-migrate}"

[[ "${ACTION}" == "deploy" || "${ACTION}" == "execute" ]] || { echo "action must be deploy or execute" >&2; exit 2; }
[[ "${MODE}" == "migrate" || "${MODE}" == "schema" || "${MODE}" == "privilege" ]] || { echo "mode must be migrate, schema or privilege" >&2; exit 2; }
[[ "${CANDIDATE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate SHA must be a full lowercase 40-character SHA" >&2; exit 2; }
[[ "${SERVICE_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "service digest must be immutable sha256" >&2; exit 2; }

source "$(dirname "$0")/environment.sh" "${ENVIRONMENT}"

migration_script="$(cat <<'EOS'
case "${DB_MIGRATION_MODE:-migrate}" in
  migrate)
    npm --prefix command-api run db:migrate
    ;;
  schema)
    npm --prefix command-api run db:readiness
    node --input-type=module <<'NODE'
import { loadMigrations } from './command-api/src/db/migrations.js';
import { closeMigrationPool, getMigrationPool } from './command-api/src/db/pool.js';

const migrations = await loadMigrations();
const db = getMigrationPool(process.env);
const required = [
  'schema_migrations','tenants','app_user','user_identity','profile','user_session',
  'profile_preferences','profile_job_state','profile_job_evaluation','applications',
  'profile_notes','profile_ui_preferences','collection_policy','system_bootstrap',
  'account_capacity_policy','account_deletion_audit','canonical_jobs','source_postings',
  'search_runs','source_run_results','scheduler_config','scheduler_state'
];
try {
  const result = await db.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
  if (result.rows.length !== migrations.length) {
    throw new Error(`schema_migrations count mismatch: expected ${migrations.length}, got ${result.rows.length}`);
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const expected = migrations[index];
    const actual = result.rows[index];
    if (String(actual.version) !== expected.version || actual.name !== expected.name || actual.checksum !== expected.checksum) {
      throw new Error(`schema migration mismatch at ${expected.name}`);
    }
  }
  const missing = [];
  for (const name of required) {
    const relation = await db.query('SELECT to_regclass($1) AS relation', [`public.${name}`]);
    if (!relation.rows?.[0]?.relation) missing.push(name);
  }
  if (missing.length) throw new Error(`required schema objects missing: ${missing.join(' ')}`);
  process.stdout.write(JSON.stringify({
    status:'ok',
    current:migrations.at(-1).version,
    migrations:migrations.length,
    required_tables:required.length,
  }) + '\n');
} finally {
  await closeMigrationPool();
}
NODE
    ;;
  privilege)
    npm --prefix command-api run db:privilege-readiness
    ;;
  *)
    echo "Unsupported DB_MIGRATION_MODE" >&2
    exit 2
    ;;
esac
EOS
)"
payload="$(printf '%s' "${migration_script}" | base64 | tr -d '\n')"

if [[ "${ACTION}" == "deploy" ]]; then
  gcloud run jobs deploy "${MIGRATION_JOB_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${SERVICE_IMAGE_REPO}@${SERVICE_DIGEST}" \
    --service-account="${RUNTIME_SA}" \
    --tasks=1 \
    --parallelism=1 \
    --max-retries=0 \
    --task-timeout=10m \
    --set-env-vars="APP_ENV=${ENVIRONMENT},SOURCE_SHA=${CANDIDATE_SHA},JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE=true,DB_MIGRATION_MODE=migrate" \
    --set-secrets="NILE_DATABASE_URL=NILE_DATABASE_URL:latest,NILE_MIGRATION_DATABASE_URL=NILE_DATABASE_URL:latest" \
    --command="/bin/bash" \
    --args="-ceu,echo ${payload} | base64 -d | bash"
else
  gcloud run jobs execute "${MIGRATION_JOB_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --update-env-vars="DB_MIGRATION_MODE=${MODE}" \
    --wait
fi
