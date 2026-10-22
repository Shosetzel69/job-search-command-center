import { readFileSync } from 'node:fs';

// DEV-01B: local guardrail checks; CI is still BLOCKED pending #539 CI-only.
const legacy = readFileSync('scripts/gcp/deploy_dev_job.sh', 'utf8');
const promote = readFileSync('scripts/gcp/promote.sh', 'utf8');
const build = readFileSync('cloudbuild.promotion.yaml', 'utf8');
const dbMigrate = readFileSync('command-api/scripts/db-migrate.mjs', 'utf8');
const migrate = readFileSync('scripts/gcp/run_db_migration.sh', 'utf8');
const execute = readFileSync('scripts/gcp/execute_dev_job.sh', 'utf8');
const runtime = readFileSync('command-api/src/runtime-gcp.js', 'utf8');
const environment = readFileSync('scripts/gcp/environment.sh', 'utf8');

function must(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

must(legacy, /DEPRECATED/, 'DEV legacy wrapper must remain deprecated');
must(legacy, /promote\.sh/, 'DEV legacy wrapper must delegate to frozen promotion');
must(promote, /JSCC541_DEV01B_LEGACY_PROMOTION_BLOCKED/, 'Legacy promotion must be frozen');
if (promote.indexOf('JSCC541_DEV01B_LEGACY_PROMOTION_BLOCKED') > promote.indexOf('ENVIRONMENT=')) {
  throw new Error('Legacy promotion must stop before any provider calls');
}
must(build, /JSCC541_DEV01B_PROMOTION_PIPELINE_BLOCKED_BEFORE_BUILD/, 'Legacy Cloud Build promotion must stop in first step');
if (build.indexOf('JSCC541_DEV01B_PROMOTION_PIPELINE_BLOCKED_BEFORE_BUILD') > build.indexOf('- id: build-job-if-missing')) throw new Error('Cloud Build guard must run before image publication');
if (!/exit 86/.test(build.split('[[ "${_GIT_SHA}"')[0])) throw new Error('Cloud Build guard must actually exit');
must(dbMigrate, /process\.exit\(86\)/, 'db:migrate entrypoint must refuse before module initialization');
if (/^import\s/m.test(dbMigrate)) throw new Error('Eager database imports are forbidden');
// Retain the original DEV runtime deployment invariants against the CURRENT
// promotion script, not the retired deploy_dev_job.sh wrapper.
must(environment, /export PROJECT_ID="jscc-\$\{env_name\}"/, 'Environment must stay project-scoped');
must(environment, /export REGION="europe-west1"/, 'Region must remain europe-west1');
must(environment, /jscc-\$\{env_name\}-runtime@jscc-\$\{env_name\}\.iam\.gserviceaccount\.com/, 'Runtime identity must remain environment-local');
must(promote, /--image="\$\{JOB_IMAGE_REPO\}@\$\{job_digest\}"/, 'Search image must use resolved immutable digest');
must(promote, /--service-account="\$\{RUNTIME_SA\}"/, 'Search must run under environment-specific runtime identity');
for (const [flag, purpose] of [
  ['--cpu=2', 'CPU limit'], ['--memory=4Gi', 'Memory limit'],
  ['--tasks=1', 'One job task'], ['--parallelism=1', 'Single parallel task'],
  ['--max-retries=1', 'Retry bound'], ['--task-timeout=45m', 'Task timeout'],
  ['--add-volume=', 'Runtime storage mount'],
  ['JSCC_RUNTIME_DATA_DIR', 'Run data root'],
  ['CLOUD_RUN_EXECUTION', 'Per-execution isolation'],
  ['--validate-only', 'Initial job non-mutation mode'],
]) {
  if (!promote.includes(flag)) throw new Error(`Legacy job runtime contract lost ${purpose}: ${flag}`);
}
must(promote, /NILE_DATABASE_URL=NILE_DATABASE_URL:1/, 'Service/Search secret must pin existing v1');
if (/NILE_DATABASE_URL:latest/.test(promote)) throw new Error('Legacy promotion cannot restore Nile latest');
must(migrate, /DB_MIGRATION_MODE=refuse/, 'Migration Job must default to refuse');
must(migrate, /NILE_MIGRATION_DATABASE_URL=NILE_DATABASE_URL:1/, 'Migration secret must pin existing v1');
if (/npm --prefix command-api run db:migrate/.test(migrate)) throw new Error('Shell migration mode must not invoke db:migrate');
must(execute, /PROJECT_ID="jscc-dev"/, 'Manual Search job must target DEV');
must(execute, /ACTIVE_RUN_REJECTED/, 'Manual Search run must reject overlap');
must(execute, /--if-generation-match=0/, 'Manual Search must use atomic lock');
must(execute, /heavy-search\.lock/, 'Manual Search must use runtime lock');
must(execute, /gcloud run jobs execute/, 'Manual Search dispatch must remain supported');
must(runtime, /fullRunArgs\(\)/, 'Legitimate Search args must remain present');
for (const name of ['RUN_TRIGGER', 'SOURCE_SHA', 'GCP_RUNTIME_BUCKET', 'GCP_CURRENT_GENERATION', 'JSCC_RUN_ID', 'JSCC_REQUEST_SIGNATURE', 'JSCC_RETRIEVE_SCOPE_JSON']) {
  if (!runtime.includes(`name:'${name}'`)) throw new Error(`Missing Search override ${name}`);
}
console.log('DEV-01B local source guardrail: PASS; protected CI and runtime IAM not attested');
