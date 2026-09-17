# Software Delivery Lifecycle - DEV -> TEST -> PROD

Status: Canonical process proposal for #197
Owner: project owner
Scope: all functional changes, bug fixes, infrastructure changes and database migrations that can affect application behavior or production state

## 1. Objective

Provide one predictable software-delivery flow with explicit responsibilities, immutable candidate identity, mandatory evidence, controlled promotion and rollback readiness.

The canonical operational flow is:

```text
Approved requirement / defect
        |
        v
Development branch
        |
        v
DEV deployment + technical verification
        |
        v
Candidate freeze
        |
        v
TEST deployment of the exact same candidate
        |
        v
Independent TEST PASS + evidence review
        |
        v
Merge / release authorization
        |
        v
PROD preflight + rollback readiness
        |
        v
Explicit owner GO
        |
        v
PROD deployment of the exact validated candidate
        |
        v
Production smoke / acceptance
        |
        v
Closeout
```

LEGACY is outside this chain and remains rollback/fallback only until separately retired.

## 2. Non-negotiable rules

1. `main` is not a development or debugging environment.
2. No direct write to `main`; all source changes use a dedicated branch and pull request.
3. DEV is the only normal environment where implementation and debugging occur.
4. TEST performs independent validation; fixes are never implemented directly in TEST.
5. A TEST defect returns to DEV. A new code change creates a new candidate and invalidates the previous TEST PASS.
6. PROD receives only a candidate that passed TEST.
7. The same immutable application `CANDIDATE_SHA` must be deployed to DEV, TEST and PROD for one promotion cycle.
8. Runtime data are not promoted DEV -> TEST -> PROD with source code.
9. Merge and deploy are separate actions. A merge to `main` does not authorize or trigger PROD deployment by itself.
10. Deployment may not introduce code or configuration changes that were not part of the approved candidate/release record.
11. Rollback readiness is a prerequisite for PROD, not an incident-time activity.
12. LEGACY receives no normal code/config/data changes and is excluded from normal promotion automation.
13. Any exception requires explicit owner approval and documented risk acceptance.

## 3. Terminology

### Development branch
Dedicated Git branch for one approved Issue/change. The branch is mutable while development is active.

### Candidate SHA
The immutable source commit selected after DEV verification and used for promotion. It is the exact application payload identity.

`CANDIDATE_SHA` and `SOURCE_SHA` are equivalent application identities in the current deployment architecture.

### Candidate freeze
The point after which the selected candidate cannot change. Any source modification produces a new SHA and a new promotion cycle.

### Release record
The permanent non-secret evidence package tying the Issue, PR, candidate, tests, migration/config state, rollback anchors and production deployment together.

### Known-good PROD
The exact production application/config/data anchors verified before a new PROD deployment and usable for rollback.

## 4. Environment roles

### DEV
Purpose: implementation, debugging and first technical validation.

Allowed:
- coding and configuration work authorized by the Issue;
- technical diagnostics;
- unit/integration tests;
- safe DEV data setup;
- repeated deployment of development commits.

Exit condition: one exact commit is technically verified and selected as `CANDIDATE_SHA`.

### TEST
Purpose: independent functional/integration/security validation of the frozen candidate.

Rules:
- TEST receives exactly `CANDIDATE_SHA` from DEV;
- no coding/debug patch is applied directly in TEST;
- QA evidence must identify the candidate SHA;
- TEST PASS is valid only for that SHA and the recorded migration/config version.

If TEST fails:

```text
TEST FAIL
   -> DEV remediation
   -> new SHA
   -> DEV verification
   -> new candidate freeze
   -> TEST retest
```

### PROD
Purpose: serve the accepted software release.

Rules:
- candidate must have TEST PASS;
- release evidence must be reviewed;
- rollback must be ready;
- explicit owner GO is mandatory;
- deployment uses exactly the validated candidate identity;
- only smoke/acceptance validation follows unless a separately approved production test requires more.

### LEGACY
Purpose: temporary rollback/fallback only.

Hard rule: no development, QA, promotion, configuration change, data change or repurposing through the normal lifecycle.

## 5. Canonical gates

| Gate | Name | Required outcome | Mandatory deliverables |
| --- | --- | --- | --- |
| G0 | Requirement approval | Scope authorized | approved Issue, acceptance criteria, architecture decision/ADR when required |
| G1 | Development complete | Implementation complete on branch | code/config/docs, automated tests, implementation notes, PR |
| G2 | DEV PASS | Candidate technically verified in DEV | DEV deploy evidence, tests, `/health` identity where relevant, no unresolved blocker |
| G3 | Candidate freeze | One immutable candidate selected | `CANDIDATE_SHA`, source baseline SHA, PR number, migration/config version, release-record draft |
| G4 | TEST PASS | Exact candidate independently validated | TEST deploy evidence, QA report, defects resolved, exact SHA confirmation |
| G5 | Release approval | Candidate eligible for production | TEST evidence review, clean merge eligibility, final release record, no candidate mutation |
| G6 | PROD readiness / GO | Rollback and target verified | PROD preflight, known-good anchors, backup/restore evidence if required, rollback plan, owner GO |
| G7 | PROD acceptance | Release operationally accepted | deploy run, `/health`, smoke, monitoring check, final release record |

No gate is inferred from a previous phase. Each gate requires its own evidence.

## 6. Source-control contract

### 6.1 Development

Development starts from a verified `main` baseline on a dedicated branch.

Before candidate freeze, the branch must be synchronized with the intended current source baseline and all required CI checks must pass.

### 6.2 Candidate freeze

After DEV PASS:

```text
CANDIDATE_SHA = exact branch HEAD selected for promotion
```

The release record stores:
- candidate SHA;
- baseline `main` SHA used for the final DEV verification;
- Issue and PR;
- relevant schema/config version.

The branch may not be modified while that candidate is under TEST. If it is modified, the previous candidate is retired and the lifecycle returns to DEV.

### 6.3 TEST promotion

TEST must deploy the exact `CANDIDATE_SHA`.

The TEST workflow must not silently substitute:
- current `main`;
- branch HEAD after freeze;
- another merge commit;
- locally modified files.

### 6.4 Merge after TEST PASS

After TEST PASS, the candidate is integrated into `main` without changing the tested candidate identity.

Required rules:
- no squash merge for a frozen candidate;
- no rebase that rewrites the candidate SHA after TEST PASS;
- no manual merge-conflict resolution that changes candidate content after TEST PASS;
- the candidate SHA must remain reachable from the resulting `main` history.

If clean integration cannot be achieved, the candidate is invalidated, synchronized with the new baseline, assigned a new SHA and returned through DEV and TEST.

### 6.5 PROD deployment

PROD deploys `CANDIDATE_SHA`, not an arbitrary current `main` HEAD.

Before deployment automation must verify at minimum:
- candidate SHA is the TEST-passed SHA from the release record;
- candidate SHA is reachable from approved `main` after integration;
- no newer SHA is silently substituted;
- PROD target/environment is explicit;
- rollback anchors are recorded.

`main` is therefore the approved integration/history line; the immutable candidate is the release payload identity.

## 7. Release record

Every promotion to PROD must have one release record containing at least:

```text
Release / Issue ID
PR
CANDIDATE_SHA
baseline main SHA at freeze
post-merge main SHA
DEV deployment/run evidence
DEV verdict
TEST deployment/run evidence
TEST QA ticket/report
TEST verdict
schema/migration version
configuration version/change summary
known-good PROD SOURCE_SHA
known-good PROD RUNTIME_DATA_SHA
known-good PROD config anchor
backup identifier/checksum where required
rollback procedure
PROD preflight evidence
owner GO
PROD deployment run
post-deploy /health identity
smoke/acceptance verdict
final status
```

The record must not contain secret values.

## 8. Rollback contract

Rollback strategy is selected before G6 according to change type.

### 8.1 Code-only change

Minimum rollback:
- known-good PROD `SOURCE_SHA` captured before deploy;
- deployment mechanism capable of redeploying that exact SHA;
- compatible current runtime/config state confirmed.

### 8.2 Configuration change

Minimum rollback:
- previous non-secret configuration/version recorded;
- secret names/scopes verified without recording secret values;
- explicit procedure to restore prior configuration;
- post-restore health verification.

### 8.3 Database/schema change

Preferred strategy: backward-compatible expand/contract migration.

Before PROD:
- migration version recorded;
- application compatibility with old/new schema defined;
- rollback or forward-fix strategy documented;
- for destructive/non-reversible steps, validated backup is mandatory;
- backup file checksum is recorded;
- restore has been demonstrated in a non-PROD target before destructive PROD change.

No destructive schema/data migration may rely on an untested rollback assumption.

### 8.4 Runtime data

DEV/TEST runtime data are never used as PROD rollback data.

If PROD runtime data must be restored, only PROD backup/snapshot/history may be used.

## 9. Stop conditions

Promotion stops immediately when any of these occurs:
- candidate identity mismatch;
- candidate changed after freeze;
- TEST executed against a different SHA;
- TEST has unresolved blocker/major defect;
- merge requires candidate-changing conflict resolution;
- PROD target is ambiguous;
- known-good PROD anchor is missing;
- rollback procedure is undefined;
- destructive DB change has no validated backup/restore path;
- secrets would need to be exposed or committed;
- cross-environment credential/isolation check fails;
- owner GO is missing.

## 10. Production failure handling

If PROD smoke/acceptance fails:

```text
STOP new PROD actions
  -> classify incident
  -> execute predefined rollback when rollback criteria are met
  -> verify restored PROD identity/health
  -> preserve evidence
  -> create/remediate defect in DEV
  -> generate new candidate
  -> DEV -> TEST -> PROD again
```

A production failure does not authorize an ad-hoc patch in PROD or direct change on `main`.

## 11. Hotfix flow

Urgency may shorten elapsed time, but does not remove identity, TEST or rollback controls.

```text
production defect
  -> hotfix Issue
  -> hotfix branch from approved baseline
  -> DEV verification
  -> candidate freeze
  -> targeted TEST validation
  -> release approval + rollback readiness
  -> owner GO
  -> PROD
```

Any deliberately reduced test scope must be recorded as explicit owner risk acceptance. The same immutable candidate rule still applies.

## 12. Responsibilities

### Owner
- approves scope/architecture changes;
- reviews gate evidence where required;
- authorizes PROD;
- accepts explicit residual risk.

### Development executor
- implements only approved scope in DEV;
- produces tests and implementation evidence;
- never fixes directly in TEST/PROD;
- prepares rollback-relevant technical information.

### Independent QA / TEST executor
- validates the exact frozen candidate;
- records reproducible evidence;
- does not modify implementation;
- returns failures to DEV.

### Architecture
- defines boundaries, promotion contract and rollback requirements;
- reviews architectural deviations;
- does not implement code changes in architecture tasks.

## 13. Required automation behavior

Deployment automation must eventually enforce the lifecycle rather than only document it.

Required controls:
- DEV/TEST can deploy an explicit immutable candidate SHA without requiring it to be already merged into `main`;
- TEST promotion proves it is using the frozen DEV candidate;
- PROD requires the TEST-passed candidate identity;
- PROD verifies that candidate is reachable from approved `main` after integration;
- no workflow silently defaults to `main` as payload identity;
- environment is always explicit;
- release/promotion evidence is non-secret and traceable;
- existing environment isolation and trusted-control-plane protections remain intact.

Implementation of these controls is a separate Development task derived from #197.

## 14. Definition of Done for a software change

A change is complete only when:
- approved scope is implemented;
- automated tests are green;
- DEV PASS exists;
- frozen candidate identity is recorded;
- TEST PASS exists for that exact candidate;
- candidate is integrated without mutation;
- rollback readiness was verified before PROD;
- owner GO is recorded;
- PROD runs the exact validated candidate;
- production smoke/acceptance passes;
- release record is complete;
- documentation reflects actual behavior;
- relevant Issues are closed only after acceptance.
