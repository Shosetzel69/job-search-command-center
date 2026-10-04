# Phase 7 Final Environment QA — DEV / TEST / PROD

Status: HISTORICAL
Applicability: HISTORICAL_ONLY

> Retained only as Phase 7 / Cloudflare-era evidence. It is not an authorized current Command API deployment or QA procedure. Current deployment authority is `cloudbuild.promotion.yaml` and `docs/environment-provisioning-runbook.md`.

Status: **canonical execution contract for #188**  
Date: 2026-09-17  
Parent orchestration: #186  
QA execution ticket: #188

## 1. Purpose

This document defines the final independent validation of the three isolated environments after the PROD migration/deployment completed in Phase 7.

Current canonical application URLs:

- DEV: https://job-search-command-api.job-search-dev.workers.dev
- TEST: https://job-search-command-api.job-search-test.workers.dev
- PROD: https://job-search-command-api.job-search-prod.workers.dev
- LEGACY rollback reference (read-only): https://job-search-command-api.myeboda.workers.dev

Approved application source SHA:

`1ca1d16f0c2bb0529cf4a91283117a120dfc80fc`

Successful Phase 7 bootstrap/deploy run:

`35247969324`

PROD bootstrap runtime anchor before the controlled QA Full Search:

`f552d5fb958c1559a65f420904b86cc403fd12aa`

## 2. Current QA state

At the time this contract was written, #188 contains **no executed DEV/TEST/PROD QA evidence yet**. The only existing issue comment is the documentation-baseline refresh after PR #189.

Therefore the execution state is:

`NOT STARTED`

Claude must not infer partial or completed execution from old tickets, old legacy E2E reports, or historical comments elsewhere.

## 3. Executor capability contract

Claude must begin with a capability preflight and mark each capability YES/NO:

- GitHub issue/file read access;
- browser/UI interaction;
- DEV/TEST/PROD URLs reachable;
- authenticated Google session or ability to request owner login action;
- ability to inspect `/health`;
- GitHub workflow/run evidence access;
- ability to write results back to #188.

A missing executor capability is `BLOCKED`, not a product `FAIL`.

Do not request secrets/tokens/cookies. Do not alter source code, GitHub secrets/variables, Cloudflare settings, runtime configuration, or legacy resources during QA.

## 4. Reporting channel — mandatory fallback

Preferred reporting path: add a comment to #188.

If the active Claude GitHub toolset has **no issue-comment action**, Claude must use `update_issue` on #188 and update only a dedicated section named:

`## QA execution report — Claude`

Rules for the fallback:

1. preserve the complete existing issue body;
2. append or replace only the `QA execution report — Claude` section;
3. never use `update_issue` as an experiment on ticket state;
4. do **not** close #188;
5. include the same evidence that would have been posted as a comment.

The issue body is therefore a valid canonical reporting channel when comments are unavailable to the executor.

## 5. Execution order

Run in this exact order:

1. DEV;
2. TEST;
3. PROD pre-search checks;
4. exactly one controlled PROD Full Search;
5. PROD post-search convergence checks;
6. DEV/TEST regression after PROD;
7. LEGACY read-only rollback check.

Do not alternate between environments.

## 6. Common checks — DEV / TEST / PROD

For each environment:

### C1 — URL/TLS/application load

- open the canonical URL;
- verify HTTPS loads without redirect/certificate errors;
- verify application shell renders and no fatal JS error is visible.

### C2 — `/health` identity

Capture the exact JSON and verify:

- `status=ok`;
- correct `environment`;
- correct runtime repo/ref;
- immutable `source_sha`;
- immutable `runtime_data_sha`;
- correct `search_mode`;
- `auth_configured=true`;
- `github_configured=true`.

### C3 — environment marker

- DEV must show persistent `[DEV]`;
- TEST must show persistent `[TEST]`;
- PROD must not show a non-production marker.

Verify persistence after refresh/navigation.

### C4 — authentication boundary

- unauthenticated protected functionality is not usable;
- authorized Google login succeeds;
- authenticated session survives normal refresh/navigation;
- no cross-environment redirect/origin leakage.

### C5 — core UI smoke

Verify implemented pages/features load without fatal error: jobs/review, applications/history, criteria/search configuration, administration/configuration views available to the authorized user.

### C6 — runtime data contract smoke

Verify the UI can load/parse the relevant runtime assets/contracts, including as applicable:

- `jobs.json`;
- `applications.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `nomenclatures.json`;
- `run-status.json`;
- `run-history.json`.

## 7. DEV-specific checks

Expected:

- environment `dev`;
- runtime repo `Shosetzel69/job-search-runtime-dev`;
- `search_mode=disabled`;
- `[DEV]` marker.

Validate:

- live Full Search is unavailable/fails closed;
- no TEST/PROD runtime mutation occurs;
- visible operational data comes from DEV runtime only.

DEV is PASS only if identity, marker, auth/UI smoke and disabled-search boundary all pass.

## 8. TEST-specific checks

Expected:

- environment `test`;
- runtime repo `Shosetzel69/job-search-runtime-test`;
- `search_mode=smoke`;
- `[TEST]` marker.

Validate:

- only the supported smoke path can execute;
- no live external collection / PROD-style publication occurs;
- no PROD runtime mutation occurs;
- TEST does not expose PROD runtime history/data.

TEST is PASS only if identity, marker, auth/UI smoke, smoke-only behavior and isolation all pass.

## 9. PROD pre-search checks

Expected:

- environment `prod`;
- runtime repo `Shosetzel69/job-search-prod`;
- runtime ref `main`;
- search mode `live`;
- source SHA `1ca1d16f0c2bb0529cf4a91283117a120dfc80fc`;
- auth/github configured true;
- no DEV/TEST marker.

Capture `/health` and current `job-search-prod/main` SHA before the controlled run.

### Migrated-data sanity record — exact Atos/Bull anchor

The migration sanity check is the record in `job-search-prod/data/applications.json` with these canonical values:

- company: `Atos / Bull`;
- title: `Project Manager`;
- location: `Timisoara`;
- country: `Romania`;
- applied_at: `2026-09-02`;
- reference: `540300`;
- status: `applied`;
- next_status_check: `2026-09-16`.

The UI wording/formatting may differ, but those semantics must be present. Missing or materially different migrated data is a FAIL for the migration sanity check.

## 10. PROD controlled Full Search

Execute exactly one Full Search through the normal PROD application path/UI. Do not change criteria/config immediately before the run.

Capture:

- start time;
- initiating UI state;
- resulting GitHub runtime workflow URL/ID if available;
- completion status;
- source-level warnings/errors;
- `job-search-prod/main` SHA before and after;
- post-redeploy `/health`.

Expected end-to-end behavior:

1. runtime workflow executes against `job-search-prod`;
2. live collection is attempted using the configured active sources;
3. generated JSON contracts validate;
4. runtime result files publish to `job-search-prod/main`;
5. runtime SHA advances when a publication commit is produced;
6. PROD automatically redeploys that exact runtime snapshot;
7. `source_sha` remains the approved application SHA;
8. `/health.runtime_data_sha` converges to the final runtime head;
9. UI reloads the published snapshot and run history/status coherently;
10. authentication remains functional after redeploy.

Do not execute a second Full Search to repeat a blocked or failed assertion.

## 11. Partial-source failure contract

There is **no numeric source-success threshold in `search-config.json`**.

The canonical runtime behavior is defined in `scripts/job_search.py::write_status`:

- zero successful collection results -> `status=failed`;
- at least one successful collection result plus at least one failed result -> `status=completed_with_errors`;
- no failed collection results -> `status=completed`.

The current PROD `search-config.json` has `jobspipe_mode=disabled`; source selection otherwise follows the active source/runtime configuration.

QA verdict mapping:

- `completed` + valid publication/redeploy/health/UI consistency -> **PASS**;
- `completed_with_errors` + at least one successful collection result + valid publication/redeploy/health/UI consistency + exact failed sources recorded -> **PASS WITH OBSERVATION**;
- `failed`, zero successful collection results, failed publication, failed redeploy, identity mismatch, or stale/unconverged runtime snapshot -> **FAIL**.

Do not invent an additional percentage threshold.

## 12. Post-PROD isolation regression

After the PROD run completes:

- recheck DEV `/health`, runtime SHA and `[DEV]` marker;
- recheck TEST `/health`, runtime SHA and `[TEST]` marker;
- confirm the PROD run changed only `job-search-prod` as expected;
- any unintended DEV/TEST runtime mutation is FAIL.

## 13. LEGACY rollback verification

Legacy URL is read-only during QA:

https://job-search-command-api.myeboda.workers.dev

Verify it remains reachable sufficiently to serve as the rollback reference. Capture available identity/health evidence.

Do not deploy, change config, alter auth, mutate data, reconnect build integration, or add the requested `[LEGACY]` marker during QA.

## 14. Evidence format

Final report must include:

- execution date/time;
- tester `Claude`;
- tooling/capabilities;
- DEV verdict;
- TEST verdict;
- PROD verdict;
- LEGACY read-only verdict;
- overall verdict;
- exact `/health` evidence per environment;
- source/runtime SHA evidence;
- badge/auth/UI results;
- PROD workflow/run evidence;
- runtime SHA before/after PROD Full Search;
- partial-source failures/warnings if any;
- defects with severity, environment, reproduction, expected/actual, evidence and acceptance impact;
- all BLOCKED assertions with missing executor capability.

## 15. Ticket closure ownership

Claude is the **QA executor**, not the gate owner.

Claude must **not close #188 or #186**.

After Claude records the final QA report:

1. orchestration review (ChatGPT/owner) validates the evidence;
2. #188 is closed only after that review accepts PASS / acceptable PASS WITH OBSERVATION;
3. #186 is closed only after #188 is accepted and the owner gives final Phase 7 acceptance.

No legacy cleanup or `[LEGACY]` UI mutation is part of #188.
