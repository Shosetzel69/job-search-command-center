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

## #589 maintenance admission (source slice, not live deployment authority)

`scripts/gcp/remote_executor_dev_maintenance.py` implements operator-side primitives for the existing R6 freeze/unfreeze boundary. Its standalone entry point is strictly read-only: it fingerprints the Command API effective revision, template and traffic plus the Search Job template; consumes execution pages for both DEV jobs and operation/dispatch pages from the existing private ops bucket; and refuses unresolved records, active or ambiguous leases, missing permissions, pagination overflow and protected-state drift. Only the fingerprint and coarse status are emitted. This may require many GCS read operations; cost admission remains external and mandatory.

The source-level freeze primitive uses the **same** `leases/diagnostics.json` object and generation-CAS semantics as the existing gateway, without a second lock store or any change to Retrieve locks. It never overwrites an ACTIVE lease, even an expired one. After acquisition it checks ownership, complete drain and protected state again. The maintenance marker uses the existing ACTIVE state and a safe-integer far-future expiry so ordinary gateway lease acquisition rejects it; the existing bucket lifecycle still limits retention. Do not rely on this marker for unattended long-term recovery. A lost or ambiguous acquisition, failed verification or interrupted process requires explicit operator recovery; never delete/force-release the marker. Release uses the owned generation and operation ID and requires a trusted actual-pair verifier and protected-state parity.

This slice does **not** wire the live R6 approval/cost/pair-verification or rollback adapters, prove operator IAM, prove exclusion on all historical tagged gateway revisions, or make the existing routine deploy script safe to execute by itself. The existing owner maintenance window must exclude new Retrieve and other deployment activity; read-only checks cannot atomically prevent a product-side launch. No automatic rollback or live freeze is authorized by this source. Continue with independently reviewed integration before executing the approved paired rollout, explicit traffic cutover and recovery. No new IAM, database, secret, TEST or PROD changes.

### Unresolved records and manual recovery (R706-F04)

If a historical operation or dispatch remains nonterminal or lacks its exact execution binding, inspection, acquisition and release remain blocked even if no job appears active. Do not use record age as proof of completion, delete records, shorten the maintenance expiry or release a lock by force.

1. Stop new submissions and all concurrent release activity. Keep an owned maintenance marker intact; if ownership or generation is uncertain, stop all mutations.
2. Correlate the exact operation ID, dispatch execution name, immutable source and worker digest, Cloud Run terminal execution evidence and existing result/operation records. Inspect only privately; retain sanitized evidence of the original generations, disagreement and terminal state. Missing or contradictory proof means the operation remains unresolved.
3. Submit a separate, exact-record repair proposal in #589 for independent review and explicit owner approval. Only an authorized operator may repair proven terminal status or the proven execution binding, using the captured generation as a compare-and-swap precondition and recording before/after evidence. Never fabricate a success verdict or modify Retrieve locks. No repair command or repair capability is provided by this source slice.
4. Recheck every page of operations, dispatches and executions, actual serving gateway/worker pair, protected Retrieve fingerprint and maintenance ownership. Resume the reviewed R6 release or recovery path only after all checks agree; if the process lost its ownership context, an independently reviewed recovery procedure is required. Otherwise retain the lock and escalate the incident. Bucket lifecycle expiry is not a recovery mechanism.

This is a current #589 maintenance source contract appended to the historical R1-B plan. It does not reopen that draft's approval, revive historic IAM decisions or authorize live freeze, repair or deployment.

## #589 R6 operator composition (source, live admission pending)

The subsequent source slice connects the existing R6 controller to the approved maintenance guard through the private operator-side modules `scripts/gcp/remote_executor_dev_pair.mjs` and `scripts/gcp/remote_executor_dev_pair.py`. They are not gateway/worker code, MCP tools, a public endpoint or an independently authorized deployment route. The historical shell is not approved for unguarded routine rollout.

The trusted caller must provide authoritative owner approval, immutable image/source provenance, zero incremental cost and maintenance-window verification callbacks bound to the R6 plan. The window covers both Retrieve and concurrent deployments, the existing tagged revisions' lease compatibility, exact rollback authority and operator access. A raw request or assertion is not a proof provider. No concrete trusted proof provider or live admission entry point is supplied in this slice.

The operator reads effective revision and full templates via Cloud Run v2; requires a reconciled, explicit revision-pinned baseline; preserves service accounts, existing environment/secret bindings and configuration. Only the image and the three existing provenance variables are updated, using the existing DEV deployer identity. Worker update precedes gateway staging without traffic, candidate revision/source/image verification, and explicit canonical 100% traffic transfer. Existing tags must remain unchanged. Both actual images, metadata, protected Retrieve state and canonical health catalog must match before owned release.

Rollback restores the old worker and gateway template bindings, routes canonical traffic to the original immutable gateway revision and verifies both before unfreezing. A command failure or timeout is an uncertain remote mutation; lost ownership, protected drift, ambiguous release or incomplete recovery blocks further mutations and requires manual recovery. Never roll back after an unfreeze may already have succeeded. Operator snapshots are in memory only: a lost process requires separately reviewed generation-bound recovery; durable approval/recovery and live IAM/cost/lifecycle validation remain open. No product resources, IAM, secrets, DB or other environments are changed.

Template comparison excludes exactly the gcloud-generated `client.knative.dev/nonce` label at revision/execution and nested task template levels (#520 evidence 7165263147; R707-F02). All other labels and annotations remain subject to drift checks. Before live admission, inspect actual Cloud Run v2 metadata read-only for other client-generated keys; do not broaden normalization without evidence and independent review. Any non-zero gcloud exit, even an apparent pre-mutation rejection, is treated as an uncertain mutation requiring the documented manual recovery path (R707-F03).

Cloud Run CLI references: [service update](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update), [job update](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/update), [traffic update](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update-traffic). Live API behavior and permissions remain an independent acceptance gate.

## #589 R6 durable admission and restart observation (source only)

The successor to the preceding source slice reuses the existing `gcsDevOperationStore` generation-CAS contract on `jscc-dev-ops-state`, with a fixed operator-only `control/v1/deployments/<approval-derived-sha256>.json` path and the existing operator credential. It adds no new IAM grants, storage resource or runtime authority. Actual operator access and object retention/cost must be verified before admission.

The read-only `inspectPairAdmission` captures the previous serving revision, immutable pair and redacted template/policy/Retrieve fingerprints and derives the R6 plan hash. The existing GitHub connector remains the sole authority for remote Git and approval evidence. The authorized operator must independently obtain and verify the owner approval, independent review, build/source/digest provenance, zero-cost admission, maintenance window, rollback authority, scoped access and tagged-revision compatibility, then bind their exact #589 evidence references and the actual approved operator checkout to the canonical evidence bundle. The independent authority must supply its SHA-256 pin separately from the bundle; computing a pin from untrusted incoming data is not approval. The local module verifies integrity/scope and a clean exact local checkout; it does not authenticate GitHub authors or establish billing truth. No live proof-distribution channel or evidence pin is provisioned by this change.

The pinned bundle binds the previous/next images, source, serving revision, tags, configuration fingerprints, protected baseline, catalogs, build ID, plan hash and a bounded validity window. Reserve the approval reference once by create-only CAS before freeze. The deterministic maintenance ID is persisted before lease acquisition. Each R6 callback has a confirmed write-ahead intent and an acknowledged or unknown receipt; a compound gateway callback may include staging and traffic cutover. An uncertain ledger write poisons the session and denies subsequent mutations. R708-F01: evidence expiry denies new admission and forward callbacks (freeze, deploy worker and deploy gateway). In the same admitted session, a confirmed freeze permits paired compensation and restored-pair verification after expiry. A fully acknowledged forward pair may still be verified after expiry; release requires the immediately preceding confirmed verification and the existing owned-generation, drain, protected Retrieve parity and actual pair re-verification. This is completion of the original approved operation, not permission for a new forward step or a restarted operation. Maintenance exclusion must remain in force until verified release or separately authorized recovery; expiry alone does not release a lock. Uncertain journal writes, lost ownership, drift and uncertain release remain fail-closed. A duplicate or restarted operation never redispatches the consumed approval.

`observePairRecovery` reads the existing journal and actual serving/configured pair, protected fingerprint, catalog and matching maintenance lease generation; it reports previous/proposed/mixed-or-drift without mutation. Hash anchors and exact image bindings are persisted, not secret values or raw templates. This is restart diagnosis, **not automatic repair, rollback or release**. The existing exact-record recovery procedure still requires a separately reviewed recovery action, fresh exclusion and current generation evidence. Do not reuse the original forward approval for recovery. No durable recovery execution or automatic resumption is admitted by this slice.

Before live admission verify actual bucket access/lifecycle, independent evidence pin delivery, no replay after record expiry, official Cloud Run v2 client metadata, all tagged revisions, operator/deployer access, cost and independent live acceptance. The private Python RPC also reads the matching persisted intent, exact capture/target, evidence digest, approval-derived identity and step-aware validity window before dispatch; a standalone call without that journal is denied. It remains a trusted operator component, not an independently authenticated service; IAM and the independently delivered pin on the reviewed host remain essential boundaries.
