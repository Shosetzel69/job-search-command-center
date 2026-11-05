# ADR-009 — Cloud Run Admin API v2 as the sole JSCC integration API

Status: PROPOSED implementation / owner-approved direction (2026-11-05); pending independent review and merge
Applies to: AGENTFLOW; DEV, TEST and PROD
Builds on: ADR-003, ADR-006
Scope: JSCC-owned programmatic Cloud Run Admin API integrations

## Context

Cloud Run exposes both Knative-compatible v1 and Google Cloud-native v2 interfaces. Multiple routes for equivalent operations increase the maintenance and IAM diagnostic surface. On 2026-11-05, JSCC DEV diagnostics encountered `run.tasks.list` HTTP 403 both through a `gcloud` command that referenced the v1 namespace and through a direct v2 Execution/tasks request. IAM Policy Troubleshooter reported CAN_ACCESS for the Execution and CANNOT_ACCESS at project level. These facts do **not** establish that API version alone caused the authorization failure.

## Decision

1. New JSCC-owned code calling Cloud Run Admin API MUST use `https://run.googleapis.com/v2/` and the documented v2 resource hierarchy.
2. No JSCC-owned parallel v1/v2 Cloud Run REST/SDK implementation or silent fallback to v1 is permitted. Compatibility parsing of outputs from Google-managed `gcloud` is legacy technical debt and must be inventoried and retired separately, not confused with application REST calls.
3. Existing JSCC-owned v1 integrations must be inventoried, migrated with tests, and removed. Any necessary exception requires a separately approved ADR with scope, owner, expiry and retirement criterion.
4. DEV, TEST and PROD share the same integration contract. No permission expansion or deployment is implied by this ADR.
5. Google-managed clients and `gcloud` internals are outside JSCC source-code control; a `gcloud` invocation is not evidence of a JSCC v1 integration.
6. IAM must be verified against the effective API/resource hierarchy. Least privilege and resource-scoped access remain preferred; broaden IAM only through an explicit operational change.

## Repository inventory at decision time

Source-code search on default branch (2026-11-05):
- `ops/src/worker.mjs`: explicit v2 Execution read and tasks listing.
- `ops/src/gateway.mjs`: explicit v2 Job execution.
- `command-api/src/runtime-gcp.js`: `RUN_API = 'https://run.googleapis.com/v2'`.
- No literal `run.googleapis.com/v1` match found by repository code search; this did NOT cover regional URLs, SDK version selectors or CLI output schemas.
- `scripts/gcp/verify_remote_executor_dev.sh` previously accepted v2 `scaling.maxInstanceCount` OR v1/Knative annotations. R3/R4 verifies the v2 REST Service `scaling.maxInstanceCount` instead, with fixture tests. Read-only DEV evidence on 2026-11-06: `scaling.maxInstanceCount=1`, while `template.scaling.maxInstanceCount=3`; this policy checks the service-level gateway cap only.
- Confirmed v1-shaped `gcloud` CLI schema consumers from independent review: `scripts/gcp/promote.sh` (L169-174); `scripts/gcp/capture_live_promotion_evidence.sh` (L63-67); `scripts/gcp/rollout_workspace_manager_cap100_dev.sh` (L32-34); `scripts/gcp/stage_531_role_family_dev_service.sh` (L26, L59); `scripts/gcp/bootstrap_remote_executor_dev.sh` (L128); `scripts/gcp/verify_remote_executor_dev.sh` (L11, L163-166 before R3). Other candidates that require inspection include `seed_runtime.sh`, `deploy_remote_executor_dev.sh`, `provision_remote_executor_dev.sh`, `execute_dev_job.sh`, and `environment.sh`. These are CLI output contracts, not identified REST v1 endpoints. Full audit, migration, owner and retirement criterion: issue #604 (operational owner: JSCC repository owner; target: close by 2026-11-30 after exact-file and fixture verification, or request a dated exception).

This is a source-search inventory, **not** proof that all scripts, external deploy tools, live revisions or third-party integrations use v2. Runtime inventory and IAM validation remain separate gates.

## Enforcement and acceptance

- A repository guard rejects recognizable global/regional v1 endpoints (including Knative serving paths), alpha/beta variants and selected `googleapis`/Python discovery SDK selectors in JSCC-owned runtime/script sources. It scans all `scripts/`; only the dedicated fixture test is explicitly excluded.
- The guard runs in `cloudbuild.promotion.yaml`, `cloudbuild.service.yaml`, `cloudbuild.ops.yaml`, `cloudbuild.validation.yaml`, and a dedicated GitHub Actions workflow on every PR and push to `main`. It is runnable via `npm run check:cloud-run-api-version`. Other Cloud Build configs are not asserted to be covered.
- Automated positive and negative tests cover regional and Knative v1 endpoints, selected SDK calls, beta/alpha paths, false positives such as v10, full `scripts/` scan root, and normal v2 calls. Fixture tests also assert the v2 REST gateway service-level scaling schema.
- A guarded change must be reviewed for dynamic URL composition, other library calls, split strings, files outside selected roots, symlinks, and transitive tooling which a static literal scan cannot prove. The guard does not interpret arbitrary `gcloud` output formats.
- Acceptance for this policy slice requires ADR review, guard/test CI success, an exact-SHA independent review, read-only DEV v2 service scaling evidence, and an explicit disposition of remaining CLI schema compatibility via #604. Passing a source scan is not proof of fully migrated live infrastructure.
- Operational acceptance of `run.tasks.list` is **not** implied; its 403 remains a separate runtime/IAM defect until re-tested successfully.

## Consequences

One supported API contract for JSCC-owned REST/SDK integrations; simpler maintenance and clearer IAM checks. CLI output-schema compatibility is an open migration inventory, not silently certified compliant. Existing Google CLI behavior is not controlled by this contract. No automatic changes to deployed revisions, service accounts or project IAM.
