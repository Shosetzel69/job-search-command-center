import { readFileSync } from 'node:fs';

const deploy = readFileSync('scripts/gcp/deploy_dev_job.sh', 'utf8');
const execute = readFileSync('scripts/gcp/execute_dev_job.sh', 'utf8');

function must(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

must(deploy, /PROJECT_ID="jscc-dev"/, 'DEV deploy must target jscc-dev only');
must(deploy, /REGION="europe-west1"/, 'DEV deploy must use europe-west1');
must(deploy, /jscc-dev-runtime@jscc-dev\.iam\.gserviceaccount\.com/, 'DEV runtime identity must be explicit');
must(deploy, /jscc\/jscc@\$\{IMAGE_DIGEST\}/, 'DEV deploy must use immutable digest reference');
must(deploy, /--cpu=2/, 'Cloud Run Job must use 2 vCPU');
must(deploy, /--memory=4Gi/, 'Cloud Run Job must use 4 GiB');
must(deploy, /--tasks=1/, 'Cloud Run Job must use one task');
must(deploy, /--parallelism=1/, 'Cloud Run Job must use parallelism 1');
must(deploy, /--max-retries=1/, 'Cloud Run Job must use max retries 1');
must(deploy, /--task-timeout=45m/, 'Cloud Run Job must use 45 minute timeout');
must(deploy, /roles\/storage\.objectUser/, 'DEV runtime identity needs bucket object read-write only');
must(deploy, /matchesPrefix.*runs\//s, 'Lifecycle must target transient runs only');
must(deploy, /NILE_DATABASE_URL=NILE_DATABASE_URL:latest/, 'Secrets must be injected from Secret Manager');
must(deploy, /JSCC_RUNTIME_DATA_DIR/, 'Runtime-data root must be explicit');
must(deploy, /runs\/.*CLOUD_RUN_EXECUTION/s, 'Each execution must write below runs/{run_id}');
must(deploy, /--validate-only/, 'Initial DEV execution must be targeted validation only');

for (const forbidden of [/jscc-test/, /jscc-prod/, /gcloud\s+run\s+deploy\s+/i, /scheduler/i]) {
  if (forbidden.test(deploy)) throw new Error('DEV job contract must not mutate TEST/PROD or deploy a service/scheduler');
}

must(execute, /ACTIVE_RUN_REJECTED/, 'Manual execution wrapper must reject overlap');
must(execute, /gcloud run jobs executions list/, 'Manual execution wrapper must inspect active executions');
must(execute, /gcloud run jobs execute/, 'Manual execution wrapper must execute only the DEV job');

console.log('GCP DEV runtime contract validation: PASS');
