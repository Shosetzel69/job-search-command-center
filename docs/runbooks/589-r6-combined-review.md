# JSCC #589 — R6 durable DEV build ledger and paired ops release (source-only)

**Owner direction:** continue source implementation and perform **one combined
independent AgentFlow 1.4 review** spanning R1–R6, rather than separate
incremental PR reviews. Existing Google IAM grants must stay unchanged.
One Google OAuth user, one JSCC connector, existing Cloud Build/Gateway/
diagnostics job/deployer identities. Remote Git remains under the existing
GitHub connector.

## Build operation durability

`ops/control/dev-build-operation-ledger.mjs` provides a source-only internal
operator module, **not a public MCP mutation**. It uses existing
`gcsReadJson`, `gcsWriteJson` (create with `ifGenerationMatch=0`), and
`gcsReplaceJson` (compare-and-swap) against the existing DEV ops bucket.

The operation key binds: opaque hash of the authenticated actor's Google
subject, client idempotency key, and the fixed `dev-ops-build` operation.
Its separate request fingerprint binds exact work item, source SHA and
trusted ref. Plain Google subject or OAuth tokens are not persisted.

The state machine is:
```
RESERVED -> VERIFYING -> SUBMITTED -> WORKING -> SUCCEEDED/FAILED/CANCELLED
                  |             ^
                  v             |
               BLOCKED        (poll)
                  |
       SUBMISSION_UNKNOWN (if dispatch result lost)
```
All transitions are GCS object-generation-bound. Concurrent/double calls
with the same operation key return the existing state **without resubmission**.
A lost acknowledgement or GCS write after dispatch returns
`SUBMISSION_UNKNOWN`, not an automatic retry. A separate authorized operator
must reconcile from Cloud Build logs and build IDs. Existing R5 owner,
source/ref/snapshot, cost and fixed dispatch gates are mandatory.
The ledger's `observeDevBuildOnce` can project the current status of a
**previously tracked** build only with a trusted `getBuild` callback.
It rejects arbitrary build IDs and refuses observation while a submission
is not reconciled.

**No privileged adapter is connected**. The source still cannot submit a
Cloud Build request through the current JSCC connector. Real Cloud Build
submission needs a secure existing operator transport and source/archive
attestation, not IAM escalation of the diagnostics job.

## Paired Cloud Run operations deploy + rollback

`ops/control/dev-ops-pair-deployment.mjs` is a source-only, separately
authorized deployer contract for the **existing paired** `jscc-diagnostics-dev`
Job and `jscc-ops-gateway-dev` Service. This is specifically the
*Remote Executor gateway/worker* deployment lineage, not a product app
deployment.

Inputs require:
- Approved exact 40-character source SHA and owner work-item reference.
- Independently observed **effective** gateway traffic (100% expected
  immutable digest) and the actual diagnostics job image digest.
- Previous and proposed pinned digests for the two fixed repository image
  names under `jscc-shared/jscc-ops`.
- Cryptographic hash of the resulting plan used to bind all subsequent
  trusted callback proofs.
- Authoritative owner approval reference, exact source/image pair validation,
  zero incremental cost admission and immediate preflight of both resources.

The fixed sequence is:
```
preflight -> freeze concurrent ops -> worker Job image -> Gateway image
 -> verify both effective images and operation health -> unfreeze
```
On mutation failure, attempt rollback **both** resources using known-previous
immutable image digests, verify they are restored and unfreeze only on
successful recovery. If rollback is incomplete, remain frozen and return
`ROLLBACK_BLOCKED` / `manual_intervention_required=true`. A freeze
failure is `FREEZE_UNCERTAIN`, not success. This logic is tested with
injected fakes and **must not** be called from the read-only diagnostics
worker.

**Still missing before real deploy:** a durable per-deployment operation
journal and crash recovery, operator-side independent approval verification,
real Cloud Run GET/UPDATE adapters with precise scoped IAM, live smoke/health
and catalog-version rollback evidence. The existing
`scripts/gcp/deploy_remote_executor_dev.sh` currently deploys a worker
Job then a gateway Service. This controller **does not invoke that script**.

## Not included / still blocked

- No mutating Cloud Build or Cloud Run APIs wired to the existing JSCC MCP.
- No new Cloud Run service, Google user, secret or IAM grant.
- No TEST/PROD, Nile migration, GCS application data writes.
- `cloudbuild.promotion.yaml` and `scripts/gcp/promote.sh` both retain
  their intentional `exit 86` blocks. The product application is **not**
  deployable through this ops controller; do not bypass the block.
- PR #595 inherited independent `F1 HIGH` remains unresolved. The owner's
  instruction to keep IAM unchanged **does not** waive the risk or grant
  source-review/deployment authorization.

## Combined review and source-evidence gate

Review the **complete current R1–R6 stack against main**:
- #595 R1 Observer (IAM F1 HIGH, v2 LATEST and sidecar fixes).
- #596 R2 workspace file/search/checksum/diff/patch/delete.
- #597 R3 runtime/build digest and preflight evidence.
- #598 R4 exact-hash read-only GCloud script runner.
- #599 R5 Cloud Build planning and trusted submit/status contract.
- #600 R6 durable build idempotency and paired ops deploy/rollback model.

Independent combined review must audit:
1. Source-to-runtime provenance, R33 live Gateway parity, OAuth/PKCE and
   backward compatibility of the original 7 MCP tools.
2. Actual GCS service account boundaries: existing IAM F1, workspaces,
   job, gateway and delegated operator privilege separation.
3. GCS CAS correctness and crash windows; duplicate suppression, pending
   submission recovery and authenticated actor scope.
4. Real Cloud Run v2 traffic/jobs APIs and Cloud Build immutable digests,
   source archive identity and exact build SA.
5. Owner approvals, cost admission and TEST/PROD denial.
6. Exact immutable image closure and R1–R6 catalog compatibility,
   paired rollout, rollback and failure evidence.
7. Live E2E integration: source-only test suite does not establish real
   Cloud Run/Cloud Build/Nile access or security.

No individual source review is being requested for R6; **single combined
independent verdict** at exact aggregate SHA is requested. An AgentFlow
review PASS for code cannot alone authorize IAM acceptance or cloud mutation.
