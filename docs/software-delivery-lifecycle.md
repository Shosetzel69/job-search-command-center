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

## 2. Canonical flow

```text
Approved + transferred Issue
  -> development branch
  -> DEV verification
  -> freeze CANDIDATE_SHA
  -> TEST exact same SHA
  -> TEST PASS
  -> integrate candidate in main without rewriting it
  -> rollback check + `PROD GO` / `PROD_GO`
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
- checkpoint PASS is a technical verdict that allows continuation only inside the already-approved release mandate; it is not owner authorization;
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
9. PROD requires explicit owner `PROD GO` / `PROD_GO` for the exact FRC.
10. Rollback must be known before PROD deployment.
11. Runtime data are environment-local; DEV/TEST data are never promoted or used as PROD rollback data.
12. LEGACY is excluded from normal release automation.
13. Intermediate TEST checkpoint PASS never authorizes PROD and never replaces the final DEV/TEST evidence required for the FRC.

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

Any failure returns to DEV.

### PROD
Runs only the TEST-passed candidate after explicit AgentFlow `PROD GO` / `PROD_GO` for that FRC.

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

`TEST PASS` is evidence/verdict for the tested SHA. It does not itself create owner authorization or expand the approved scope.

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
- explicit owner `PROD GO` / `PROD_GO` for this FRC.

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

## 7. Minimal Release Record

Every PROD promotion has one short, non-secret record:

```text
Issue / PR
CANDIDATE_SHA
DEV PASS evidence
TEST PASS evidence
Previous PROD SOURCE_SHA / RUNTIME_DATA_SHA
Rollback action/reference
AgentFlow PROD authorization (`PROD GO` / `PROD_GO`) + reference/time
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
