# Environment Provisioning Runbook - DEV / TEST / PROD

Status: DEV / TEST / PROD infrastructure operational. Phase 7 migration/bootstrap/deploy completed; final acceptance/remediation remains tracked separately. Permanent delivery lifecycle is defined by #197.
Data initiala: 2026-09-11
Revizie curenta: 2026-09-25
ADR: `docs/adr/ADR-003-environment-isolation.md`
Delivery lifecycle: `docs/software-delivery-lifecycle.md`
Release record: `docs/release-record-template.md`
Implementation: #161 #175 #186
Security / G6: #177 #183
Delivery governance: #197
Automation alignment: #198
Final Phase 7 QA: #188

## 1. Scop si stare curenta

Acest document este contractul operational pentru cele trei medii izolate si pentru resursele lor. Regulile permanente de promovare software sunt definite in `docs/software-delivery-lifecycle.md`; sectiunile Phase 7 din acest document descriu executia istorica a cutover-ului initial si nu inlocuiesc lifecycle-ul permanent pentru release-urile viitoare.

Starea curenta este:

| Mediu | Runtime repo | Cloudflare target | URL | Search mode | Stare |
| --- | --- | --- | --- | --- | --- |
| DEV | `Shosetzel69/job-search-runtime-dev` | `Job Search DEV` | `https://job-search-command-api.job-search-dev.workers.dev` | `disabled` | operational |
| TEST | `Shosetzel69/job-search-runtime-test` | `Job Search TEST` | `https://job-search-command-api.job-search-test.workers.dev` | `smoke` | operational |
| PROD | `Shosetzel69/job-search-prod` | `Job Search PROD` | `https://job-search-command-api.job-search-prod.workers.dev` | `live` | dedicated stack operational |
| LEGACY | legacy stack | legacy Cloudflare account | `https://job-search-command-api.myeboda.workers.dev` | legacy | rollback/fallback only; outside normal promotion chain |

Approved application source used by the initial Phase 7 cutover:

```text
SOURCE_SHA=1ca1d16f0c2bb0529cf4a91283117a120dfc80fc
```

Trusted control-plane main used for Phase 7 execution:

```text
55ef89ddbbbb27ac1f23c7a66957fc3c5188ce53
```

PROD migration anchors from the initial cutover:

```text
initial canonical data migration commit:
56c76e0724af629cb2fdfec19d444008574a5164

initial dedicated PROD runtime head used by bootstrap/deploy:
f552d5fb958c1559a65f420904b86cc403fd12aa
```

The difference between these two PROD SHAs is intentional: `56c76e...` is the initial canonical data migration commit; `f552d5...` also installs the isolated PROD runtime workflow while preserving the migrated data.

Successful Phase 7 bootstrap/deploy run:

```text
https://github.com/Shosetzel69/job-search-command-center/actions/runs/35247969324
```

That run passed the environment/security/Phase-7 contract tests, deployed the dedicated PROD Worker, configured runtime secrets, and converged `/health` to the approved Phase 7 source/runtime identities.

## 2. Permanent architecture principles

- one source repository: `Shosetzel69/job-search-command-center`;
- three separate runtime repositories;
- three separate target Cloudflare accounts;
- environment-specific GitHub Environments: `dev`, `test`, `prod`;
- separate credentials per environment and role;
- immutable `SOURCE_SHA` / `CANDIDATE_SHA` for executable application identity;
- `RUNTIME_DATA_SHA` for the exact runtime snapshot served;
- runtime data never promoted DEV -> TEST -> PROD;
- no implicit PROD fallback;
- privileged build/deploy tooling comes from trusted control-plane main, not from candidate payload;
- DEV/TEST validate the candidate before final integration to `main`;
- PROD receives the exact TEST-passed candidate after that candidate is integrated/reachable from `main` without rewrite;
- merge and deploy are separate actions;
- rollback readiness is mandatory before PROD;
- legacy remains outside the normal promotion chain until separately retired.

### 2.1 Permanent promotion lifecycle

For all future functional releases, fixes, infrastructure changes and migrations:

```text
approved Issue
  -> development branch
  -> DEV exact SHA
  -> DEV PASS
  -> candidate freeze
  -> TEST exact same SHA
  -> independent TEST PASS
  -> integrate candidate in main without rewrite
  -> PROD preflight + rollback readiness
  -> explicit owner GO
  -> PROD exact same SHA
  -> smoke / acceptance
```

If TEST fails:

```text
TEST FAIL
  -> DEV remediation
  -> new SHA
  -> DEV verification
  -> new candidate freeze
  -> TEST retest
```

Rules:
- no fix is implemented directly in TEST or PROD;
- no squash/rebase of a frozen TEST-passed candidate;
- if post-TEST integration changes the candidate or requires content-changing conflict resolution, TEST PASS is invalidated;
- `main` is not a development/test environment and is not used as a staging area before DEV/TEST validation;
- PROD deploys the exact candidate SHA recorded in the release record, not an arbitrary current `main` HEAD;
- every PROD promotion uses `docs/release-record-template.md` or an equivalent automation-generated record.

Implementation enforcement is tracked in #198.

## 3. Runtime repositories

```text
Shosetzel69/job-search-runtime-dev
Shosetzel69/job-search-runtime-test
Shosetzel69/job-search-prod
```

Canonical runtime structure:

```text
.github/workflows/runtime.yml
data/
  applications.json
  jobs.json
  nomenclatures.json
  run-history.json
  run-status.json
  search-config.json
  search-state.json
  source-categories.json
  sources.json
README.md
```

PROD data was migrated separately from an immutable canonical PROD snapshot. No DEV or TEST operational runtime data is promoted into PROD.

## 4. Cloudflare boundaries

Target accounts:

```text
Job Search DEV
Job Search TEST
Job Search PROD
```

Each environment has its own Worker named:

```text
job-search-command-api
```

Account separation is a primary security boundary. G6 proved the PROD Cloudflare token could access its own target and was denied against DEV, TEST and the legacy account.

Legacy Cloudflare account ID used for that proof:

```text
1c10181de5c9d73957e1947f4411d55b
```

The dedicated PROD account ID is:

```text
05c75e8c6f1e84e2c8b29b941598bd53
```

## 5. GitHub credential model

Secrets per GitHub Environment:

```text
CLOUDFLARE_TOKEN
GH_BOOTSTRAP_TOKEN
GH_RUNTIME_TOKEN
SOURCE_READ_TOKEN
ALLOWED_GOOGLE_SUB
```

Variables per GitHub Environment:

```text
CLOUDFLARE_ACCOUNT_ID
GOOGLE_CLIENT_ID
FRONTEND_ORIGIN
```

Role rules:

- `GH_BOOTSTRAP_TOKEN`: runtime repo bootstrap/configuration only; not installed in Worker;
- `GH_RUNTIME_TOKEN`: only the runtime repository of that environment;
- `SOURCE_READ_TOKEN`: fine-grained source-repository read-only;
- `CLOUDFLARE_TOKEN`: only the intended account/Worker boundary;
- bootstrap/runtime/source-read credentials must be distinct;
- runtime token must not access source repo;
- source-read token must not access runtime repo.

## 6. Environment policies

Canonical mapping:

```text
dev  -> job-search-runtime-dev  -> SEARCH_MODE=disabled  + explicit manual-full
test -> job-search-runtime-test -> SEARCH_MODE=smoke     + explicit manual-full
prod -> job-search-prod         -> SEARCH_MODE=live      + existing policy execution
```

UI environment marker behavior:

```text
DEV  -> [DEV]
TEST -> [TEST]
PROD -> no non-production badge
```

The DEV and TEST markers are persistent runtime-derived markers, not manual labels.

Operational roles:
- DEV = implementation/debugging/technical verification;
- TEST = independent validation only;
- PROD = accepted production release;
- LEGACY = rollback/fallback only.

## 7. Environment tooling

The shared entry point remains:

```text
scripts/environment.mjs
```

The environment tool provides validation/bootstrap/deploy/status/isolation capabilities without duplicating per-environment logic.

`bootstrap-all` remains structurally DEV + TEST only. It must never silently include PROD.

### 7.1 Known lifecycle alignment gap

At the 2026-09-18 architecture review, `.github/workflows/deploy-environment.yml` still requires live DEV/TEST `source_sha` to be reachable from trusted `main`.

This is incompatible with the permanent lifecycle because the intended flow validates a branch candidate in DEV and TEST before final integration into `main`.

Until #198 is implemented and validated:
- this historical guard must not be treated as the canonical future promotion contract;
- no new release process may infer that merge-to-main is required before DEV/TEST;
- trusted control-plane execution from `main` remains required, but candidate payload ancestry to `main` is required only for PROD after TEST PASS/integration.

### 7.2 Historical Phase 6/7 workflows

Historical Phase 6 PROD readiness remains available as a non-mutating control:

```text
PROD Readiness (Non-Mutating)
```

The initial Phase 7 PROD cutover used:

```text
.github/workflows/prod-cutover.yml
```

Workflow display name:

```text
Phase 7 PROD Cutover
```

The successful bootstrap/deploy invocation used:

```text
action=bootstrap-deploy
source_sha=1ca1d16f0c2bb0529cf4a91283117a120dfc80fc
expected_runtime_sha=f552d5fb958c1559a65f420904b86cc403fd12aa
owner_gate=PHASE7_APPROVED
```

The historical workflow:
1. validates explicit Phase 7 authorization;
2. checks out trusted control-plane main;
3. checks out immutable application candidate separately;
4. runs environment/security contract tests;
5. verifies credential boundaries;
6. verifies dedicated PROD Cloudflare target;
7. verifies immutable PROD runtime head;
8. installs/configures isolated PROD runtime workflow;
9. prepares trusted build payload;
10. deploys exact approved application source to dedicated PROD;
11. configures Worker runtime secrets;
12. validates `/health` identity;
13. leaves legacy cleanup outside the workflow.

Future permanent PROD promotion must implement the lifecycle gates from #197/#198 rather than reusing Phase 7 authorization semantics blindly.

## 8. Runtime execution contract

The PROD runtime workflow resides in:

```text
Shosetzel69/job-search-prod/.github/workflows/runtime.yml
```

For PROD live execution it must:

1. receive explicit immutable `source_sha`;
2. check out the caller runtime repository;
3. check out exact application source read-only;
4. check out trusted control-plane main separately;
5. execute live collection only for `APP_ENV=prod` and `SEARCH_MODE=live`;
6. validate generated runtime JSON contract;
7. publish result files only to `job-search-prod`;
8. capture the new runtime repository SHA;
9. rebuild/redeploy only the PROD Worker with that exact runtime snapshot;
10. verify post-redeploy `/health.runtime_data_sha` equals the published runtime SHA.

DEV and TEST fail closed for automatic/heavy collection by default. An authenticated explicit manual operator action may use `execution_mode=manual-full` in the isolated DEV or TEST runtime; no scheduler/push/deploy/save action may select that mode. PROD behavior is unchanged.

## 9. Static build and identity

Build identity must include:

```text
APP_ENV
SOURCE_SHA
RUNTIME_DATA_SHA
```

`/health` is the authoritative runtime identity check and must confirm:

```text
environment
source_sha
runtime_repo
runtime_ref
runtime_data_sha
search_mode
auth_configured
github_configured
```

Candidate identity rule:

```text
DEV /health.source_sha
== TEST /health.source_sha
== PROD /health.source_sha
== release record CANDIDATE_SHA
```

for one successful promotion cycle.

After any PROD Full Search that publishes a new runtime commit, the dedicated PROD Worker must be redeployed so the static assets and `/health.runtime_data_sha` converge to the new runtime head.

## 10. DEV procedure

DEV is the implementation and technical-verification environment.

For a normal change:
1. create/use the approved development branch;
2. deploy an explicit immutable SHA to DEV;
3. verify `/health.source_sha` equals that SHA;
4. execute technical/automated validation;
5. remediate defects in DEV as needed;
6. once stable, freeze the exact candidate SHA;
7. record DEV evidence in the release record;
8. promote that exact candidate to TEST.

DEV never promotes runtime data to TEST/PROD.

## 11. TEST procedure

TEST is independent validation, not implementation.

For a normal change:
1. receive the exact frozen `CANDIDATE_SHA` from DEV;
2. deploy that SHA to TEST;
3. verify `/health.source_sha == CANDIDATE_SHA`;
4. execute explicit QA scenarios;
5. record evidence and verdict;
6. on FAIL, return the defect to DEV;
7. on PASS, freeze QA evidence for that exact SHA and allow release integration review.

Any source/config change that affects candidate behavior after TEST PASS invalidates that PASS unless explicitly shown to be outside candidate payload and covered by the release contract.

## 12. PROD procedure

PROD receives only a TEST-passed candidate.

Before PROD mutation:
1. candidate has TEST PASS evidence;
2. candidate is integrated in `main` without rewrite and remains reachable from `main`;
3. release record is complete through TEST/integration gates;
4. current known-good PROD source/runtime/config/schema anchors are captured;
5. rollback procedure is ready;
6. required backup/restore evidence exists for destructive/non-reversible data/schema changes;
7. PROD target identity is explicit;
8. owner GO is recorded.

Deployment then uses exactly `CANDIDATE_SHA`, followed by production smoke/acceptance and final release-record closeout.

The initial Phase 7 acceptance remains historically tracked in #188/#186; it is not the generic release gate for future changes.

## 13. Legacy rollback state

Legacy endpoint:

```text
https://job-search-command-api.myeboda.workers.dev
```

The existing legacy deployment remains a rollback/fallback reference until separately retired.

Hard rules:
- legacy is outside DEV -> TEST -> PROD;
- do not develop or test against legacy as a normal environment;
- do not deploy normal releases to legacy;
- do not change legacy configuration/data through normal promotion;
- do not repurpose it;
- retirement/cleanup requires a separate explicit decision.

## 14. Rollback

Permanent rollback requirements are defined in `docs/software-delivery-lifecycle.md` and captured per release using `docs/release-record-template.md`.

Minimum before any PROD deployment:
- known-good PROD `SOURCE_SHA`;
- known-good `RUNTIME_DATA_SHA` where applicable;
- previous configuration anchor;
- migration/schema version;
- rollback/redeploy procedure;
- for destructive/non-reversible DB changes: backup file, checksum and demonstrated non-PROD restore.

Rollback conditions include:
- source/runtime identity mismatch;
- auth/security regression;
- critical functional failure;
- protected data/API exposure;
- failed runtime publication/redeploy;
- data/migration integrity failure;
- unexpected DEV/TEST mutation;
- cross-environment credential access;
- inability to use the dedicated PROD endpoint safely.

No DEV/TEST data may ever be copied into PROD as rollback.

The Phase 7-specific legacy fallback procedure remains documented in `docs/prod-cutover-rollback-runbook.md`.

## 15. Historical Phase 7 gate

The initial isolated-PROD cutover followed this historical sequence:

```text
STABILIZATION CLOSED
  -> ADR-003 merged
  -> #161 owner GO
  -> DEV PASS
  -> TEST PASS
  -> PROD readiness PASS
  -> G6 PASS
  -> Phase 7 owner GO
  -> canonical PROD data migration PASS
  -> dedicated PROD bootstrap/deploy PASS
  -> #188 final QA / remediation
  -> owner final acceptance
  -> optional legacy cleanup by separate explicit decision
```

This sequence remains evidence for the initial migration only. Future releases use the permanent G0-G7 lifecycle defined in `docs/software-delivery-lifecycle.md`.

## 16. Evidence requirements

For every future promotion, the release record must include without secret values:
- Issue/PR;
- candidate SHA;
- baseline `main` SHA at candidate freeze;
- DEV deployment/test evidence;
- TEST deployment/QA evidence and verdict;
- post-integration `main` SHA;
- schema/migration/config versions;
- known-good PROD anchors;
- rollback/backup evidence where applicable;
- explicit PROD owner GO;
- PROD deployment run;
- pre/post `/health` identities;
- smoke/acceptance result;
- defects/observations and final state.

Use `docs/release-record-template.md` as the standard checklist until #198 provides equivalent automation-generated evidence.
