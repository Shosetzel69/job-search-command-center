# Remote Executor DEV operator extension — #589

Companion to the [existing #537 DEV runbook](remote-executor-dev.md). The sections below preserve the source-only implementation and activation boundaries; this document grants no runtime change authority.

## #589 RE-07 — Command API mediated Nile observations

Owner-approved alternative to the unavailable dedicated native read-only credential. This replaces the isolated-DB-operator approach preserved in draft #701. It reuses the existing diagnostics Job identity and the product Command API connection. The application identity is not database-role read-only; protection comes from the fixed endpoint, exact caller authentication, server-selected tenant, database read-only transactions and unconditional rollback. Native transaction compatibility remains a live acceptance gate.

- Command API DEV only: `JSCC_DEV_NILE_DIAGNOSTICS=true`, `JSCC_DEV_NILE_DIAGNOSTIC_CALLER_SUB` (numeric Google subject of the existing diagnostics Job service account), `JSCC_DEV_NILE_DIAGNOSTIC_USER_ID` (approved active ADMIN account ID, server-side only). Absent/disabled flag denies access. Resolve identifiers from trusted DEV resources; never publish their values or tokens.
- Existing diagnostics Job `DEV_BASE_URL` must be the verified canonical HTTPS Cloud Run origin of the DEV Command API. The worker requests a Google ID token with the fixed diagnostic audience using its existing identity; no additional DB secret, account, role, dependency, or IAM elevation.
- Typed task `observe_dev_nile`: environment=dev, expected_source_sha, operation restricted to `fit_verify_plan`, `global_listing_plan`, `fit_verify_analyze`, `global_listing_analyze`. No arbitrary SQL, tenant, filter, URL or cursor parameters. Global listing uses the fixed publication-descending first-page limit 20, aligned to #659 S2/Q1 (R702-F01). Cursor pages, fit-desc UI default and Q2–Q5 decomposition remain outside this slice. Only sanitized plan metrics and known node classifications are returned, through authenticated operation evidence.
- Account lookup and tenant diagnostics use distinct read-only transactions. Tenant binding is established before other queries in the tenant transaction. Failure to establish context, read-only state, database binding, timeout or rollback fails closed; no fallback to writable transactions. `EXPLAIN ANALYZE` executes the fixed SELECT and may consume DEV capacity; obtain cost admission before live execution.
- Existing gateway/worker must be upgraded together because the catalog version changes to `589-nile-api-v1`. Product Command API must be deployed from the independently reviewed source first, with diagnostics disabled until trusted configuration and effective runtime identity have been verified. Activation is a separate DEV configuration operation, not part of the image-only deploy. Verify live MCP tool schema after gateway upgrade; refresh connector if needed.
- Independent reviewer checks exact SHA, negative route/caller/source/tenant/database cases, rollback and absence of DB credentials in worker, existing task regression, no raw plan predicates or PII, and live provider support for EXPLAIN/ANALYZE and transaction controls. Existing DEV-only cost and deployment gates remain. Disable flag for rollback of feature admission; restore prior reviewed images via existing routes if needed.
- This is a bounded #659 diagnostic capability, not completion of #589 RE-07: arbitrary SQL, schema/migration/restore operations and disposable Nile container remain outside this delivery.

## #589 RE-04 / RE-08 — R5 operator-side build submission (source only)

The existing `ops/build/dev-cloud-build-controller.mjs` and durable
`ops/control/dev-build-operation-ledger.mjs` now bind approval to the exact
staged source object, generation and SHA256. A create-only approval record
in the existing `control/v1/builds/` prefix consumes each authoritative
approval once, independently of actor and idempotency key. The operation
record is confirmed in SUBMITTING before remote dispatch; uncertain submit
receipts are never retried automatically.

`scripts/gcp/remote_executor_dev_build.mjs` reuses the existing trusted
operator credential and GCS CAS transport. It accepts an independently
obtained canonical evidence pin, not a caller-generated self-hash.
The pin binds the reviewed source SHA/ref, existing staging object and
generation, archive SHA256, canonical YAML file SHA256, reviewed equivalent
Cloud Build REST configuration, owner/review/cost/access/lifecycle evidence
references and a bounded time window. The configuration equivalence is an
**independent-review requirement**, not automatically inferred from the list
of build step IDs. The operator verifies its exact clean checkout and remote
ref, the settled scoped lifecycle and archive bytes before submission.
It sends the existing reviewed build configuration to the regional
Cloud Build create API with `source.storageSource.generation` explicitly
set, reusing `jscc-shared-ops-cloudbuild-source`, `jscc-ops-build` and the
existing ops image lineage. No new infrastructure or runtime permission.
Only the trusted operator may invoke this source module. It does not
expose a new MCP mutation, does not replace the approved manual build script,
and does not assert source provenance from a successful build status.

Release dependencies remain: a trusted remote operator entrypoint with
independently authenticated approval delivery (not the Gateway, diagnostics
or sandbox identity), actual staged archive/config-equivalence evidence,
cost and permission admission, lifecycle convergence, and exact-SHA
independent review. Existing `cloudbuild.ops.yaml` manually publishes images;
build status alone may not contain `results.images`; live registry/provenance
correlation is still required. No build, cloud operation, IAM or product
configuration has been executed by this source slice.


## #589 — consolidated DEV operator candidate (PR #711)

Source-only extension of R5/R6. This section supersedes the earlier statement
that there is no MCP mutation entrypoint. It does not authorize deployment.

- Catalog `589-operator-v1`: `operator_start` and `operator_status` accept
  only an authoritative approval reference; the start route is disabled by
  default. Gateway authenticates the existing Google actor and binds the
  approved operator SHA, action, immutable bundle and expiry.
- New proposed isolated Cloud Run Job `jscc-ops-operator-dev`, with its own
  same-named DEV service account and `jscc-ops-operator` image. No privileged
  module is copied into the Gateway or diagnostics image. The existing build
  lineage publishes its image with source parity evidence. The image uses
  Google Cloud CLI, Node 22, Python 3 and PyYAML; runtime dependency
  availability and immutable image provenance require independent review.
- The Job rechecks execution/task identity and the protected approval,
  claims a create-only operation before executing, and writes sanitized
  evidence. Supported source actions: pinned build and build observation,
  approved gateway/diagnostics paired deployment and recovery observation,
  bounded R4 inventory, GCS artifact metadata/copy, and GCP metadata.
  Uncertain submission is not retried automatically. Build cancellation is a
  separate approved action bound to the original approval and exact build ID;
  verify ledger and provider source before regional cancellation, then observe
  the actual terminal outcome. Lost receipts require observation, never retry.
  `cloudbuild.builds.update` requires separate least-privilege admission; no
  live permission or cancellation has been performed.
- `remote_executor_dev_publish_approval.mjs` is an independent publisher
  interface, not an MCP tool. Its trusted pin must come from independently
  authenticated owner/reviewer/cost evidence obtained through the existing
  GitHub authority. The same independent publisher module prepares a bounded
  Git archive from an exact clean trusted checkout and stages it only with an
  externally pinned approval/review/cost record and archive SHA256. Upload uses
  the existing dedicated bucket, a deterministic approval-specific object,
  create-only generation precondition and exact-generation digest readback.
  A remote authenticated publisher route and live permissions remain missing;
  a self-supplied hash does not authorize staging or a change.
- The same approved build controller accepts fixed `workspace_r2` for #589:
  existing cloudbuild.workspace-manager-r2.yaml, exact paired base digests,
  fixed image packages and step IDs. Existing staging archive hash, YAML
  equivalence, approval, cost and ledger checks still apply. Build only;
  Manager/Worker rollout remains on the separately approved release boundary.
- The Job parses the staged build YAML in a bounded Python subprocess using
  PyYAML and compares the exact reviewed REST configuration. Build success
  does not prove source provenance. Registry tag/digest observation reports
  provenance UNVERIFIED until correlated with trusted evidence. Approved build
  observation now binds the original durable record to provider source object,
  generation, SHA/ref substitutions and resolvedStorageSource when returned;
  only fixed step IDs/statuses are projected, including terminal observations.
  No raw build logs or arguments are exposed. This is not full Git-to-image
  provenance; the existing independent source/image verification remains.
- Service metadata separates desired template configuration from observed
  traffic revisions and their immutable digest evidence using the existing
  DEV runtime observer; unresolved digests remain UNKNOWN. It does not
  establish source provenance or expose revision environment values.
- Fixed DEV execution observation binds the Search, diagnostics or migration
  Job execution to its UID, immutable image and SOURCE_SHA. Separately approved
  cancellation is limited to the diagnostics Job, uses its execution etag, and
  reads back the exact execution without claiming cancellation from the receipt.
  No product/migration cancel, Job overrides, deletion, lock release or retry.
  The cancellation permission (run.jobs.run) requires separate resource-scoped
  admission; existing product release authority is unchanged.
- Billing status is read-only for jscc-dev/jscc-shared; quota metadata is
  bounded to DEV Cloud Run/Storage and reported global/europe-west1 limits.
  Neither project billing linkage nor quota limits prove consumption, actual
  charges, remaining credits, or cost admission. No billing account ID,
  quota change, billing-account action, API activation or IAM grant.
- Fixed Cloud Run v2 testIamPermissions probes first verify exact DEV resource
  existence and report the current operator's returned permissions only.
  No caller-selected permissions, policy mutation, arbitrary principal or
  project-wide isolation claim. Conditional IAM and other resources require
  separate independent live evidence.
- GCS copy is restricted to the dedicated staging bucket, approved DEV
  artifact names, exact source generation/checksums and create-only
  destination. A multipart/uncertain rewrite stops; managed data deletion
  is excluded. Separately approved transient staging cleanup deletes only the
  exact generation after checksum verification; 404 readback does not prove
  physical deletion. Soft-deleted staging restore uses create-only destination,
  verifies old/new generations and checksums, and rejects ambiguous restore
  tokens. Cleanup additionally binds the original build approval, exact build
  ID and archive, and observes a terminal provider/ledger state before DELETE.
  Publisher must prove no other active build needs that archive before cleanup,
  flat namespace/soft-delete support and zero-cost admission before restore.
  No grants or live mutations; storage.objects.delete/restore require scoped
  independent admission. See Google Cloud JSON API objects/delete and restore.
- Nile adds `schema_inventory` to the existing fixed read-only Command API
  route: migration checksums, table presence and observed index/constraint
  names only. The existing mediated route also supports runtime_health:
  verified read-only/timeout settings, current-backend TLS observation and
  own-backend lock counts, current-process pg.Pool counts. No PID, user,
  query text, tenant identifiers or cross-tenant activity. Provider support
  is a live gate; backend TLS does not establish end-to-end client TLS.
  Fixed migration_013_preflight reuses the existing dedicated 013 release
  catalog/ledger validator in the read-only transaction; reports exact
  migration checksum and PENDING_013/ALREADY_APPLIED, never apply authority.
  Legacy generic db:migrate remains disabled; no separate database identity.
  No application rows, arbitrary SQL, DDL, backup or migration execution.
  Product image release stays on its existing route, with DEV acceptance
  and Retrieve protection. The operator has no product deploy authority.

### Activation prerequisites (not an executable provisioning instruction)

Independent exact-SHA review, explicit owner release approval and
STRICT_ZERO_INCREMENTAL_COST admission are required before any cloud write.
The new Job and identity have not been created. Do not reuse the Gateway,
diagnostics or sandbox identity for privileged execution.

Review exact IAM permissions and resource conditions first:
Gateway: fixed operator Job get/run (no overrides), LRO observation, read
approved records/results and create-only request/dispatch objects.
Operator: read protected approvals/requests/dispatch, create-only claims
and results, scoped CAS controller journals, existing maintenance lease and
required observations; impersonation of the existing scoped ops deployer
only. Build submission must use the existing dedicated ops builder and
separate admission for shared-project create/get and actAs. Reject broad
product deploy grants or secret accessor grants. Secret metadata uses
secrets.get only; GCS object-get permission can also read content, so
the fixed metadata projection is an application boundary, not an IAM
metadata-only permission. Publisher alone may create approval objects.
Review inherited roles and actual permission isolation before enabling.

Use the existing lifecycle correction first and establish its settled
state; do not remove durable approval/claim/result records. Verify the
actual immutable operator image, fixed DEV project/region, task count and
parallelism one, retries zero, 1800s timeout, 1 CPU, 1Gi memory, fixed
environment, no mount/command/args overrides. Gateway config:
`JSCC_DEV_OPERATOR_ENABLED`, `JSCC_DEV_OPERATOR_SOURCE_SHA`,
`JSCC_DEV_OPERATOR_IMAGE_DIGEST`. Enabling is a separate controlled
configuration change. Keep disabled until all preconditions pass.

Capture the protected product API and Search Job baseline, drain Retrieve,
preserve their effective config/revisions/digests and do not manipulate
product locks. Coordinate immutable Gateway/diagnostics/workspace upgrades
and rollback with independent DEV functional acceptance. No TEST/PROD
promotion before DEV PASS and separate environment-specific admission.
