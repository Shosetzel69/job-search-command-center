# Claude QA Runbook - Job Search Command Center

Date: 2026-09-11
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

## Mandatory architecture boundary
Before execution, read `ARCHITECTURE.md` section **19 - Boundary de testare Claude**.

Claude web/browser testing is a supported QA execution mode for this project when the active Claude session exposes browser/web interaction and the capability preflight confirms it. This browser capability is separate from the Remote MCP GitHub integration.

Remote MCP provides repository/issue access. Browser/web interaction provides UI testing. DevTools/network inspection, shell/CLI/Playwright, GitHub Actions access and Cloudflare access are separate capabilities and must not be inferred from browser availability.

A missing executor capability is **BLOCKED**, not a product **FAIL**. Never infer a bug only because the current Claude session cannot perform a step.

## Phase -1 - Capability preflight
Before any product test, report this table:

```markdown
| Capability | Required by tests | Available now | Handling if unavailable |
|---|---|---|---|
| GitHub MCP read_file/get_issue | Yes | YES/NO | BLOCKED if required evidence cannot be obtained |
| Browser/UI interaction | Yes for UI E2E | YES/NO | UI scenarios BLOCKED |
| Target URL accessible in Claude browser | Yes for UI E2E | YES/NO | UI scenarios BLOCKED |
| Existing authenticated browser session | Conditional | YES/NO | OWNER ACTION for login |
| DevTools / Network inspection | Optional | YES/NO | HTTP-level assertions BLOCKED; UI assertion may continue |
| Shell / CLI / Playwright runtime | No for this run | YES/NO | Do not attempt; use CI/other executor |
| GitHub Actions controls/logs | Optional for live-run evidence | YES/NO | Mark corresponding evidence BLOCKED |
| Cloudflare dashboard/logs | Optional | YES/NO | Mark corresponding evidence BLOCKED |
```

Web testing conditions:
- Browser/UI interaction must be available in the current Claude session.
- The target URL must be reachable from that browser.
- Use an existing authenticated session where possible.
- If interactive Google login is required, stop for `OWNER ACTION`; do not request credentials or tokens.
- Browser availability does not imply DevTools/Network/Console access.
- Session state must not be assumed to persist between Claude sessions; perform this preflight every run.

Rules:
- Continue with every scenario that is executable with the capabilities actually available.
- Do not replace unavailable tooling with secrets, tokens or unsupported workarounds.
- If interactive Google login is required, stop for `OWNER ACTION`, then resume after confirmation.
- If a mandatory acceptance assertion cannot be observed, the corresponding result cannot be PASS.
- Use `PASS / FAIL / BLOCKED / N/A` consistently.

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

If browser/UI interaction is unavailable, mark the affected baseline fields `BLOCKED - browser capability unavailable`; do not fabricate values from unrelated repository files.

## Phase 1 - Execute #126 E2E-01 ... E2E-12
Run the scenarios from #126 exactly once and in order, subject to the capability preflight.

Mandatory checks to emphasize:

### E2E-01 Application / protected assets
Requires browser/UI interaction.

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

If DevTools/Network is unavailable, verify only what is observable from the UI. Do not claim an HTTP status that was not observed.

### E2E-02 Admin shell
Requires browser/UI interaction.

Verify:
- Overview
- Actualizare date
- Surse
- Nomenclatoare
- Loguri

### E2E-03 Canonical nomenclatures
Requires browser/UI interaction.

Verify the six domains:
- regions
- countries
- work_modes
- contract_types
- application_statuses
- seniority

Confirm Admin Nomenclatoare is functional, not a static placeholder.

### E2E-04 Geography
Requires browser/UI interaction.

Verify:
- EU, US, ASIA available;
- country selector populated;
- Romania available;
- existing selection loads without loss;
- empty target is blocked;
- include/exclude conflict is blocked;
- do not save invalid states.

### E2E-05 Work modes
Requires browser/UI interaction.

Verify selectable values are exactly normal user choices:
- Remote
- Hibrid
- Onsite

`N/A` must not be a normal selectable option.

Toggle Onsite, Save, verify persistence and zero Full job search. Restore original value and Save again.

### E2E-06 Contract types
Requires browser/UI interaction.

Verify:
- Permanent
- Temporar
- Contract
- Freelance

`unknown` must not be a normal user selection.

Modify one safe selection, Save, verify persistence and zero Full job search. Restore exactly.

### E2E-07 Nomenclature save / zero run
Requires browser/UI interaction.

Use only a safe extensible domain such as `application_statuses`.
If UI allows it, create one temporary unique test value, verify it appears, verify zero Full search, then delete it.
If cleanup fails: STOP CRITICAL.

### E2E-08 Referential integrity
Requires browser/UI interaction. HTTP 409 verification additionally requires request/response inspection.

Attempt a safe deactivation of a currently referenced canonical value only as defined in #126.
Expected: blocked with controlled UI/API behavior; 409 only if the response is actually observable; referenced value remains unchanged.

If UI protection prevents the request, record `PASS-UI-GUARD`. If request/response inspection is unavailable, the HTTP-level assertion is `BLOCKED`, not FAIL.

### E2E-09 Application status compatibility
Requires browser/UI interaction.

Verify existing applications load and `applied` remains valid/displayable.

### E2E-10 Logs / run state
Requires browser/UI interaction.

Verify latest run and history load.
Critical assertion: no navigation, Save, nomenclature or Admin action from this smoke run created a new Full job search.

### E2E-11 Reload/session recovery
Requires browser/UI interaction.

Reload page and verify authenticated app + protected data recover normally with no unintended run.

### E2E-12 Cleanup
Requires the same mutation capability used by prior scenarios.

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

If the session lacks the capability needed to execute the authorized run or observe the required evidence, report `BLOCKED` after authorization; authorization does not create a missing technical capability.

## Phase 3B - Only after `RUN LIVE SEARCH`
Execute exactly one Full job search, only if browser/UI execution is available.

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
12. no duplicate workflow dispatch is observed if that evidence is available.

Do not perform a second live search just to repeat a failed or blocked assertion.

## Phase 4 - Consolidated product report
Return one report, not separate repetitive reports.

Use this format:

```markdown
# Production E2E Consolidated Report

Environment: PROD
URL: https://job-search-command-api.myeboda.workers.dev
Date/time:
Overall: PASS / FAIL / PASS WITH BLOCKED ITEMS

## Capability preflight
| Capability | Available | Notes |
|---|---|---|
| GitHub MCP | | |
| Browser/UI | | |
| Target URL accessible | | |
| Authenticated session | | |
| DevTools/Network | | |
| GitHub Actions evidence | | |
| Cloudflare evidence | | |

| Coverage | Ticket | Result | Evidence / Notes |
|---|---|---|---|
| Master execution | #126 | | |
| Nomenclatures E2E gate | #122 | | |
| Admin 2A gate | #96 | | |
| React/Cloudflare E2E gate | #24 | | |

## Run safety
Baseline run_id:
Final run_id:
Unexpected Full Search triggered: YES / NO / BLOCKED
Authorized live Full Search executed: YES / NO

## Mutations and rollback
List every temporary mutation and confirm exact restoration.

## Defects found
For each observed defect:
- candidate title;
- classification: BUG;
- severity P0/P1/P2/P3;
- ticket/test where discovered;
- exact reproduction steps;
- expected result;
- actual result;
- page/URL;
- HTTP status only if actually observed;
- screenshot/evidence reference if available;
- production data impact;
- reproducible YES/NO.

## Blocked assertions
For each BLOCKED item:
- test ID;
- missing capability;
- why it cannot be validated safely;
- recommended executor/channel for completion.

## Gate recommendation
- #122: CLOSE / KEEP OPEN / BLOCKED
- #96: CLOSE / KEEP OPEN / BLOCKED
- #24: CLOSE / KEEP OPEN / BLOCKED WAITING CAPABILITY OR LIVE RUN
```

Do not speculate about root cause unless supported by evidence.

---

# Phase 5 - Discovery #4 ATS benchmark
This phase is independent from the production E2E.

Before starting, STOP and ask the owner to confirm:
1. the exact CV file/version;
2. the exact JD;
3. permission to upload that CV to the selected external ATS checker.

Continue only after explicit approval and only if the session has the capability required to use the external checker. If not, mark the execution `BLOCKED` and do not request secrets or unsupported access.

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
