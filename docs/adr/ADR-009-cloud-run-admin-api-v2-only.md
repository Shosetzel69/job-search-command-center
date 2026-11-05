# ADR-009 — Cloud Run Admin API v2 as the sole JSCC integration API

Status: ACCEPTED (owner decision, 2026-11-05)
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
- `scripts/gcp/verify_remote_executor_dev.sh` previously accepted v2 `scaling.maxInstanceCount` OR v1 `metadata.annotations` / `spec.template.metadata.annotations` for max scale. In this PR the verifier now requires the v2 field.
- Additional `gcloud` output-schema consumers identified for follow-up audit: `scripts/gcp/seed_runtime.sh`, `scripts/gcp/deploy_remote_executor_dev.sh`, `scripts/gcp/capture_live_promotion_evidence.sh`, `scripts/gcp/provision_remote_executor_dev.sh`, `scripts/gcp/promote.sh`, `scripts/gcp/execute_dev_job.sh`, `scripts/gcp/environment.sh`, `scripts/gcp/stage_531_role_family_dev_service.sh`. Not every one is independently proven to rely on a v1 schema. The independent review reports six additional v1-shaped consumers; exact lines and migration suitability require a follow-up audit.

This is a source-search inventory, **not** proof that all scripts, external deploy tools, live revisions or third-party integrations use v2. Runtime inventory and IAM validation remain separate gates.

## Enforcement and acceptance

- A repository guard rejects explicit `run.googleapis.com/v1` endpoints in JSCC-owned runtime/script sources.
- The guard runs in `cloudbuild.promotion.yaml`, `cloudbuild.service.yaml`, `cloudbuild.ops.yaml`, `cloudbuild.validation.yaml`, and a dedicated GitHub Actions workflow on every PR and push to `main`. It is runnable via `npm run check:cloud-run-api-version`. Other Cloud Build configs are not asserted to be covered.
- Automated positive and negative tests cover global/regional v1 endpoints, explicit v1 SDK selectors, and ordinary v2 calls.
- A guarded change must be reviewed for dynamic URL composition, library calls, split strings, and transitive tooling which a static literal scan cannot prove. The guard does not attempt to interpret arbitrary `gcloud` output formats.
- Acceptance for this policy slice requires ADR review, guard/test CI success, a PR-level independent review, and an explicit disposition of remaining CLI schema compatibility. Passing a source scan is not proof of fully migrated live infrastructure.
- Operational acceptance of `run.tasks.list` is **not** implied; its 403 remains a separate runtime/IAM defect until re-tested successfully.

## Consequences

One supported API contract for JSCC-owned REST/SDK integrations; simpler maintenance and clearer IAM checks. CLI output-schema compatibility is an open migration inventory, not silently certified compliant. Existing Google CLI behavior is not controlled by this contract. No automatic changes to deployed revisions, service accounts or project IAM.
