# GCP DEV/TEST promotion checklist

Status: CURRENT  
Applies to: DEV / TEST Command API  
Authority: `cloudbuild.promotion.yaml`  
Tracker: #483

This is the canonical component checklist for a GCP promotion. The runtime copy is machine-maintained in `seed/promotion-status.json` and is shown to ADMIN in the JSCC UI. A box is considered complete only after the corresponding automated command/check has passed.

## Common promotion

- [ ] Promotion operation initialized with immutable candidate SHA.
- [ ] Control-plane SHA recorded.
- [ ] Candidate source identity validated.
- [ ] Immutable search Job image resolved or built according to target mode.
- [ ] Immutable Service image resolved or built according to target mode.
- [ ] Job and Service digests recorded.
- [ ] Environment/project mapping resolved explicitly.
- [ ] Environment runtime bucket already exists.
- [ ] Live promotion checklist published before the first target mutation.
- [ ] Runtime seed provisioned/verified according to target mode.
- [ ] Required Secret Manager secrets exist and have an ENABLED version.
- [ ] Environment-scoped DB migration Job deployed from the exact candidate Service digest.
- [ ] Candidate DB migrations executed transactionally.
- [ ] `schema_migrations` versions, names and checksums equal the candidate manifest.
- [ ] Required schema objects exist.
- [ ] Runtime DB readiness/privilege checks PASS.
- [ ] Application search Job deployed from the exact candidate Job digest.
- [ ] Service -> Job override IAM reconciled and verified.
- [ ] Command API Service deployed from the exact candidate Service digest.
- [ ] Latest Service revision receives 100% traffic.
- [ ] `/health` reports the exact candidate/environment/runtime backend.
- [ ] `/health/db` reports the expected environment database.
- [ ] Authentication structural readiness PASS.
- [ ] Promotion evidence written.
- [ ] Runtime checklist reaches terminal PASS with no pending/failed steps.

## Standalone TEST additions

Before any TEST application mutation:

- [ ] Current DEV deployment is attested read-only.
- [ ] DEV source/runtime SHA equals the requested candidate SHA.
- [ ] DEV Job and Service digests equal the immutable candidate digests.
- [ ] TEST reuses existing candidate artifacts; missing artifacts fail closed.
- [ ] TEST runtime seed is verify-only.
- [ ] DEV is not redeployed or otherwise mutated.

## DEV -> TEST chained promotion

- [ ] DEV checklist reaches PASS.
- [ ] DEV evidence is the input to TEST.
- [ ] TEST uses exactly the same immutable Job and Service digests.
- [ ] TEST executes its own DB migrations against `jobsearch_test`.
- [ ] TEST checklist reaches PASS independently.

## Failure semantics

- The first failing step is persisted as `FAIL` with a sanitized error.
- A promotion with any PENDING/IN_PROGRESS/FAIL step cannot be marked PASS.
- DB migration/schema failure stops before application Service deployment.
- Deployment/infrastructure PASS is not equivalent to `DEV_PASS` or `TEST_PASS`; functional acceptance remains governed by `docs/software-delivery-lifecycle.md`.
- No cross-environment data copy is performed.
- PROD remains unavailable/fail-closed until separately approved.

## Runtime status contract

`promotion-status.json` contains:

- `schema_version`, `environment`, `operation_id`, `operation_type`;
- `pipeline_sha`, `candidate_sha`, immutable image digests;
- operation timestamps and terminal status;
- `current_step`;
- ordered `steps[]` with stable id, component, state, timestamps and sanitized error.

Allowed operation states: `IN_PROGRESS | PASS | FAIL`.  
Allowed step states: `PENDING | IN_PROGRESS | PASS | FAIL | SKIPPED | N/A`.

The artifact contains no DB URL, token, password or secret value.
