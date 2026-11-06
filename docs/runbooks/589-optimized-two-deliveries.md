# #589 — Optimized DEV Remote Executor delivery plan

Decision: owner accepted the two-delivery simplification on 2026-11-06.
Scope: existing one-Google-user JSCC connector, GitHub native connector as sole Git interface; DEV only. AgentFlow 1.4.

## Baseline and non-goals

- Base: `main@f4ab40cb1fcba4146cd4b474dc667002492e4a52`.
- Delivery 1 source: consolidated R1–R4 from `#595–#598` with narrowly integrated F1–F3 from `#602`. Do not merge the old stacked PRs independently.
- Existing Gateway OAuth/PKCE, existing DEV identity, 4 legacy operation types and workspace list/read/write/run must remain operational.
- Reuse existing Cloud Run, GCS and diagnostics job. No second Git interface, service, Google user, Cloud Run gateway, automatic paid provisioning, TEST/PROD permissions or new default privileged shell.
- R5/R6 Cloud Build submission, controller and durable paired rollback remain archived as **Delivery 2 options**, not prerequisites for the first working DEV diagnostic toolset.
- Nile read-only and strictly owner-approved migration operations are in Delivery 2, not falsely marked complete by Delivery 1.

## Delivery 1 — source contents

1. R1: typed Cloud Run v2 runtime, revision/traffic and immutable digest observation (Cloud Build metadata deferred to Delivery 2); owner-approved DEV targets only.
2. R2: workspace `checksum/search/compare/replace/delete`; 409 generation conflict; no recursive delete; existing list/read/write/run retained.
3. R3: readonly rollout and source-image deployment preflight, explicit `INSUFFICIENT_EVIDENCE` if provenance cannot be proven.
4. R4: fixed read-only Cloud Run observation through existing worker; Cloud Build-dependent pinned script deferred to Delivery 2.
5. F1-F3 from #602: bounded v2 tasks list, redacted nonempty execution log evidence with pagination, GCS run metadata assertions, explicit 403/unknown rather than invented PASS. No IAM mutation; live `run.tasks.list` 403 remains open.

## One review and one DEV release — gates

**Gate G1 — source:** current main reconciliation, tests for older OAuth and all legacy tools, exact immutable source fingerprint, security regression, deny TEST/PROD, package contents of paired Gateway + diagnostics Worker and Workspace Manager. No silent widening of R33 gateway trust boundary.

**Gate G2 — independent:** ONE AgentFlow 1.4 exact-file combined code/security/integration review, with findings and PASS/FAIL/BLOCKED. Address inherited #595 F1 broad IAM risk without pretending the owner's temporary "leave IAM unchanged" is a waiver.

**Gate G3 — release:** explicit owner approval for exact reviewed SHA and image digests, source-build attestation, zero incremental cost, staged nonserving revisions and rollback, confirmation of the currently live Connector registration. Deployment is not authorized by this plan.

**Gate G4 — E2E:** authenticate existing ChatGPT connector, verify all legacy tools, new workspace tools including CAS conflict and 99/100/101 guard in isolated backend, runtime/rollout observation, known log entry, actual F1 task metadata and F3 positive/negative snapshot. If F1 permission remains denied, retain `F1_FAIL` while allowing independent features to pass; do not label overall connector E2E PASS.

## Delivery 2 — later, separately authorized

Reuse existing `scripts/gcp/build_remote_executor_dev.sh` and Cloud Run/registry ops rather than adding a second privileged orchestration layer. Connect typed owner-approved Cloud Build/deploy and rollback, then DEV Nile readonly schema diagnostics, approved SQL and official ephemeral Nile test container. Deliver full 'no manual Cloud Shell' path only after real DEV proof. R5/R6 source remains available for reuse without unconditional adoption.

## Explicit holds

No merge, build, deployment, traffic, IAM, SQL, migration, source activation or TEST/PROD changes without their specific approval. All source CI evidence must be tied to the exact review SHA. This document is not independent review or release authorization.
