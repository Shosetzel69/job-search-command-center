# Software Delivery Lifecycle - DEV -> TEST -> PROD

Status: Canonical process for #197; automation enforcement implemented by #198
Owner model: single maintainer
Scope: functional changes, bug fixes, infrastructure changes and database migrations that can affect application behavior or production state

## 1. Goal

Keep release management predictable and safe without creating enterprise-style administration.

The process must answer four questions at any time:

1. What change is being released?
2. What exact code was tested?
3. What exact code is running in PROD?
4. How do we return to the previous known-good PROD state?

## 1.1 Functional verification identity

Deployment functional verification is machine-to-machine and must not depend on a manually refreshed user credential.

- browser/user authentication remains Google Identity Services;
- DEV/TEST/PROD deployment workflows request a short-lived GitHub Actions OIDC token at run time;
- the OIDC audience is `jscc-functional-verification`;
- Worker authorization is restricted to the read-only evidence surface limitata la `GET /data/sources.json`, `GET /data/source-categories.json` si `GET /data/nomenclatures.json` and exact repository/environment/workflow claims;
- no GitHub Environment secret containing a Google user ID token is required for release progression.

## 2. Canonical flow

```text
Approved Issue
  -> development branch
  -> DEV verification
  -> freeze CANDIDATE_SHA
  -> TEST exact same SHA
  -> TEST PASS
  -> integrate candidate in main without rewriting it
  -> rollback check + owner GO
  -> PROD exact same SHA
  -> smoke PASS
  -> close
```

If TEST fails:

```text
TEST FAIL
  -> DEV remediation
  -> new SHA
  -> DEV verification
  -> TEST retest
```

LEGACY stays outside this chain and remains rollback/fallback only until separately retired.

### 2.1 Multi-wave releases: validation checkpoints and Final Release Candidate

A release may contain several implementation/stabilization waves. In that case, TEST can be used as an **intermediate validation checkpoint** before the complete release scope is finished.

Checkpoint flow:

```text
wave scope implemented
  -> DEV verification
  -> freeze CHECKPOINT_SHA
  -> TEST exact same SHA
  -> independent checkpoint verdict
  -> STOP before PROD
  -> next release wave
```

Rules:
- a validation checkpoint is not the Final Release Candidate and cannot receive PROD GO;
- checkpoint PASS authorizes continuation of the release build only;
- checkpoint evidence remains valid evidence for the scope tested at that SHA, but cannot substitute for final DEV/TEST evidence;
- later wave changes may create a different SHA without treating the earlier checkpoint as a failed release candidate;
- a checkpoint failure returns to DEV and requires a new checkpoint SHA before that scope is accepted;
- after all intended release waves are complete, freeze one **Final Release Candidate (FRC)** containing the complete release scope;
- the FRC must execute the full canonical DEV -> TEST -> PROD lifecycle on one immutable SHA;
- only the FRC can produce PROD GO, PROD deployment and the Release Record.

The normal single-change/single-wave lifecycle is unchanged: its first frozen candidate may also be the FRC.

## 3. Non-negotiable rules

1. `main` is not a development, debugging or QA environment.
2. No direct write to `main`; source changes use branch + PR.
3. DEV is the normal implementation/debugging environment.
4. TEST validates the exact candidate; fixes never happen directly in TEST.
5. One immutable candidate SHA is used per validation/promotion cycle. Only a Final Release Candidate is promoted DEV -> TEST -> PROD.
6. Any source change after freeze creates a new candidate and invalidates the previous TEST result.
7. Merge to `main` is separate from PROD deployment and does not authorize PROD.
8. After TEST PASS, candidate integration must preserve the tested commit identity. If squash/rebase/conflict resolution changes it, restart DEV -> TEST with a new SHA.
9. PROD requires explicit owner GO.
10. Rollback must be known before PROD deployment.
11. Runtime data are environment-local; DEV/TEST runtime data are never copied/promoted into another environment or used as PROD rollback data. Allowlisted candidate-managed shared/product data may be reconciled independently from the exact candidate into each environment under section 6.1.
12. LEGACY is excluded from normal release automation.
13. Intermediate TEST checkpoint PASS never authorizes PROD and never replaces the final DEV/TEST evidence required for the FRC.
14. A candidate-managed-data reconciliation conflict is an environment/operational block, not by itself a candidate defect or `TEST_FAIL`; it does not invalidate the frozen `CANDIDATE_SHA` unless resolution requires changing candidate source content.

## 4. Environment roles

### DEV
Implementation, debugging, automated tests and first technical verification.

Exit condition: implementation is stable enough to select one exact `CANDIDATE_SHA`.

### TEST
Independent functional/integration validation of the frozen candidate.

Required:
- exact same `CANDIDATE_SHA` as DEV;
- QA verdict tied to that SHA;
- no unresolved blocker/major defect.

A functional/integration failure of the candidate returns to DEV. A candidate-managed-data reconciliation conflict governed by section 6.1 is instead an environment/operational block: keep the frozen candidate unchanged, resolve reconciliation explicitly, then resume validation. If resolution requires a source change, that change creates a new candidate and restarts DEV -> TEST.

### PROD
Runs only the TEST-passed candidate after owner authorization.

Default post-deploy validation is a small smoke test, not a second full QA cycle.

### LEGACY
Temporary fallback only. No normal code/config/data change.

## 5. Five release gates

### G1 - Scope approved

Minimum:
- approved Issue;
- clear acceptance criteria;
- ADR only if the change alters an architectural boundary.

### G2 - DEV PASS + candidate freeze

Minimum:
- implementation complete on branch;
- required automated tests green;
- DEV verification PASS;
- exact `CANDIDATE_SHA` recorded.

From this point, candidate mutation invalidates the promotion cycle.

### G3 - TEST PASS

Minimum:
- TEST runs the exact frozen candidate;
- expected behavior validated;
- no unresolved blocker/major defect;
- verdict recorded.

### G4 - PROD GO

Minimum:
- TEST-passed candidate integrated in `main` without rewriting it;
- candidate SHA remains reachable from `main`;
- previous known-good PROD `SOURCE_SHA` and `RUNTIME_DATA_SHA` captured;
- rollback action/reference known;
- explicit owner GO.

Additional requirements are conditional:
- config rollback detail only if config changes;
- migration detail only if DB/schema/data changes;
- destructive/non-reversible DB change requires validated backup and non-PROD restore proof.

### G5 - PROD PASS / Close

Minimum:
- PROD runs the expected candidate;
- `/health.source_sha` matches `CANDIDATE_SHA`;
- core smoke PASS;
- release record completed.

The Issue may then close.

## 6. Candidate identity contract

`CANDIDATE_SHA` is the exact application source commit selected after DEV verification for one validation/promotion cycle. In a multi-wave release, an intermediate cycle may use a `CHECKPOINT_SHA`; the final cycle uses the **Final Release Candidate (FRC)** SHA.

For one promotion cycle:

```text
DEV source_sha  = CANDIDATE_SHA
TEST source_sha = CANDIDATE_SHA
PROD source_sha = CANDIDATE_SHA
```

DEV/TEST may deploy this immutable commit before it is merged into `main`.

PROD may deploy it only after TEST PASS and after the same commit is reachable from approved `main` history.

A workflow must never silently replace the requested candidate with current `main`, a later branch HEAD, a merge commit, or local modifications.

For intermediate checkpoints, the equality requirement applies DEV -> TEST for that checkpoint and the cycle stops before PROD. For the FRC, the equality requirement applies DEV -> TEST -> PROD.

## 6.1 Candidate-managed shared/product data contract

When a candidate changes one or more approved shared/product JSON files, functional DEV/TEST validation is valid only after the target environment has reconciled those exact candidate-managed files.

Allowlist:

- `data/sources.json`;
- `data/source-categories.json`;
- `data/nomenclatures.json`.

No other `data/*` file is implicitly promotable.

### Reconciliation identities

For every allowlisted file:

- **RECONCILIATION_BASELINE** = last successfully accepted candidate-managed digest in that environment;
- **CANDIDATE** = content from exact `CANDIDATE_SHA`;
- **RUNTIME** = current content at the environment runtime HEAD.

`main` current content is not the reconciliation baseline. This is distinct from the repository **operational baseline** defined in `GOVERNANCE.md` §3.1.

Initial bootstrap requires an explicit known seed digest set.

An unrecognized or unsupported release-control metadata schema/version fails closed and requires a separately reviewed control-plane contract migration/update before promotion can continue.

### Decision table

- candidate == RECONCILIATION_BASELINE and runtime == RECONCILIATION_BASELINE -> no-op;
- runtime == candidate -> no-op;
- candidate != RECONCILIATION_BASELINE and runtime == RECONCILIATION_BASELINE -> apply candidate;
- candidate == RECONCILIATION_BASELINE and runtime != RECONCILIATION_BASELINE -> preserve runtime;
- candidate != RECONCILIATION_BASELINE and runtime != RECONCILIATION_BASELINE -> conflict, fail closed;
- missing/invalid RECONCILIATION_BASELINE -> fail closed except explicit bootstrap initialization.

No automatic field-level merge is permitted.

Reconciliation is evaluated per file, but application is batch-atomic:

1. capture runtime HEAD and accepted baseline metadata;
2. load allowlisted files from exact candidate SHA;
3. compute all reconciliation decisions without mutation;
4. construct target set and validate schemas plus cross-file referential integrity;
5. on any conflict or validation failure, mutate nothing;
6. otherwise commit all required runtime changes plus release-control metadata against expected runtime HEAD; mark the attempt pending and do not change the accepted reconciliation baseline;
7. capture new `RUNTIME_DATA_SHA`;
8. build/deploy exact candidate using that runtime snapshot;
9. verify health identity and protected functional data;
10. only after successful verification, mark the promotion accepted and update the accepted reconciliation baseline;
11. record promotion evidence.

Candidate code is inert input. Promotion logic, validators, path allowlist and environment credentials come only from trusted control-plane code.

If deployment/verification fails after runtime commit, an automatic compensating revert is allowed only when runtime HEAD is still the promotion commit. If HEAD moved concurrently, no overwrite/reset is allowed; promotion becomes blocked/degraded and requires explicit reconciliation. A failed, reverted or degraded attempt never updates the accepted reconciliation baseline and never silently becomes the next baseline.

### Required evidence when this contract is used

Record at minimum:

- environment;
- trusted control-plane SHA;
- `CANDIDATE_SHA`;
- runtime HEAD before promotion;
- resulting runtime commit / `RUNTIME_DATA_SHA`;
- allowlist version;
- per-file baseline, candidate, runtime-before and runtime-after digests plus action;
- reconciliation verdict;
- schema/referential-integrity validation result;
- deploy/run identity;
- post-deploy `/health.source_sha` and `/health.runtime_data_sha`;
- functional proof that required candidate-managed data are visible;
- revert/rollback result when applicable.

Infrastructure health alone is not functional acceptance when the release claim depends on candidate-managed data.

A reconciliation conflict/block does not by itself produce `TEST_FAIL` and does not invalidate the candidate. Track the work item using the canonical blocked status for its current phase (`DEV_BLOCKED`, `TEST_BLOCKED` or `RELEASE_BLOCKED`) plus an explicit `Blocked by`. `DEGRADED/BLOCKED` and `DEGRADED/STALE_ASSET` describe environment/runtime conditions, not AgentFlow status tokens.

Candidate-managed data are never copied DEV -> TEST -> PROD. TEST and PROD independently reconcile the same exact candidate against their own accepted baseline and runtime state.

## 7. Minimal Release Record

Every PROD promotion has one short, non-secret record:

```text
Issue / PR
CANDIDATE_SHA
DEV PASS evidence
TEST PASS evidence
Candidate-managed runtime promotion evidence, when applicable
Previous PROD SOURCE_SHA / RUNTIME_DATA_SHA
Rollback action/reference
Owner GO
PROD deploy evidence
PROD smoke verdict
```

Only add fields that are actually relevant to the release:
- configuration change/rollback;
- schema/migration version;
- backup identifier/checksum/restore proof;
- release-specific risk or acceptance note.

The record must remain short enough to maintain consistently.

## 8. Rollback

Rollback is prepared before PROD, not invented after failure.

### Normal code release

Minimum:
- previous known-good PROD source identity;
- previous runtime identity where relevant;
- known procedure to redeploy/restore that state.

### Configuration change

Also capture the previous configuration reference and restoration action.

### Database/schema/data change

Use backward-compatible changes where practical.

For destructive/non-reversible changes only:
- backup required;
- checksum verified;
- restore demonstrated in non-PROD before PROD mutation.

DEV/TEST data are never PROD rollback data.

## 9. Production failure

If PROD smoke fails:

```text
STOP
  -> execute predefined rollback when applicable
  -> verify restored PROD identity/health
  -> preserve evidence
  -> fix in DEV
  -> new candidate
  -> DEV -> TEST -> PROD again
```

No ad-hoc PROD patch and no direct `main` fix.

## 10. Hotfix

Urgency may reduce test breadth but not the core controls:

```text
hotfix Issue
  -> DEV
  -> freeze SHA
  -> targeted TEST
  -> rollback check + owner GO
  -> PROD
```

Any reduced test scope is explicitly accepted by the owner.

### 10.1 PROD workflow selection

Operational workflow ownership is explicit:

| Intent | Workflow | Action |
|---|---|---|
| Pre-cutover, non-mutating PROD readiness | `PROD Readiness (Non-Mutating)` | workflow itself |
| Deploy reviewed TEST-passed candidate | `PROD promotion` | `deploy` or `bootstrap-deploy` |
| Verify a candidate/runtime already deployed in PROD | `PROD promotion` | `verify-deployed-status` |

`verify-deployed-status` is not a readiness/preflight action. It fails early with guidance when the requested candidate/runtime is not already deployed.

DEV/TEST post-deploy evidence uses a bounded propagation retry and accepts health only when environment and exact `CANDIDATE_SHA` match. Timeout fails closed.

## 11. Automation enforcement

The permanent artifact chain is:

```text
DEV deploy
  -> promotion-dev-pass
  -> TEST deploy of the same CANDIDATE_SHA
  -> promotion-test-deployed
  -> independent TEST QA
  -> TEST PASS attestation
  -> promotion-test-pass
  -> integrate candidate into main without identity rewrite
  -> PROD promotion + owner GO + rollback preflight
  -> release-record
```

Enforced controls:
- one deployment at a time per environment: `deploy-dev`, `deploy-test`, `deploy-prod`;
- explicit environment and full immutable SHA input;
- exact checkout verification;
- DEV/TEST may use a pre-merge candidate, while trusted deployment tooling remains from `main`;
- TEST requires the DEV PASS artifact for the exact same candidate;
- TEST deployment and independent TEST PASS are separate evidence stages;
- `/health.source_sha` is captured and bound to promotion evidence;
- PROD requires the exact TEST PASS artifact and the same candidate reachable from `main`;
- PROD captures the previous known-good source/runtime anchors before mutation;
- PROD requires rollback reference and explicit `PROD_GO`;
- configuration rollback evidence is required only when configuration is changed;
- destructive DB changes require migration version, immutable backup reference, SHA-256 verification and non-PROD restore evidence;
- no implicit `main` fallback and no merge/push-triggered implicit PROD deployment;
- promotion and release artifacts contain identifiers/evidence only, never secrets.

### GitHub-native AI dispatch

ChatGPT can start the existing canonical DEV/TEST deployment workflow without a manual Actions click by creating an owner-authored GitHub issue/PR comment.

Accepted commands:

```text
/jscc-deploy dev <CANDIDATE_SHA>
/jscc-deploy test <CANDIDATE_SHA> <DEV_EVIDENCE_RUN_ID>
```

The control workflow `.github/workflows/ai-release-dispatch.yml`:
- runs only for comments authored by repository owner `Shosetzel69`;
- parses only the exact commands above;
- accepts only DEV or TEST;
- rejects PROD and malformed commands before dispatch;
- checks out the trusted control-plane from `main`;
- uses the repository `GITHUB_TOKEN` with `actions: write` only to call `workflow_dispatch` on `deploy-environment.yml`;
- hard-binds repository, workflow and ref; no arbitrary workflow selection exists;
- derives DEV traceability from the issue/comment id;
- requires an explicit numeric DEV evidence run id for TEST.

The resulting deployment remains a normal `Environment automation` / `workflow_dispatch` run, so the #198 evidence contract and run-identity checks are unchanged. PROD remains outside this trigger and still requires the dedicated promotion workflow plus owner GO.

Deferred until project scale justifies them:
- canary percentage rollouts;
- release trains;
- CAB/change-board processes;
- multi-person approval chains;
- formal observation windows;
- complex release classification/scoring.

## 12. Definition of Done

For a multi-wave release, checkpoint PASS means only that the tested wave/scope is accepted to continue building the release. The release itself is complete only after the FRC completes the full lifecycle below.

A software release/change is complete when:
- approved scope is implemented;
- DEV PASS exists;
- one frozen candidate SHA is recorded;
- TEST PASS exists for that exact SHA;
- candidate is integrated without identity rewrite;
- rollback is known;
- owner GO is recorded;
- PROD runs the exact candidate;
- smoke passes;
- minimal Release Record is complete;
- relevant documentation reflects actual behavior.

Automation enforcement is implemented by #198 and must pass its fail-closed promotion tests before acceptance.
