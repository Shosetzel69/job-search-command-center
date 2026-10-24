# JSCC DEV executor — pre-deployment gates (not a deployment approval)

The new runner build context is `ops/dev-executor/`, with `Dockerfile` and `runner/` inside. Build from repository root using `docker build -f ops/dev-executor/Dockerfile ops/dev-executor` **only in an authorized isolated environment**.

## Current status
- OAuth-bound gateway handler source staged in `ops/src/gateway.mjs`, disabled by `JSCC_DEV_EXECUTOR_API_ENABLED` default.
- Four new gateway modules staged in `ops/src/executor/`.
- Isolated runner staged in `ops/dev-executor/`; no Cloud Run Job has been provisioned.
- R12 source tests are historical offline results; do not treat them as tests of this integrated tree.
- **BLOCKED**: `ops/package-lock.json` is missing on target `main`. The runner deliberately refuses to execute npm tests until a verified lockfile is present.
- **BLOCKED**: image base tag and APT dependency versions are not pinned. No digest-reproducible release build.
- **BLOCKED**: privileged authorization and ATC provenance require independent security review before enabling any action.
- **BLOCKED**: exact GCP inventory, scoped IAM, dedicated bucket/prefix policy, Secret Manager bindings and rollout/rollback checks not verified.
- No GitHub merge, IAM mutation or GCloud deployment has been authorized by this source integration.

## Read-only checks in Cloud Shell
```bash
gcloud config get-value project
gcloud run services describe jscc-ops-gateway-dev --project=jscc-dev --region=europe-west1 --format='value(status.latestReadyRevisionName)'
gcloud run jobs describe jscc-dev-executor --project=jscc-dev --region=europe-west1 --format='value(metadata.name)' || true
gh api repos/Shosetzel69/job-search-command-center/contents/ops/package-lock.json -H 'Accept: application/vnd.github+json' >/dev/null && echo LOCK_PRESENT || echo LOCK_MISSING
```

## Release order
1. Fix runner supply-chain reproducibility; review and merge lockfile as a separate scoped code change, only with authorization.
2. Test integrated gateway + runner in isolated CI; commission independent source/security review.
3. Inventory cloud resources read-only. Present minimum IAM and secrets changes for explicit approval.
4. Build/push image, create locked-down job, deploy disabled gateway revision; perform negative smoke tests.
5. Enable limited verify, then per-action staged E2E; enable publish/merge/deploy only with separate approvals.
