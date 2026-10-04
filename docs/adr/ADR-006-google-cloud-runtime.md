# ADR-006 — Google Cloud runtime and immutable container promotion

Status: `ACCEPTED`  
Version: `v1.1`  
Applicability: `CURRENT`  
Applies to: `AGENTFLOW`  
Effective from: `2026-09-27`  
Amended: `2026-10-04` — #483 DB migration promotion gate  
Supersedes: current GitHub-Actions-as-runtime hosting model after approved cutover

## Context

JSCC currently depends materially on GitHub Actions for CI, environment deployment and heavy search execution. Hosted-runner quota exhaustion can therefore block both development validation and PROD search execution.

The persistence direction is already fixed by ADR-004/ADR-005: **Nile-managed PostgreSQL remains the target persistent backend**. This ADR changes hosting/runtime/CI only; it does not reopen the database decision.

## Decision

Adopt Google Cloud as the target application runtime and build platform:

```text
GitHub
  -> Cloud Build
  -> Artifact Registry
  -> same immutable image digest
       -> DEV
       -> TEST
       -> PROD

Cloud Run Service
  -> UI/API

Cloud Run Search Job
  -> Python search engine + Playwright/Chromium

Cloud Run DB Migration Job
  -> candidate-owned Nile/PostgreSQL schema migration/readiness

Cloud Scheduler
  -> scheduled PROD search

Secret Manager
  -> environment/runtime secrets

Nile PostgreSQL
  -> approved persistent backend target
```

### Environment model

Use separate GCP projects:
- `jscc-dev`
- `jscc-test`
- `jscc-prod`

Use one shared infrastructure project:
- `jscc-shared`

The shared project owns the common Artifact Registry and build identity. Runtime service accounts remain environment-specific.

### Build and promotion contract

The release artifact is built **once** from an exact Git commit.

Required identity chain:

```text
GIT_SHA
  -> Cloud Build
  -> image digest sha256:...
  -> DEV
  -> TEST
  -> PROD
```

No DEV/TEST/PROD rebuild is permitted for the same candidate. Promotion uses the same immutable image digest.

Release evidence must record at minimum:
- Git SHA;
- image digest;
- DEV validation;
- TEST validation;
- PROD authorization and deployment evidence.

This extends, rather than replaces, the immutable-candidate principle in the existing delivery lifecycle.

Database compatibility is part of the same candidate promotion contract. Before application rollout in an environment:
- a dedicated environment-scoped Cloud Run DB Migration Job runs from the exact immutable candidate Service digest;
- the Job executes the candidate migration runner against only that environment database;
- applied migration version/name/checksum and required relations are verified;
- runtime privilege readiness is verified separately;
- any migration/schema/readiness failure stops promotion before application Service deployment;
- Cloud Build orchestrates the Job but does not receive the database credential value directly;
- DEV/TEST may use the approved shared-role exception; this does not weaken the separate PROD privilege gate in ADR-008.

### Artifact Registry

Use one Docker repository in `jscc-shared`:
- repository: `jscc`;
- region: `europe-west1`;
- build identity: `jscc-build@jscc-shared.iam.gserviceaccount.com` with Artifact Registry Writer;
- DEV/TEST/PROD runtime identities receive Artifact Registry Reader only.

Apply cleanup policy to non-release/obsolete images. Production-referenced digests must remain retained.

### Cloud Run Service

Cloud Run Service hosts the application/API target.

Authentication/authorization remains explicit and fail-closed. Migration must define the replacement for the current Cloudflare Worker boundary before cutover. CORS, public ingress, IAM and end-user authentication must be documented and tested; no implicit public API exposure is accepted.

### Cloud Run Search Job

Heavy search is asynchronous and must not execute inside an HTTP request.

Initial job baseline:
- 2 vCPU;
- 4 GiB RAM;
- timeout 45 minutes;
- tasks = 1;
- parallelism = 1;
- max retries = 1.

Manual and scheduled search use the same job definition.

Initial concurrency rule: maximum one active heavy search per environment. A second request must fail explicitly rather than overlap.

Sharding by source is deferred until runtime evidence justifies it.

### Search run persistence during migration

Platform migration precedes persistence migration.

During the initial cloud-runtime phase, current JSON-compatible run artifacts may remain in **Cloud Storage as transient runtime artifacts only**.

Cloud Storage contract:
- one environment-owned bucket per GCP project (`jscc-dev`, `jscc-test`, `jscc-prod`); no shared runtime-data bucket and no cross-environment fallback;
- buckets use the same regional placement as the runtime baseline (`europe-west1`) and Standard storage unless a separately approved change says otherwise;
- each run writes only under `runs/{run_id}/...`; a run never overwrites another run's path;
- the environment pointer is a small `current.json` object containing at minimum `run_id` and the referenced artifact identity; pointer updates use Cloud Storage generation-match preconditions and fail on concurrent modification;
- runtime service/job identities receive only the minimum object permissions required in their own environment bucket; no DEV identity may read or write TEST/PROD buckets, and no TEST identity may read or write PROD;
- migration/administrative bucket authority remains separate from routine runtime authority;
- transient run artifacts are lifecycle-deleted after 30 days; governance/release evidence is not stored in this runtime-artifact bucket and is therefore not subject to this lifecycle;
- object versioning is not required for the runtime pointer contract; atomicity is provided by generation preconditions;
- bucket usage and storage cost are included in the aggregate DEV+TEST+PROD cost guardrail.

After the PostgreSQL migration slices in #275/#293, migrated domains follow ADR-004/ADR-005 and PostgreSQL becomes authoritative for those domains. Cloud Storage must not become a second authoritative store for migrated domains. Permanent JSON/PostgreSQL dual-write remains prohibited.

### PostgreSQL

Nile/PostgreSQL remains the approved persistent backend target.

This ADR explicitly rejects introducing Cloud SQL or Firestore merely because the compute runtime moves to GCP.

Existing DEV/TEST/PROD database separation remains:
- `jobsearch_dev`;
- `jobsearch_test`;
- `jobsearch_prod`.

#293 must be re-analysed before implementation because its current connectivity contract assumes Cloudflare Worker -> Hyperdrive -> Nile. The repository/data-access boundary, schema direction and PostgreSQL portability remain valid.

### CI/CD and GitHub Actions

Cloud Build becomes the target CI/build mechanism for cloud-runtime delivery.

GitHub remains:
- source control;
- Issues/PRs;
- governance/evidence anchor.

GitHub Actions may remain for bounded auxiliary checks during migration, but PROD search execution and the target deployment lifecycle must not depend on GitHub-hosted Actions minutes after cutover.

### Source-health migration gate

Datacenter-IP behavior may differ from GitHub Actions.

Before PROD cutover, TEST must compare source health before/after migration, at minimum:
- source;
- outcome;
- record count;
- error/blocked reason;
- latency where available.

A source that works on the current runtime but becomes blocked on GCP is a migration regression requiring explicit disposition.

### Cost guardrails

The architecture is **cost-minimized**, not guaranteed zero-cost.

Cloud Run free allowances are shared at billing-account scope and must not be multiplied by the number of projects.

Controls:
- one billing account for JSCC projects;
- monthly budget alert;
- alerts at 50/75/90/100%;
- no automatic paid capacity decision in application logic;
- measure aggregate DEV+TEST+PROD consumption;
- DEV uses targeted validation;
- TEST uses smoke/selected validation and full search only when release validation requires it;
- PROD carries scheduled live workload.

Budget alerts are monitoring controls, not a hard spending cap.

### Rollback

Before PROD cutover:
- previous PROD runtime remains deployable;
- previous known-good Git SHA and image/runtime identity are recorded;
- DB migration remains independent from runtime migration unless a separately approved slice explicitly couples them;
- rollback must not require a database downgrade unless that migration has its own validated rollback/restore evidence.

### Phased migration

1. **Container foundation** — Dockerfile, Cloud Build config, build-only push to shared Artifact Registry.
2. **DEV runtime** — Cloud Run Service/Job, secrets, health and manual targeted validation.
3. **TEST runtime** — same digest, smoke/source-health comparison.
4. **PROD runtime** — explicit owner GO, scheduler, cutover and smoke.
5. **Persistence continuation** — resume #275/#293 against the new runtime boundary.

## Acceptance criteria for the architecture

- one image is built per candidate and promoted by digest;
- DEV/TEST/PROD remain permission-isolated;
- runtime identities are read-only against shared Artifact Registry;
- build identity is the only routine writer to Artifact Registry;
- heavy search is asynchronous;
- one-active-run protection exists initially;
- Nile/PostgreSQL direction is preserved;
- Cloud SQL/Firestore are not introduced by hosting migration;
- source-health regression is checked in TEST;
- cost is evaluated across all environments;
- rollback exists before PROD;
- target PROD runtime no longer depends on GitHub-hosted Actions minutes.

## Consequences

Positive:
- removes GitHub-hosted-runner quota from the critical PROD runtime path;
- keeps exact-candidate promotion stronger through immutable image digests;
- scales search independently from HTTP/API requests;
- preserves PostgreSQL portability and the approved Nile direction;
- allows cost to scale with actual execution.

Costs/risks:
- new GCP IAM and build/runtime operational surface;
- Cloud Run datacenter IPs may alter source blocking behavior;
- container image storage requires cleanup discipline;
- #293 connectivity assumptions must be updated;
- temporary coexistence with Cloudflare/GitHub Actions requires explicit migration boundaries.

## References

- #270 — approved Nile/PostgreSQL architecture
- #275 — PostgreSQL implementation readiness/migration plan
- #293 — DB-01 PostgreSQL repository foundation
- ADR-003 — environment isolation
- ADR-004 — Nile/PostgreSQL backend
- ADR-005 — multiuser ownership/isolation/shared collection


### #483 promotion observability amendment

Promotion state is environment-owned operational evidence in the existing Cloud Storage runtime boundary. It is not candidate-managed product data and is not a second release authority. The control plane publishes a sanitized step checklist before the first normal promotion mutation; ADMIN UI may read it through the protected Command API boundary. Search run state and promotion state remain separate contracts.
