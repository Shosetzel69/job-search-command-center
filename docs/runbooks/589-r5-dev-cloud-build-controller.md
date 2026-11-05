# JSCC #589 R5 — DEV Cloud Build Controller (source-only)

**Status:** Source candidate. No builds triggered, IAM/Cloud Run/DB mutations, PR merges or TEST/PROD access. Reuses one JSCC connector and one Google OIDC `sub`.

## Existing build lineage — checked, not replaced

- Existing approved operations build script: `scripts/gcp/build_remote_executor_dev.sh`.
- Existing operations config: `cloudbuild.ops.yaml`; fixed build project `jscc-shared`, region `europe-west1`, build SA `jscc-ops-build@jscc-shared.iam.gserviceaccount.com`, source staging bucket `jscc-shared-ops-cloudbuild-source`.
- Existing source trust policy: `scripts/gcp/verify_trusted_ops_ref.sh` accepts only exact matching `refs/heads/main` or a versioned `refs/tags/jscc-ops-approved/*` tag. The standard GitHub connector remains the remote Git authority; this extension provides no Git operations.
- **Not ready for product build/deploy:** `cloudbuild.promotion.yaml` deliberately exits with code 86 before doing anything. This change does not remove that protective stop or promote JSCC application images.

## Functionality implemented

### 1. Live-facing read-only planner: `plan_dev_ops_build`

Exposed as a new `OBSERVE` task of the existing Gateway `run_operation` tool; caller provides:
```json
{
  "work_item_ref":"#589",
  "idempotency_key":"r5-observe-unique",
  "task":"plan_dev_ops_build",
  "args":{
    "environment":"dev",
    "source_sha":"<exact lowercase 40-hex SHA>",
    "trusted_ref":"refs/heads/main"
  }
}
```

Alternatively a narrowly named `refs/tags/jscc-ops-approved/<tag>` is allowed. The runtime derives its `work_item_ref` from the existing signed dispatch, not a user-supplied command. Unknown keys, unexpected projects, unapproved refs, non-DEV and invalid SHA are rejected before creating a plan.

Response **does not invoke Cloud Build**. It describes fixed project, source staging bucket, existing script/config, builder SA and security gates, with:
- `source_ref_verified=false`
- `source_snapshot_verified=false`
- `approval_verified=false`
- `submission_enabled=false`
- `estimated_incremental_cost='UNVERIFIED'`

### 2. Authorized operator internal contract — not exposed or active

`ops/build/dev-cloud-build-controller.mjs` includes
`submitApprovedDevOpsBuild()`. It is **not** routed from the diagnostics
worker, not listed as an MCP tool and has no default privileged transport.

A future, independently reviewed authorized operator must inject **trusted,
server-side** implementations of ALL five checks/actions:
1. `verifyApproval`: exact owner approval (work item, source, ref, scope), expiration and identity checked from authoritative approval records.
2. `verifyTrustedRef`: independent GitHub connector/source admission verification that trusted ref resolves to exact SHA (not a user assertion).
3. `verifySourceSnapshot`: trusted source artifact, SHA256 and GCS generation proven and pinned. Verified object content MUST correspond to the exact source commit.
4. `verifyCostAdmission`: independently checked `STRICT_ZERO_INCREMENTAL_COST` policy, not a boolean supplied by the caller.
5. `dispatch`: privileged operator executes ONLY the approved existing script/config and records an operation receipt.

Missing callbacks, mismatched proof, missing approval reference, missing source generation, insufficient cost evidence, cross-project result, or invalid build receipt fail closed.

**Important:** trusted callbacks and a persistent idempotency/recovery adapter do not exist yet. It would be unsafe to treat this module as a deployable Cloud Build submitter. A future implementation must use the existing operations GCS state/leases or equally reliable durable idempotency, recover lost build IDs before retry, and bind the immutable source snapshot actually consumed by Cloud Build.

### 3. Status projection

`projectDevBuildStatus(raw, trackedReceipt)` translates the trusted regional `builds.get` response into a bounded status. It accepts only the exact known build ID and full regional resource name, never arbitrary IDs or raw build substitutions/secret metadata. It distinguishes pending/working from SUCCESS/FAILURE/CANCELLED/TIMEOUT/EXPIRED, keeps only approved immutable image digests under `jscc-shared/jscc-ops`, and reports source provenance as `UNVERIFIED` pending independent source/archive verification.

`projectDevBuildStatus` is an internal pure function; live polling of newly submitted builds is **not connected** until an authorized submitter creates durable receipt/state.

## Security boundaries and planned release

- One JSCC OAuth user, existing gateway and read-only diagnostic worker; no generic privileged shell, no Cloud Build `builds.create` in the diagnostic worker, no added privileges, no new service.
- Existing legacy seven MCP tools and R1–R4 tasks unchanged. Catalog `589-r5-v1` makes mixed gateway/worker dispatch fail closed; eventual release must be a controlled paired image rollout.
- Parent PR #595 independent F1 HIGH (project-wide IAM) is still open; owner requested IAM be left unchanged during development. That instruction is **not** independent review approval or acceptance of the security risk.
- R5 and all ancestors require independent review, real DEV E2E, trusted exact SHA source attestation, verified cost admission and explicit build/deploy approvals.

## Source scope

- `ops/build/dev-cloud-build-controller.mjs` — planner and server-gated submission/status contracts.
- `ops/src/lib.mjs` — `plan_dev_ops_build` read-only catalog and authenticated output schema.
- `ops/src/worker.mjs` — only pure `planDevOpsBuild` wired to existing dispatch.
- `ops/Dockerfile.worker` — planner dependency bundled into existing image.
- `ops/test/r5-cloud-build-controller.test.mjs` — validation/gates/receipt/status/information-boundary tests.
- Earlier R1–R4 catalog expectations updated; `.github/workflows/remote-executor-check.yml` syntax checks.

**Next independent implementation, separately approved:** durable authenticated submit/status/cancel tracking in an appropriately scoped existing Cloud Build execution identity. Do not grant `cloudbuild.builds.create` to the read-only diagnostics worker or accept user-generated 'approved' proofs.
