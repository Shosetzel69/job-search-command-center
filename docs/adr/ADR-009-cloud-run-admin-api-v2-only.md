# ADR-009 — Cloud Run Admin API v2 as the sole JSCC integration API

Status: ACCEPTED (owner decision, 2026-11-05)
Applies to: AGENTFLOW; DEV, TEST and PROD
Builds on: ADR-003, ADR-006
Scope: JSCC-owned programmatic Cloud Run Admin API integrations

## Context

Cloud Run exposes both Knative-compatible v1 and Google Cloud-native v2 interfaces. Multiple routes for equivalent operations increase the maintenance and IAM diagnostic surface. On 2026-11-05, JSCC DEV diagnostics encountered `run.tasks.list` HTTP 403 both through a `gcloud` command that referenced the v1 namespace and through a direct v2 Execution/tasks request. IAM Policy Troubleshooter reported CAN_ACCESS for the Execution and CANNOT_ACCESS at project level. These facts do **not** establish that API version alone caused the authorization failure.

## Decision

1. New JSCC-owned code calling Cloud Run Admin API MUST use `https://run.googleapis.com/v2/` and the documented v2 resource hierarchy.
2. No JSCC-owned parallel v1/v2 implementation or silent fallback to v1 is permitted.
3. Existing JSCC-owned v1 integrations must be inventoried, migrated with tests, and removed. Any necessary exception requires a separately approved ADR with scope, owner, expiry and retirement criterion.
4. DEV, TEST and PROD share the same integration contract. No permission expansion or deployment is implied by this ADR.
5. Google-managed clients and `gcloud` internals are outside JSCC source-code control; a `gcloud` invocation is not evidence of a JSCC v1 integration.
6. IAM must be verified against the effective API/resource hierarchy. Least privilege and resource-scoped access remain preferred; broaden IAM only through an explicit operational change.

## Repository inventory at decision time

Source-code search on default branch (2026-11-05):
- `ops/src/worker.mjs`: explicit v2 Execution read and tasks listing.
- `ops/src/gateway.mjs`: explicit v2 Job execution.
- `command-api/src/runtime-gcp.js`: `RUN_API = 'https://run.googleapis.com/v2'`.
- No literal `run.googleapis.com/v1` match found by repository code search.

This is a source-search inventory, **not** proof that all scripts, external deploy tools, live revisions or third-party integrations use v2. Runtime inventory and IAM validation remain separate gates.

## Enforcement and acceptance

- A repository guard rejects explicit `run.googleapis.com/v1` endpoints in JSCC-owned runtime/script sources.
- The guard runs in both checked-in Cloud Build validation configurations and is runnable directly via `npm run check:cloud-run-api-version`.
- A guarded change must be reviewed for dynamic URL composition, library calls and transitive tooling which a static literal scan cannot prove.
- Acceptance for this policy slice: ADR checked in; guard integrated and tested; no identified in-repository v1 endpoint requiring migration.
- Operational acceptance of `run.tasks.list` is **not** implied; its 403 remains a separate runtime/IAM defect until re-tested successfully.

## Consequences

One supported API contract for JSCC-owned integrations; simpler maintenance and clearer IAM checks. Existing Google CLI behavior is not controlled by this contract. No automatic changes to deployed revisions, service accounts or project IAM.
