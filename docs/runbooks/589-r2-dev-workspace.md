# JSCC #589 — R2 DEV workspace tools (source-only candidate)

**Owner direction:** existing IAM remains unchanged; continue functional development
with **one Google user**, the **one existing JSCC connector**, and existing
DEV Cloud Run Gateway / Workspace Manager / Sandbox Worker. No TEST/PROD.

**Stacked PR:** #596 targets #595 R1-B. The parent PR #595 has an
independent `REVIEW_FAIL` (F1 HIGH project-wide IAM; F2 source correction
and re-review pending). Do not promote either PR to DEV merely because
this R2 source-level test suite passes.

## New MCP capabilities, inherited from existing DEV workspace gateway

All operations are added to `ops/src/dev_workspace.mjs` and therefore
share the existing `jscc.ops.dev` + `jscc.dev.write` OAuth scopes and
`GOOGLE_ALLOWED_SUB` single-user restriction. Nothing grants new GCP
permissions, credentials, Google users, privileged shell or a new connector.

| Tool | Inputs | Outputs |
|---|---|---|
| `workspace_checksum` | `path` | SHA256, size and GCS object generation |
| `workspace_search` | literal `term` (max 100 UTF-8 bytes) | max 40 path/line hits, truncated flag, **no source snippets** |
| `workspace_compare` | `left`, `right` | two hashes and up to 40 changed-line ranges; no source snippets |
| `workspace_replace` | `path`, `old`, `new`, `if_generation_match` | new SHA and generation, only if one unique match and generation has not changed |
| `workspace_delete` | `path`, `if_generation_match` | removal confirmation only for the single exact object at the supplied generation |

The existing `workspace_list_files`, `workspace_read_file`,
`workspace_write_file` and `workspace_run` remain available and their
contracts are not modified.

### Important limits and error semantics

- Scoped to existing GCS workspace prefix `workspace/v3/` (the existing
  backend); paths may not contain `..`, `.git`, `.env`, credentials etc.
- No recursive deletion, no workspace Git commit/push/pull, no multi-file
  deployment, no arbitrary Google Cloud commands.
- Existing caps: 100 files, 128 KiB/file, 2 MiB total snapshot; search
  results capped to 40 occurrences. Compare uses max 2,000 text lines/file.
- `workspace_replace` requires the current generation returned by
  `workspace_read_file` or `workspace_checksum`; unique literal match;
  old/new fragments max 8 KiB each; full updated file max 128 KiB. Stale
  writes return 409 `generation_conflict`. Binary inputs fail closed.
- `workspace_delete` requires a *positive exact generation*, returning
  409 for stale operations and 404 if the exact target is absent.
- Compare returns **ranges and hashes**, not the full textual unified diff,
  to avoid exposing literal source values through a new API. Use existing
  authenticated `workspace_read_file` for line contents where authorized.
- Workspace Manager only handles GCS and orchestration; the existing
  isolated worker still executes code with no ambient cloud credentials.

## Source and build integration

Files added/modified:
- `ops/workspace-manager/service/workspace_ops.py`
- `ops/workspace-manager/service/{manager.py,backend.py}`
- `ops/src/dev_workspace.mjs`
- `ops/workspace-manager/Dockerfile.r2-tools` (overlay on existing
  independently verified immutable Manager image, **not** a new service)
- `ops/workspace-manager/tests/{test_workspace_ops.py,test_workspace_http.py}`
- `ops/test/r2-workspace-tools.test.mjs`
- `.github/workflows/remote-executor-check.yml` (runs both test suites)

To make these available live, BOTH existing **Gateway** (new MCP schema)
and **Workspace Manager** (new API implementation) need source/digest-aligned
immutable image updates; existing Sandbox Worker binary remains unchanged.
Deployment is not atomic across the two Cloud Run services. Coordinate a
maintenance freeze and verify OAuth + legacy four workspace operations before
resuming traffic. Reuse the existing source-admission/build/release gates and
current image lineage. Do not build from arbitrary branch or image tags.

## Review and release gates

1. Independent AgentFlow 1.4 EXACT-FILE review on PR #596 HEAD, including
   authenticated routing, bounded inputs/results, GCS generation preconditions,
   output leakage, endpoint 400/404/409, R33 gateway source parity, and baseline
   Workspace Manager image provenance.
2. All CI checks PASS; in particular both Python and Node tests.
3. Parent #595 F1 HIGH **remains active** while project-level read grants
   remain. The owner elected not to change them. This instruction is **not**
   an independent security REVIEW_PASS and does not remove the finding.
   A reviewer must independently dispose of the risk before any release.
4. Explicit owner approval for any Cloud Build invocation, Cloud Run
   revision/traffic change, main merge or billing-sensitive operation.
5. DEV smoke and rollback proof; no TEST/PROD or Nile schema changes.

**Current status:** SOURCE_IMPLEMENTED, TESTED_IN_CI, NOT_DEPLOYED.

## RE-02 selectable working directory (source only)

`workspace_run` accepts optional `cwd` for all existing tasks. Omit it or pass `"."` for the existing snapshot root; for example:

```json
{"task":"command","argv":["python3","app.py"],"cwd":"src"}
```

The Gateway validates the path syntax, Manager requires an existing directory implied by the exact snapshot files, and Worker independently validates and resolves it inside the fresh temporary snapshot before process launch. Absolute, traversal, restricted, missing and file paths are denied. No directory is created from `cwd` itself; the existing executable allowlist, environment, limits, DEV OAuth scopes and unprivileged execution boundary remain unchanged. Root requests omit the new field on the wire for compatibility with the existing Manager/Worker protocol. A selected subdirectory is **not** supported by the old Worker or Manager; it must fail rather than silently execute in the root.

The consolidated #711 candidate now extends `cloudbuild.workspace-manager-r2.yaml` with the existing Manager and Sandbox Worker immutable-image lineages, a worker overlay (`Dockerfile.r2-worker`), source parity and smoke steps. Historical baseline refs must be verified against the actual serving images before build. Gateway, Manager and Worker require a coordinated source/digest-aligned release and rollback; no build, rollout or live acceptance has been performed by this candidate. Existing cost admission and Retrieve protection remain mandatory.


## RE-02 exact workspace snapshot binding (source only)

The existing list operation returns the SHA256 of a deterministic sorted
manifest of relative paths, byte lengths and per-file content hashes.
An optional `expected_snapshot_sha256` in the existing `workspace_run`
tool binds the manager's bounded snapshot to that pin before dispatch.
The worker independently recomputes it from decoded input and returns
the actual digest; manager and gateway fail closed if the worker result
does not confirm the pin. Legacy unpinned calls remain compatible.
This proves exact workspace bytes, not an authenticated Git SHA or
the provenance of the caller-supplied pin. Coordinated gateway, manager
and worker release and live acceptance remain required.


## RE-02 atomic workspace move (source only)

The new workspace_move operation uses the existing Manager and write scope.
It accepts only a single source and absent destination, with exact source
generation. GCS uses the documented atomic objects/move endpoint only after
verifying the existing bucket supports hierarchical namespace. A flat or
unverified namespace fails closed; there is no non-atomic copy/delete fallback,
new bucket, SDK upgrade or IAM change. Existing GCS layout, cost and permission
admission must be verified before live use. The result confirms destination
generation/content and absence of source; uncertain outcome is not retried.
Reference: https://docs.cloud.google.com/storage/docs/json_api/v1/objects/move

## RE-02 toolchain and transient artifact evidence (source only)

The existing workspace_run admits a fixed toolchain inventory and sh/npx/jq
only as already isolated sandbox executables. No installation or availability
claim for the inherited image: inventory reports actual executable discovery,
not versions or successful tool execution. Optional artifact_paths accepts up
to four paths under artifacts/ only with an exact snapshot pin. The worker
returns only bounded regular-file size/hash metadata, rejects symlinks,
hardlinks and special files, removes its temporary directory before response,
and kills remaining members of the launched process group. No binary export,
GCS persistence, host/container escape proof or network privilege change.
Manager/Gateway bind returned paths and cleanup evidence to the request.

## RE-05 controlled Workspace R2 release (source only)

The existing workspace pair release now has fixed operator actions:
observe_workspace_release and workspace_release_step (stage, tag, cutover,
rollback, retire_tag). Reuse the existing workspace R2 immutable build and
operator approval/claim; every phase binds the current two-service snapshot,
original successful build, exact candidate digests and prior revisions.
No arbitrary service, config or image input. Stage changes image/revision
only, requires revision-pinned existing traffic, tag allocates zero percent,
cutover requires staged health and worker-before-manager, rollback is reverse
order, retire removes only the candidate tag. Validate-only and etag before
one PATCH, bounded LRO polling, effective revision/config/traffic readback;
uncertain receipt requires observation and separately approved rollback, not
retry. Existing manager/worker compatible rollout and independent synthetic
smoke are required; health is not functional acceptance. Private service
invoker, exact scoped update, image/source and existing traffic/URI formats
are live admission gates. No product Service/Search Job, IAM or DB mutation.

## RE-07 isolated Nile testing invocation (source only)

Extend the existing owner issue-comment dispatcher, not GitHub credentials or
GCP Docker privileges: /jscc-nile-ci dev followed by the exact lowercase main
SHA, only on issue #589. It dispatches the existing Validate Command API
workflow in nile_only mode, verifies trusted main SHA again before starting
its pinned official disposable Nile container, reuses mandatory native test
and cleanup gates. Existing GitDeploy requires push, not workflow_dispatch.
The tester owns invocation and review. No managed DB or product deployment,
no new runner, cloud identity or container image. Source changes must first
be independently reviewed and merged; this route has not been invoked.

## RE-05/07/09 product release correlation (source only)

Approved observe_product_release reads the effective Command API revision,
fixed Search and migration Job templates, exact product registry tags and
specified regional successful builds under the existing builder identity.
A fresh same-actor schema_inventory operation must bind the same source and
actual K_REVISION to correlate Nile; legacy or stale evidence stays UNVERIFIED.
The baseline is read twice; Retrieve lock status is metadata only, never a
quiescence guarantee. Missing provider image results stay UNVERIFIED. No
product deployment, migration, lock write, full provenance or release approval.
Existing GitDeploy/GCloudDeploy remains the Service-only release route.

## RE-04/06 version inventories (source only)

Fixed ops package artifact_versions reports bounded digest/SHA-tag metadata;
relatedTags is not a complete reference inventory or deletion authorization.
GCS list_versions admits exact known artifact names, ordinary generations or
staging-only soft-deleted metadata, bounded pagination; ignores prefix siblings.
No media reads, deletes, registry force-delete, or changes to rollback images.
Live access and provider response formats require independent acceptance.
