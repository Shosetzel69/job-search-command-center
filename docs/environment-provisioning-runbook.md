# Environment Provisioning Runbook - DEV / TEST / PROD

Status: Phase 7 PROD migration/bootstrap/deploy executed successfully; final independent QA is pending in #188.
Data initiala: 2026-09-11
Revizie curenta: 2026-09-17
ADR: `docs/adr/ADR-003-environment-isolation.md`
Implementation: #161 #175 #186
Security / G6: #177 #183
Final QA: #188

## 1. Scop si stare curenta

Acest document este contractul operational canonic pentru cele trei medii izolate. El descrie atat arhitectura si regulile permanente, cat si starea reala curenta dupa executia Phase 7.

Starea curenta este:

| Mediu | Runtime repo | Cloudflare target | URL | Search mode | Stare |
| --- | --- | --- | --- | --- | --- |
| DEV | `Shosetzel69/job-search-runtime-dev` | `Job Search DEV` | `https://job-search-command-api.job-search-dev.workers.dev` | `disabled` | operational, validat |
| TEST | `Shosetzel69/job-search-runtime-test` | `Job Search TEST` | `https://job-search-command-api.job-search-test.workers.dev` | `smoke` | operational, validat |
| PROD | `Shosetzel69/job-search-prod` | `Job Search PROD` | `https://job-search-command-api.job-search-prod.workers.dev` | `live` | migration + bootstrap/deploy PASS; final QA pending |
| LEGACY | legacy stack | legacy Cloudflare account | `https://job-search-command-api.myeboda.workers.dev` | legacy | rollback reference; read-only during final QA |

Approved application source:

```text
SOURCE_SHA=1ca1d16f0c2bb0529cf4a91283117a120dfc80fc
```

Trusted control-plane main used for Phase 7 execution:

```text
55ef89ddbbbb27ac1f23c7a66957fc3c5188ce53
```

PROD migration anchors:

```text
initial canonical data migration commit:
56c76e0724af629cb2fdfec19d444008574a5164

current PROD runtime head used by bootstrap/deploy:
f552d5fb958c1559a65f420904b86cc403fd12aa
```

The difference between these two PROD SHAs is intentional: `56c76e...` is the initial canonical data migration commit; `f552d5...` also installs the isolated PROD runtime workflow while preserving the migrated data.

Successful Phase 7 bootstrap/deploy run:

```text
https://github.com/Shosetzel69/job-search-command-center/actions/runs/35247969324
```

That run passed the 58/58 environment/security/Phase-7 contract tests, deployed the dedicated PROD Worker, configured runtime secrets, and converged `/health` to:

```json
{
  "status": "ok",
  "environment": "prod",
  "source_sha": "1ca1d16f0c2bb0529cf4a91283117a120dfc80fc",
  "runtime_repo": "Shosetzel69/job-search-prod",
  "runtime_ref": "main",
  "runtime_data_sha": "f552d5fb958c1559a65f420904b86cc403fd12aa",
  "search_mode": "live",
  "auth_configured": true,
  "github_configured": true
}
```

Phase 7 is therefore no longer blocked on migration or initial deployment. The remaining gate is final QA in #188, including one controlled PROD Full Search, publication/redeploy validation, DEV/TEST regression isolation, and legacy rollback read-only verification.

## 2. Permanent architecture principles

- one source repository: `Shosetzel69/job-search-command-center`;
- three separate runtime repositories;
- three separate target Cloudflare accounts;
- environment-specific GitHub Environments: `dev`, `test`, `prod`;
- separate credentials per environment and role;
- immutable `SOURCE_SHA` for executable application identity;
- `RUNTIME_DATA_SHA` for the exact runtime snapshot served;
- runtime data never promoted DEV -> TEST -> PROD;
- no implicit PROD fallback;
- privileged build/deploy tooling comes from trusted control-plane main, not from candidate payload;
- legacy remains a rollback reference until final owner acceptance and later cleanup decision.

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
dev  -> job-search-runtime-dev  -> SEARCH_MODE=disabled
test -> job-search-runtime-test -> SEARCH_MODE=smoke
prod -> job-search-prod         -> SEARCH_MODE=live
```

UI environment marker behavior:

```text
DEV  -> [DEV]
TEST -> [TEST]
PROD -> no non-production badge
```

The DEV and TEST markers are persistent runtime-derived markers, not manual labels.

## 7. Environment tooling

The shared entry point remains:

```text
scripts/environment.mjs
```

The environment tool provides validation/bootstrap/deploy/status/isolation capabilities without duplicating per-environment logic.

`bootstrap-all` remains structurally DEV + TEST only. It must never silently include PROD.

Historical Phase 6 PROD readiness remains available as a non-mutating control:

```text
PROD Readiness (Non-Mutating)
```

For the executed Phase 7 PROD path, the canonical workflow is now:

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

The workflow:

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

DEV must fail closed for live collection. TEST may perform smoke validation but not live external collection/publication.

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

After any PROD Full Search that publishes a new runtime commit, the dedicated PROD Worker must be redeployed so the static assets and `/health.runtime_data_sha` converge to the new runtime head.

## 10. DEV procedure and final QA expectation

Current state: operational.

Final QA #188 must verify:

- canonical DEV URL loads over HTTPS;
- `/health.environment=dev`;
- runtime repo is `job-search-runtime-dev`;
- `SEARCH_MODE=disabled`;
- persistent `[DEV]` badge;
- authentication/UI smoke passes;
- Full Search is blocked/fails closed;
- PROD final validation does not mutate DEV runtime state.

## 11. TEST procedure and final QA expectation

Current state: operational.

Final QA #188 must verify:

- canonical TEST URL loads over HTTPS;
- `/health.environment=test`;
- runtime repo is `job-search-runtime-test`;
- `SEARCH_MODE=smoke`;
- persistent `[TEST]` badge;
- authentication/UI smoke passes;
- no live external collection or PROD-style publication occurs;
- PROD final validation does not mutate TEST runtime state.

## 12. PROD procedure and final QA expectation

Current state: canonical data migration and initial dedicated PROD deployment are complete.

Remaining QA sequence is defined in #188 and must be executed by Claude without code/config mutation:

1. capture pre-test PROD `/health` and runtime head;
2. verify migrated application/config data sanity;
3. execute exactly one controlled Full Search through normal PROD application flow;
4. record the runtime workflow URL/ID;
5. verify generated contract validation and result publication;
6. verify `job-search-prod/main` advances if a result commit is produced;
7. verify automatic PROD redeploy;
8. verify post-redeploy `/health.runtime_data_sha` equals new runtime head;
9. verify UI/run-history consistency;
10. re-check authentication/protected paths;
11. re-check DEV and TEST isolation;
12. verify legacy rollback endpoint read-only.

The canonical QA ticket is:

```text
#188 [QA][Phase 7] Final validation DEV / TEST / PROD
```

#186 is the orchestration/Phase 7 ticket, not the QA execution ticket.

## 13. Legacy rollback state

Legacy endpoint:

```text
https://job-search-command-api.myeboda.workers.dev
```

The existing legacy deployment remains the rollback reference. During Phase 7 preparation, its Cloudflare Git/build integration was disconnected to freeze the baseline; the deployed legacy Worker was not deleted or repurposed.

Until final QA and owner acceptance:

- legacy is read-only for validation;
- do not deploy to legacy;
- do not change legacy configuration;
- do not add the requested `[LEGACY]` UI marker yet, because that would mutate the rollback baseline;
- do not revoke/delete legacy resources or credentials needed for rollback.

A `[LEGACY]` marker may be added only after final acceptance or through a separate explicit decision that accepts modification of the rollback baseline.

## 14. Rollback

Primary rollback remains operational return to the existing legacy endpoint, not transformation of the new dedicated stack into the legacy architecture.

Rollback conditions include:

- source/runtime identity mismatch;
- auth regression;
- protected data/API exposure;
- failed runtime publication/redeploy;
- unexpected DEV/TEST mutation;
- cross-environment credential access;
- inability to use the dedicated PROD endpoint safely.

No DEV/TEST data may ever be copied into PROD as rollback.

## 15. Final QA and acceptance gate

Current gate position:

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
  -> dedicated PROD bootstrap/deploy PASS (run 35247969324)
  -> #188 final QA  <-- CURRENT
  -> owner final acceptance
  -> observation window
  -> optional legacy cleanup by separate explicit decision
```

#188 may close PASS only when:

- DEV boundary/isolation checks pass;
- TEST smoke/isolation checks pass;
- PROD controlled Full Search publishes and redeploys coherently;
- post-PROD DEV/TEST checks remain unchanged;
- legacy rollback remains available/read-only;
- no unresolved blocker/major defect remains.

## 16. Evidence requirements

Every final validation record must include, without secret values:

- environment URL;
- `/health` JSON;
- `SOURCE_SHA`;
- runtime repo/ref;
- runtime data SHA before/after where relevant;
- search mode;
- badge result;
- auth result;
- workflow URL/run ID;
- screenshots or equivalent browser evidence;
- defects with reproduction steps;
- final verdict.

The authoritative final QA evidence is stored in #188. #186 stays open until #188 reaches an acceptable final verdict and owner acceptance is recorded.
