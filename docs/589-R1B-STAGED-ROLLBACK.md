# JSCC #589 — R1-B staged DEV release / rollback (DRAFT, NOT AUTHORIZED)

Owner architecture: B, reuse existing `jscc-diagnostics-dev` and R33 gateway.
This is an **execution plan**, not a deployment instruction. No action that mutates
Cloud Run, IAM, Git main, TEST or PROD is authorized by this document.

## 0. Hard gates (all mandatory)

1. Independent AgentFlow 1.4 EXACT-FILE `REVIEW_PASS` on the exact release SHA,
   including F1/F2 and source-image closure. The 2026-11-04 review on
   `56c9f344c50ab46bf81e8946dd4029320bea8515` is `REVIEW_FAIL`.
2. Confirm project-wide IAM bindings revoked in **both** `jscc-dev` and
   `jscc-shared`; DEV custom observer role is bound only to the **four**
   allowlisted services. Confirm `run.revisions.get` effective access under
   the diagnostics worker identity (not merely policy presence).
3. For `describe_dev_build`: **owner decision is required**. No narrow per-build
   IAM policy is established. Either approve a documented project-wide
   `cloudbuild.builds.get` risk after auditing build substitutions and config
   for literal secrets, **or** remove/deactivate that task before release.
   A project-wide binding must not be silently restored.
4. Verify real Cloud Run v2 `trafficStatuses` and `latestReadyRevision`
   with four **sanitized** fixtures from the read-only capture script, and
   test named sidecars and malformed/cross-project input.
5. Full CI green on exact release SHA, including Nile-only provider CI.
   No skips, waivers, or interpretation of infra errors as PASS.
6. Confirm zero incremental **billed** cost using the actual diagnostic job
   execution duration/resources and billing/quota evidence. Reusing a job
   does not make each extra invocation free.
7. Explicit owner approval for merge, trusted immutable source ref,
   coordinated DEV deployment, and rollback. No TEST/PROD changes.

## 1. Preflight and baseline capture (read-only)

- Verify the active deployer, current DEV project/region and both Cloud Run
  workloads; confirm actual deployed worker service account.
- Record current **immutable** gateway image digest, worker image digest,
  `SOURCE_SHA`, `GATEWAY_IMAGE_DIGEST`, `WORKER_IMAGE_DIGEST`, catalog
  version and revision IDs. Protect all secret values; capture only approved
  metadata. Use read-only `gcloud run services/jobs describe --format=json`
  with a controlled allowlist projection. Do not expose raw env/secret fields
  in CI logs, issues or ChatGPT.
- Record current R33 gateway image by immutable digest:
  `sha256:ac0c7843807921c466135bd039d34d50ab62cec2dcf70ba0667e950310ea7cbf`.
  This provenance anchor **does not automatically prove** it is the image
  currently serving traffic; confirm live routing separately.
- Verify exact source candidate is on `main` or an explicitly approved
  immutable `refs/tags/jscc-ops-approved/*` ref. The build script **rejects**
  untrusted feature branch refs; do not bypass this control.

## 2. Quiesce existing operations before any deployment

- Establish an owner-controlled DEV maintenance window: **stop new
  `run_operation` submissions**. Existing gateway has no source-verified
  admission freeze switch; verbal freeze alone is not a technical lock.
  If no reliable submission exclusion exists, **DO NOT deploy**.
- Inspect `gs://jscc-dev-ops-state/leases/diagnostics.json` for
  `state=ACTIVE` and unexpired lease, without exposing actor identifiers.
  Check outstanding `operations/*` and `dispatch/*`: none may remain
  ACCEPTED/RUNNING/unresolved. Also inspect live Cloud Run Job executions
  for pending/running state. Repeat checks after a settling interval.
- If any operation is in flight or evidence is ambiguous, **BLOCK**.
  Never delete leases, operations or dispatch records to force this gate.
- Freeze all gateway calls during the two-resource rollout; do not modify
  OAuth client registration, authentication scope, secrets or TEST/PROD.

## 3. Trusted build and two-image staging

- Build only after #589 source reaches the approved immutable ref, using
  `scripts/gcp/assert_trusted_ops_source.sh` and the existing Cloud Build
  source verification. Collect **both** image digests linked to the same
  approved `SOURCE_SHA`. No tag-only images.
- Confirm both Dockerfiles include the observer import dependency and
  the R33 gateway source is byte-identical to the pinned reference.
- Precompute verified image and metadata tuples:
  `(gateway digest, worker digest, SOURCE_SHA, CATALOG_VERSION=589-r1b-v1)`.
  Keep the previous R33 tuple for immediate rollback. The source SHA/digest
  bindings must be the same on gateway and worker.

## 4. Coordinated DEV-only rollout (explicit approval required)

The existing `scripts/gcp/deploy_remote_executor_dev.sh` updates the
**Job first** and **gateway Service second**. That creates a temporary version
mismatch for any incoming operation. Only proceed with the validated freeze
from step 2. A real atomic two-resource swap is not provided.

- With active operations **zero**, update `jscc-diagnostics-dev` to the
  verified new worker image; preserve its original service identity and all
  authorized non-secret configuration. Verify revision/image digest.
- Immediately deploy `jscc-ops-gateway-dev` with matching new gateway
  image, source SHA and worker digest, preserving existing OAuth secret
  version bindings. Audit the deployment script's `--remove-secrets` flags:
  no existing secret can be dropped without separate authorization.
- Verify health reports the new catalog `589-r1b-v1` and the live gateway
  routes 100% to the approved new revision. Confirm Job and Service have
  matching source/digest metadata before resuming operations.
- Smoke: OAuth `auth_check`, each of the **four existing** task types,
  DEV runtime observation on all four allowlisted services, and build
  observation **only if** approved scoped access or accepted risk is in
  place. Include missing-permission 401/403 fail-closed path; secret
  projection; idempotency; actual job run; split/LATEST traffic.
- If any smoke fails, stop submissions and initiate rollback. Record
  evidence links, not raw credentials or secret-bearing API responses.

## 5. Rollback (separate owner-validated command plan)

- Keep gateway submissions frozen; confirm no live R1-B dispatch or lease.
- Restore the original **worker** immutable digest and job runtime metadata
  from the preflight snapshot; restore the original **gateway** immutable
  digest/revision and original `SOURCE_SHA`/worker digest.
- Verify both report the **original R33-compatible catalog version** and
  100% gateway traffic to the original revision. Check all legacy tools
  and OAuth. Never mix original gateway with new worker once calls resume.
- If an execution may have been issued between changes, do not delete
  dispatch/lease records; document and resolve its state before rollback.
- The existing deploy script is **not** automatically approved for rollback:
  it can alter env/secret binding semantics. Derive exact rollback commands
  from the live baseline snapshot and review them before executing.
- IAM rollback is independent of image rollback: keep only the four scoped
  DEV service bindings if operations still require them, otherwise remove
  those exact new grants; project-wide Cloud Build binding remains absent.

## 6. Release evidence

Commit/SHA, independent review comment, CI IDs, IAM before/after policies,
sanitized real API response fixtures, cost evidence, two immutable image
digests, drain proof, smoke test records, rollback verification, and owner
approvals must all be recorded in PR #595.

**Status:** DRAFT / REVIEW_FAIL / NO DEPLOY AUTHORIZATION.
