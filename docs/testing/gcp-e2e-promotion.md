# GCP end-to-end promotion procedure

Status: canonical replacement for the manual GCP migration choreography used during #425/#440.

## 1. Why this procedure exists

Manual DEV/TEST migration exposed repeated release-safety defects: operator choreography, implicit project context, artifact/runtime parity gaps, omitted IAM/data-path settings and, in #483, a false SUCCESS where TEST had no database schema although `/health/db` passed. Deployment PASS and functional DEV/TEST PASS are separate gates.

The consolidated incident history and the permanent control for each failure class are maintained in `docs/testing/gcp-migration-lessons-learned.md`.

## 2. Canonical model

One immutable candidate SHA is the only release identity.

```
candidate SHA
  -> tests
  -> build Job image once (or reuse exact existing artifact)
  -> build Service image once (or reuse exact existing artifact)
  -> resolve immutable digests
  -> DEV seed verification
  -> DEV DB migration Job from exact Service digest
  -> candidate migration + schema/checksum readiness
  -> DEV Job + Service deploy by digest
  -> DEV /health + /health/db
  -> DEV evidence
  -> TEST seed verification
  -> TEST DB migration Job from exact Service digest
  -> candidate migration + schema/checksum readiness
  -> TEST Job + Service deploy using the SAME digests
  -> TEST /health + /health/db
  -> TEST evidence
```

No rebuild occurs between DEV and TEST.

Standalone TEST promotion is also supported for a candidate already deployed in DEV. In that path DEV is not redeployed: Cloud Build performs a read-only live attestation of the DEV Job, Service, health endpoints, database binding and runtime seed, writes DEV evidence for the exact candidate SHA, then promotes TEST using the same immutable image digests.

## 3. Canonical entry point

`cloudbuild.promotion.yaml`

Inputs:
- `_GIT_SHA`: exact 40-character lowercase candidate SHA.
- `_TARGET`: `dev`, `test` or `dev-test`.

Targets:

```text
_TARGET=dev       -> deploy DEV only
_TARGET=test      -> attest current DEV read-only for exact SHA -> deploy TEST only
_TARGET=dev-test  -> deploy DEV -> deploy TEST in the same build
```

For `_TARGET=test`, the Cloud Build control-plane source revision and release candidate are intentionally separate identities. The build may execute from a newer approved pipeline SHA while `_GIT_SHA` remains the frozen candidate already validated in DEV. In this mode the pipeline must not build missing candidate artifacts; both immutable candidate images must already exist. A mismatch between live DEV and `_GIT_SHA` fails closed before any TEST mutation.

For `dev` and `dev-test`, the original invariant remains: Cloud Build `COMMIT_SHA == _GIT_SHA`.

Standalone TEST invocation therefore carries two explicit identities:

```bash
PIPELINE_SHA=<approved SHA containing the TEST-only orchestration>
CANDIDATE_SHA=<exact candidate already validated in DEV>

gcloud builds triggers run jscc-command-api-promote \
  --project=jscc-shared \
  --region=europe-west1 \
  --sha="${PIPELINE_SHA}" \
  --substitutions=_GIT_SHA="${CANDIDATE_SHA}",_TARGET=test
```

The Cloud Build execution is the operator. Individual gcloud commands are not part of the normal release procedure.

## 4. Environment mapping

Resolved only by `scripts/gcp/environment.sh`:

| Environment | Project | Job | Service | Search mode | Database |
| --- | --- | --- | --- | --- | --- |
| DEV | jscc-dev | jscc-search-dev | jscc-command-api-dev | disabled | jobsearch_dev |
| TEST | jscc-test | jscc-search-test | jscc-command-api-test | smoke | jobsearch_test |

No PROD path exists in this implementation.

Every project-dependent gcloud command includes explicit `--project`.

## 5. Runtime seed contract

Canonical manifest:

`scripts/gcp/runtime_seed_files.txt`

Required:
- applications.json
- jobs.json
- run-history.json
- run-status.json
- search-config.json
- search-state.json

`seed_runtime.sh` can create a bucket during one-time infrastructure bootstrap, but normal promotion requires the environment runtime bucket to exist before the live promotion checklist is published.

During normal promotion it:
- uploads only missing seed objects;
- never overwrites existing environment runtime state during a normal promotion;
- verifies every mandatory seed object after provisioning.

Standalone `_TARGET=test` does not seed from the control-plane checkout. It uses `verify_runtime_seed.sh` to require the existing TEST runtime bucket and mandatory seed objects read-only before deployment.

Candidate-managed assets remain in the immutable image:
- sources.json
- source-categories.json
- nomenclatures.json

## 6. Promotion evidence

Each environment produces:

`artifacts/gcp-promotion/<environment>-<candidate-sha>.json`

Evidence includes:
- environment;
- candidate SHA;
- Job digest;
- Service digest;
- Service revision;
- Service URL;
- expected DB;
- health PASS;
- DB health PASS;
- DB migrations PASS;
- DB schema readiness PASS;
- seed manifest PASS.

TEST promotion fails unless DEV evidence exists and verifies the exact same candidate SHA **and the exact same Job/Service image digests** that TEST is about to deploy.

For `_TARGET=dev-test`, DEV evidence is produced by the DEV promotion earlier in the same build. For `_TARGET=test`, `scripts/gcp/capture_live_promotion_evidence.sh` creates equivalent evidence from read-only checks against the already deployed DEV environment; it does not deploy, update IAM, create buckets or write runtime seed objects. TEST itself uses verify-only seed mode so no candidate-adjacent data is synthesized from a newer control-plane checkout.

## 7. One-time control-plane prerequisites

These are environment prerequisites, not per-release operator steps:

- The environment runtime bucket already exists; bucket creation is infrastructure bootstrap, not release promotion.
- Cloud Build can read/write shared Artifact Registry, deploy DEV/TEST Cloud Run resources, act as the runtime service accounts, access runtime buckets and read Secret Manager metadata.
- Each environment contains enabled `NILE_DATABASE_URL`, `ALLOWED_GOOGLE_SUB` and `GOOGLE_CLIENT_ID` secrets.
- Runtime service accounts can read their runtime bucket and required secrets.
- OAuth authorizes the canonical environment Cloud Run origin.
- The Service runtime identity has `roles/run.jobsExecutorWithOverrides` on its search Job; promotion reconciles this binding.
- Every Service deploy sets the canonical data paths for search config, sources, source categories, nomenclatures and applications.
- No cross-environment fallback is permitted.

## 8. Gates

Promotion fails immediately if:
- candidate SHA is not exact;
- immutable Job or Service image cannot be resolved/built for DEV or DEV-TEST;
- standalone TEST is requested and either immutable candidate image is missing;
- a mandatory runtime seed is missing after provisioning;
- a required environment secret is missing;
- the environment runtime service account does not have the verified override-capable Job execution binding;
- any canonical Command API data-path variable is missing from the Service runtime contract;
- Service does not route 100% to the new revision;
- Service URL differs from canonical run.app origin;
- /health does not report the exact candidate;
- /health runtime backend is not GCP;
- /health/db does not bind to the correct environment/database;
- the environment DB migration Job fails;
- applied migration version/name/checksum does not equal the candidate manifest;
- a required schema relation is missing;
- runtime DB privilege readiness fails;
- TEST evidence does not match the DEV candidate;
- standalone TEST is requested while live DEV is not already on the exact candidate SHA or its deployed Job/Service images do not match the immutable candidate digests.

## 9. Browser acceptance

Infrastructure promotion is non-interactive.

Google end-user login is an external interactive identity flow. Its configuration is verified structurally by `auth_configured=true` and the environment-specific OAuth origin. A release that changes authentication/UI behavior still requires a separately recorded browser acceptance test; ordinary backend/source changes do not require the owner to repeat deployment commands.

## 10. Deprecated manual commands

Do not use as normal procedure:
- manual `jscc-gcp01-build` + `jscc-gcp05-service-build` sequencing;
- manual digest resolution;
- manual `gcloud run jobs update`;
- manual `gcloud run services update`;
- historical hard-coded `deploy_dev_job.sh` behavior.

`deploy_dev_job.sh` now only delegates to the generic promotion orchestrator.


The exact machine-executed component checklist is `docs/testing/gcp-promotion-checklist.md`. Consolidated migration lessons and permanent controls are in `docs/testing/gcp-migration-lessons-learned.md`.
