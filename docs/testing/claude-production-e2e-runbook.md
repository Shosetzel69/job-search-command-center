# Claude QA Runbook - Job Search Command Center

Date: 2026-09-10
Target PROD: https://job-search-command-api.myeboda.workers.dev

## Execution order

1. `job-search-command-center#126` — `[TEST][TO DO] E2E automat PROD Package 2A8 - executie Claude`
   - This is the master execution ticket.
   - Execute E2E-01 ... E2E-12 once, in order.
   - Do not trigger Full job search during this phase.

2. `job-search-command-center#122` — `[PACKAGE-2A8.6] Migrare si E2E nomenclatoare canonice`
   - Do not rerun the same tests.
   - Evaluate #122 from evidence collected in #126.

3. `job-search-command-center#96` — `[PACKAGE-2A7] E2E controlat Administrare 2A`
   - Do not rerun the same tests.
   - Evaluate #96 from the same #126 evidence, after #122 assessment.

4. `job-search-command-center#24` — `[TEST] Validare E2E release React pe deploy-ul Cloudflare`
   - Reuse all safe smoke evidence from #126.
   - If acceptance still requires a real manual run, STOP and request explicit owner authorization with the exact phrase `RUN LIVE SEARCH`.
   - If authorized, execute exactly one live Full job search and validate the run-specific criteria below.

5. `job-search-discovery#4` — `[TEST/RESEARCH] Benchmark ATS Evidence Engine vs free market ATS checker`
   - Execute only after the product E2E is complete.
   - This is a separate research test, not a PROD regression test.
   - Before uploading any real CV to an external ATS service, STOP and request explicit owner approval and confirmation of the CV + JD pair.

---

# MASTER EXECUTION SCRIPT FOR CLAUDE

You are the independent QA executor for the Job Search Command Center.

## Goal
Validate the currently implemented production version only. Do not test future/unimplemented roadmap items. Do not fix defects during the run.

## Production target
`https://job-search-command-api.myeboda.workers.dev`

## Tickets in scope
- #126 — master PROD E2E execution
- #122 — Package 2A8 E2E gate
- #96 — Package 2A Admin E2E gate
- #24 — React/Cloudflare release E2E gate
- Discovery #4 — ATS benchmark, separate phase

## Hard safety rules
1. Production environment: do not make irreversible changes.
2. During the safe smoke phase, DO NOT click `Ruleaza acum` and DO NOT trigger Full job search.
3. Do not modify Sources or Source Categories.
4. Do not activate/deactivate job sources.
5. JobsPipe must remain disabled.
6. Do not test or implement #49.
7. Any reversible configuration mutation must be recorded before change and restored exactly before the test ends.
8. If rollback fails, STOP immediately and classify CRITICAL.
9. Do not expose tokens, cookies, Authorization headers, private keys, API keys or other credentials.
10. Do not fix defects. Record evidence only.
11. A technical defect in currently implemented functionality must be reported as a BUG candidate, not as a missing test.
12. Do not create or modify GitHub issues during this run unless the owner explicitly asks for that action.

## Phase 0 - Baseline
Before any mutable test, record:
- current visible `Ultima rulare`;
- current run status;
- current `run_id`;
- current `completed_at`;
- current source counts shown in Admin/Logs;
- current geography selections;
- current Remote/Hibrid/Onsite selections;
- current contract type selections.

Call this `BASELINE_RUN_STATE` and `BASELINE_CONFIG_STATE`.

## Phase 1 - Execute #126 E2E-01 ... E2E-12
Run the scenarios from #126 exactly once and in order.

Mandatory checks to emphasize:

### E2E-01 Application / protected assets
- application loads after authentication;
- Joburi noi, De evaluat, Aplicari, Criterii de selectie, Administrare all render;
- no blank page, auth loop, `Not found`, generic data-load error;
- protected runtime assets load successfully, especially:
  - jobs.json
  - run-status.json
  - run-history.json
  - applications.json
  - sources.json
  - source-categories.json
  - search-config.json
  - nomenclatures.json
- Regression #114: `source-categories.json` must not return 404.

### E2E-02 Admin shell
Verify:
- Overview
- Actualizare date
- Surse
- Nomenclatoare
- Loguri

### E2E-03 Canonical nomenclatures
Verify the six domains:
- regions
- countries
- work_modes
- contract_types
- application_statuses
- seniority

Confirm Admin Nomenclatoare is functional, not a static placeholder.

### E2E-04 Geography
Verify:
- EU, US, ASIA available;
- country selector populated;
- Romania available;
- existing selection loads without loss;
- empty target is blocked;
- include/exclude conflict is blocked;
- do not save invalid states.

### E2E-05 Work modes
Verify selectable values are exactly normal user choices:
- Remote
- Hibrid
- Onsite

`N/A` must not be a normal selectable option.

Toggle Onsite, Save, verify persistence and zero Full job search. Restore original value and Save again.

### E2E-06 Contract types
Verify:
- Permanent
- Temporar
- Contract
- Freelance

`unknown` must not be a normal user selection.

Modify one safe selection, Save, verify persistence and zero Full job search. Restore exactly.

### E2E-07 Nomenclature save / zero run
Use only a safe extensible domain such as `application_statuses`.
If UI allows it, create one temporary unique test value, verify it appears, verify zero Full search, then delete it.
If cleanup fails: STOP CRITICAL.

### E2E-08 Referential integrity
Attempt a safe deactivation of a currently referenced canonical value only as defined in #126.
Expected: blocked with controlled UI/API behavior; 409 if request reaches API; referenced value remains unchanged.

### E2E-09 Application status compatibility
Verify existing applications load and `applied` remains valid/displayable.

### E2E-10 Logs / run state
Verify latest run and history load.
Critical assertion: no navigation, Save, nomenclature or Admin action from this smoke run created a new Full job search.

### E2E-11 Reload/session recovery
Reload page and verify authenticated app + protected data recover normally with no unintended run.

### E2E-12 Cleanup
Restore every reversible mutation exactly.
Confirm no `e2e_test_*` value remains.
Confirm sources/categories were not changed.
Confirm final run_id equals baseline run_id.

## Phase 2 - Evaluate #122 and #96 without rerunning tests
Using Phase 1 evidence:

### #122 result
Mark each acceptance item PASS / FAIL / BLOCKED.
Do not rerun equivalent scenarios.

### #96 result
Map the same evidence to #96 acceptance.
Do not rerun equivalent scenarios.

## Phase 3 - Evaluate #24 safe portion
Reuse Phase 1 evidence for:
- protected assets;
- save -> no run;
- geography validation;
- security-visible behavior available from browser;
- logs;
- country display;
- stale UI checks;
- session reload.

If the remaining acceptance requires a real manual run, STOP and ask:

`Owner authorization required. Reply exactly: RUN LIVE SEARCH`

Do not continue until that exact approval is received.

## Phase 3B - Only after `RUN LIVE SEARCH`
Execute exactly one Full job search.

Validate:
1. one explicit UI action creates exactly one run;
2. trigger is `manual-ui`;
3. UI changes immediately to running/queued state;
4. a second run cannot be started while one is active;
5. polling remains active until terminal status;
6. Regression #83: if run exceeds 5 minutes, UI must still track it;
7. refresh during active run must recover current state if safe to perform;
8. terminal status is rendered user-friendly; raw enum strings must not be the primary user-facing message;
9. `Ultima rulare` updates automatically after completion;
10. source counts/logs are coherent with run-status/run-history;
11. results reload after completion;
12. no duplicate workflow dispatch is observed.

Do not perform a second live search just to repeat a failed assertion.

## Phase 4 - Consolidated product report
Return one report, not separate repetitive reports.

Use this format:

```markdown
# Production E2E Consolidated Report

Environment: PROD
URL: https://job-search-command-api.myeboda.workers.dev
Date/time:
Overall: PASS / FAIL / PASS WITH BLOCKED ITEMS

| Coverage | Ticket | Result | Evidence / Notes |
|---|---|---|---|
| Master execution | #126 | | |
| Nomenclatures E2E gate | #122 | | |
| Admin 2A gate | #96 | | |
| React/Cloudflare E2E gate | #24 | | |

## Run safety
Baseline run_id:
Final run_id:
Unexpected Full Search triggered: YES / NO
Authorized live Full Search executed: YES / NO

## Mutations and rollback
List every temporary mutation and confirm exact restoration.

## Defects found
For each defect:
- candidate title;
- classification: BUG;
- severity P0/P1/P2/P3;
- ticket/test where discovered;
- exact reproduction steps;
- expected result;
- actual result;
- page/URL;
- HTTP status if available;
- screenshot/evidence reference;
- production data impact;
- reproducible YES/NO.

## Gate recommendation
- #122: CLOSE / KEEP OPEN
- #96: CLOSE / KEEP OPEN
- #24: CLOSE / KEEP OPEN / BLOCKED WAITING LIVE RUN
```

Do not speculate about root cause unless supported by evidence.

---

# Phase 5 - Discovery #4 ATS benchmark
This phase is independent from the production E2E.

Before starting, STOP and ask the owner to confirm:
1. the exact CV file/version;
2. the exact JD;
3. permission to upload that CV to the selected external ATS checker.

Continue only after explicit approval.

Then use exactly the same CV + JD for:
- internal ATS Evidence Engine evaluation;
- one free external ATS checker.

Compare requirement-by-requirement, not only overall score:
- Required / Preferred;
- mandatory gaps;
- matched/missing skills;
- Experience evidence vs Skills-only;
- years of experience;
- languages/CEFR;
- certifications;
- education;
- title alignment;
- parseability/formatting warnings;
- false positives;
- false negatives;
- explainability.

Return a short side-by-side report and final conclusion:
`no change / adjust algorithm / investigate further`.

Do not change code or ATS contract during the benchmark.
