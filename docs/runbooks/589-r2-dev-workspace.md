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
