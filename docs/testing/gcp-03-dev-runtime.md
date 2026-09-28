# GCP-03 DEV runtime implementation note

Issue: #429

## Implemented boundary

The DEV Cloud Run Job is deployable from the immutable #424 artifact only:

- Git SHA: `4a8671f60b263a062002e9b3b619170dcc6644cc`
- digest: `sha256:69a486fe75cf082715023e03aa9725358d67b5efb3cc5b8d2e7200c26f96292f`
- project: `jscc-dev`
- region: `europe-west1`
- runtime identity: `jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com`

The runtime bucket is environment-owned and derived from the DEV project number. Only `runs/` objects are lifecycle-deleted after 30 days. Seed inputs live outside `runs/` and are not covered by the transient-run lifecycle rule.

Each Cloud Run execution derives its runtime root from `CLOUD_RUN_EXECUTION` and writes only below `runs/{execution}/`. The image is not rebuilt.

## Cloud Run Service status

The #424 image is a terminating job process and does not contain a Cloud Run HTTP adapter. Deploying it as a Service would violate the contract rather than prove readiness. The Service sub-scope is explicitly blocked pending a bounded HTTP/auth adapter contract.

## One-active-run status

Cloud Run `parallelism=1` limits tasks inside one execution; it does not prevent multiple job executions from overlapping. The checked-in manual execution wrapper acquires `locks/heavy-search.lock` with Cloud Storage `if-generation-match=0` before execution. Concurrent acquisition therefore fails atomically, so a second manual DEV run is rejected before Cloud Run execution starts. The lock is removed after the synchronous execution returns; an interrupted operator session leaves a stale lock fail-closed and requires explicit cleanup after verifying no execution is active.

Before automated/scheduled invocation is authorized, admission must be enforced server-side through the future authenticated command/API boundary with an atomic environment-local lock. Cloud Scheduler remains out of scope.

## Commands

Static validation:

```bash
node scripts/test_gcp_dev_runtime_contract.mjs
```

DEV deploy:

```bash
bash scripts/gcp/deploy_dev_job.sh
```

Manual targeted execution:

```bash
bash scripts/gcp/execute_dev_job.sh
```
