# JSCC #589 R4 — pinned GCloud diagnostic script executor (DEV, read-only)

**State:** source implementation; no IAM change, Cloud Build submission, Cloud Run deploy or merge.

## Goal

Run a reviewed, exact-hash Google Cloud diagnostic script from the existing
JSCC connector without owner Cloud Shell instructions. This version implements
**read-only typed Google Cloud API operations**, not a general GCloud CLI
or arbitrary shell. It is intentionally useful under the **existing**
`jscc-diagnostics-dev` worker identity, without additional service accounts
or elevated roles.

The owner instructed that existing project-level IAM stays unchanged.
Independent #595 reviewer F1 HIGH concerning that scope **remains open**.
Development authorization must not be treated as an IAM-risk signoff.

## Entry point

Existing `run_operation` tool; new catalog task
`run_dev_gcloud_script`, class `OBSERVE`.

Exact input:
```json
{
  "work_item_ref": "#589",
  "idempotency_key": "client-unique-key-1234",
  "task": "run_dev_gcloud_script",
  "args": {
    "environment": "dev",
    "script_id": "dev_runtime_build_inventory_v1",
    "script_sha256": "60f9c0f87abd9da979e1dc66c5a5e2580faa5a4483aacb7f3b8bdd2478bea73b",
    "service": "jscc-command-api-dev",
    "buildId": "c5bbfb85-0aab-40c7-aa47-a5589aa9e295"
  }
}
```

`service` may be only one of the four R1-B DEV services.
`buildId` may be only one of the two R1-B reviewed build IDs. The script
ID and SHA256 are exact, case-sensitive catalog constants. Unknown script IDs,
altered manifest bytes, extra request properties and unexpected projects or
environments fail **before any Google Cloud API call**. The worker
independently revalidates the request and file bytes.

## Execution model

Versioned manifest:
`ops/diagnostics/dev-runtime-build-inventory-v1.json`

Worker interpreter:
`ops/diagnostics/dev-gcloud-script-runner.mjs`

Exactly two steps, in order, with the pre-existing read-only Google APIs:

1. Cloud Run v2 `services.get` plus `revisions.get` for effective
   serving revisions (equivalent to narrowly scoped `gcloud run services
   describe` / revision inspection). No template/env value output.
2. Cloud Build v1 `builds.get` for one known build ID (equivalent to
   `gcloud builds describe`). Only build status and immutable registry
   result digests are used. No substitutions or sensitive logs.

Output is a bounded authenticated evidence projection: script SHA, ID, two
steps, selected DEV service, build ID/status, active revision count and a
digest-correlation verdict. The checks are:
`RUNTIME_DIGEST_MATCHES_BUILD_OUTPUT`,
`RUNTIME_BUILD_DIGEST_MISMATCH`,
`BUILD_NOT_SUCCESSFUL`, `BUILD_DIGEST_UNKNOWN`, or
`RUNTIME_IMAGE_UNKNOWN`.

A matching image digest is **not proof of the source SHA**.
`script_source_provenance='UNVERIFIED'` and
`target_source_sha='UNKNOWN'` must remain unchanged until separately
corroborated.

## Preserved boundaries

- One existing Google OIDC subject, one JSCC MCP connector, one Gateway,
  existing fixed diagnostics job and identity.
- Existing `run_operation`/idempotency/dispatch authentication and
  `get_operation` mechanisms.
- No arbitrary shell, generic `gcloud` command, credential retrieval,
  open-ended user-defined script, Cloud Build submission, IAM modification,
  Cloud Run deployment, traffic cutover, TEST/PROD or DB mutation.
- Source via GitHub connector only, no remote Git operations added.
- Script source/hash binding enforced in both gateway task validator
  and worker file digest check.
- Catalog `589-r4-v1` means old worker/new gateway dispatch mismatch
  intentionally fails closed. Deploy requires the reviewed coordinated
  two-image cutover described in `docs/589-R1B-STAGED-ROLLBACK.md`.
- Immutable script is copied into the existing worker Docker image.
- The existing worker service account's read permissions are reused.
  Cross-project Build access is broad in IAM and requires security review.

## Tests and next gates

New tests in `ops/test/r4-pinned-gcloud-script.test.mjs`: SHA manifest,
fixed operation sequence, bad input/TARGET denial, permission failure,
resource mismatch, redaction, source/provenance boundary, catalog mismatch,
and Docker image closure.

**Before release:** independent EXACT-FILE security/source review,
parent #595 F1 disposition, full CI on exact head, runtime E2E with
properly authenticated DEV job, zero-incremental-cost evidence, explicit
owner deployment approval. **No automatic release, even for a green PR.**

**Next functional implementation:** a separate, approved `CHANGE` class
Cloud Build operator and Cloud Run deploy/rollback operator, using distinct
authorized execution boundaries. This read-only script runner must not be
used as an escape hatch to grant the diagnostic worker mutating powers.
