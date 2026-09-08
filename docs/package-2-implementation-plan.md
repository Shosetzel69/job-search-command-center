# Package 2 Implementation Plan

## Status
Preparation only. No runtime implementation in this branch.

Issue coordonator: #82.

## Entry gate
Runtime development starts only after:
1. current live Package 1 run finishes;
2. results are reviewed;
3. Package 1 live E2E is accepted or remaining blockers are explicitly accepted;
4. explicit GO for Package 2 implementation.

During the active live run, do not modify `main`, `data/*`, `data/sources.json`, `data/search-config.json` or `job-search-full.yml`.

---

# 1. AS-IS revalidation

## 1.1 Source orchestration
Current runner is already catalog-driven:
- `scripts/job_search_runner.py` delegates execution to `scripts/source_orchestration.py`;
- `source_orchestration.py` loads `data/sources.json`;
- it builds a per-source plan;
- routes include web, Jobicy and ATS connectors;
- ATS connectors currently referenced include SmartRecruiters, Workday, Greenhouse, Ashby, Recruitee and BambooHR;
- source counters distinguish configured/active/attempted/succeeded/failed/unsupported/skipped/inactive;
- JobsPipe can remain disabled.

Conclusion: #49 must not be implemented as if the engine still processed only JobsPipe. Its remaining scope is coverage, correctness of routing/statuses and multi-source validation.

## 1.2 Source Registry
`data/sources.json` already contains:
- `schema_version`;
- stable `id`;
- `category`;
- `name`;
- `url`;
- `active`;
- `connector_available`.

Conclusion: #25/#26 are partially implemented and require delta implementation, not full rebuild.

## 1.3 Applications contract
`data/applications.json` still has no `schema_version`.

## 1.4 Frontend
`frontend/src/main.jsx` is a large monolithic file. Package 2 adds several admin screens; further growth in one file creates high rework risk.

Decision: split admin-related UI into local React modules/components using existing dependencies only. Do not introduce React Router or another dependency without explicit approval.

---

# 2. Delivery model

Package 2 is delivered in small release slices. Each slice gets its own implementation branch and PR.

```text
2A1 Contracts + Admin shell
        |
        v
2A2 Sources CRUD + approval + categories + logs
        |
        v
2B Automation scheduler
        |
        v
2C Connectors + registry activation + multi-source validation
        |
        v
2D Dedup + FIT + KPI + release management

2E ATS v1 = parallel track after 2C is stable
```

No single Package 2 mega-PR.

---

# 3. Release 2A1 - Contracts + Admin shell

## Issues
#77, #25, #26, partial #39.

## Scope
1. Add canonical `Administrare` navigation entry.
2. Add pages/components:
   - Overview;
   - Actualizare date;
   - Surse;
   - Nomenclatoare;
   - Loguri.
3. `Surse` contains logical subviews:
   - Surse;
   - Aprobare surse;
   - Categorii surse.
4. Move/reuse existing run controls and logs; do not duplicate business logic.
5. Version data contracts consistently.
6. Migrate `applications.json` to a schema-versioned contract without data loss.
7. Document source state model.

## Proposed source state model
Keep transport capability separate from governance state.

Minimum canonical fields:
- `id`;
- `name`;
- `url`;
- `category_id` or canonical category value during migration;
- `active`;
- `connector_available`;
- `validation_status`;
- `validation_checked_at`;
- `validation_message` sanitized;
- `collection_method` / connector metadata where appropriate.

Governance statuses:
- `pending`;
- `validating`;
- `validated`;
- `requires_connector`;
- `rejected`;
- `approved`;
- `disabled`.

Rules:
- `approved` != `active`;
- connector availability != source approval;
- source activation requires approval and an executable collection path;
- changing registry metadata never triggers full search.

## Frontend refactor boundary
Suggested structure without new dependency:

```text
frontend/src/
  main.jsx
  admin/
    AdminShell.jsx
    AdminOverview.jsx
    DataUpdateAdmin.jsx
    SourcesAdmin.jsx
    SourceApproval.jsx
    SourceCategories.jsx
    Nomenclatures.jsx
    RunLogs.jsx
```

Refactor can be incremental. Existing behavior must remain unchanged before adding features.

## API delta
Command API endpoints should remain authenticated and server-validated.

Candidate contract:
- `GET /sources`
- `POST /sources`
- `PUT /sources/:id`
- `DELETE /sources/:id`
- `POST /sources/:id/validate`
- `POST /sources/:id/approve`
- `POST /sources/:id/reject`
- `POST /sources/:id/activate`
- `POST /sources/:id/disable`

Do not expose GitHub credentials to frontend.

## Tests
- schema migration;
- invalid/duplicate URL;
- stable ID preservation;
- unauthorized/forbidden mutations;
- source approval separate from activation;
- no dispatch after source/admin save;
- frontend loading/empty/error states.

---

# 4. Release 2A2 - Source CRUD + categories + approval + logs

## Issues
#40, #76, #39, #77.

## Source CRUD
- add/edit/delete/toggle in UI;
- canonical persistence via Command API;
- no localStorage as source of truth;
- duplicate URLs blocked after normalization;
- delete requires confirmation;
- removal is real registry removal; Git history keeps technical history.

## Categories
MVP target is explicit canonical category management, not text free-form.

Because #77 requires empty categories/global rename/delete, Package 2 should evolve beyond the #76 derived-only model.

Proposed contract:
- add `data/source-categories.json` only if implementation analysis confirms empty categories/global rename cannot remain safely derived;
- otherwise keep categories embedded in sources for the first sub-release and migrate in a dedicated follow-up.

Decision gate before code: choose one canonical model and update architecture/data-contract first. Do not maintain two competing category truths.

## Approval flow
```text
pending
 -> validating
 -> validated | requires_connector | rejected
 -> approved
 -> active
```

Validation should store:
- URL reachable;
- jobs detectable;
- recommended collection method;
- blocking reason;
- last validation time;
- sanitized result.

Automated validation must not bypass robots/login/CAPTCHA or use undocumented restricted APIs.

## Logs
Integrate existing logs under Administrare.
No duplicate history store.
Keep last 10 runs unless requirement changes.
Show explicit trigger `manual-ui` or `scheduled`.

---

# 5. Release 2B - Automation scheduler

## Issue
#77.

## Architecture decision
Use a lightweight GitHub Actions scheduler separate from the heavy full-search workflow.

Proposed files:
- `data/automation-config.json`;
- `.github/workflows/job-search-scheduler.yml`;
- `scripts/scheduler_tick.py`;
- Command API endpoints for automation config.

Rationale for separate config:
- clean separation between search criteria and execution policy;
- changing schedule does not semantically modify search filters;
- easier validation/versioning;
- lower risk of accidental coupling with `PUT /config`.

No new external service and no new package dependency.

## Automation contract
Minimum:
```json
{
  "schema_version": "1.0",
  "enabled": false,
  "interval_hours": 8,
  "paused_until": null
}
```

`next_run_at` should be derived from configuration + last scheduled run where possible, rather than updated by a no-op scheduler commit every hour.

## Scheduler behavior
Static lightweight schedule, recommended hourly tick:

```text
cron tick
 -> read automation config
 -> if OFF: exit
 -> if paused: exit
 -> calculate due from last scheduled run
 -> if not due: exit
 -> check active full-search run
 -> if active: exit/defer
 -> dispatch job-search-full.yml run_trigger=scheduled
```

The hourly scheduler itself performs no crawl and no provider API call.

## UI
Administrare -> Actualizare date:
- Automation ON/OFF;
- interval 1/2/4/8/12/24h;
- last automatic run;
- next run;
- optional pause until;
- Ruleaza acum remains separate.

Default: OFF.

## Tests
- OFF => zero dispatch;
- ON but not due => zero dispatch;
- due => one dispatch `scheduled`;
- active full run => zero second dispatch;
- interval update => no immediate dispatch;
- config invalid => rejected;
- scheduler tests use mocks only.

---

# 6. Release 2C - Connectors + multi-source coverage

## Issues
#3, #49, #56, #60.

## First action
Inventory current connector code and current registry routes before creating new adapters.
Do not duplicate connectors already present.

Existing code references at least:
- Jobicy;
- SmartRecruiters;
- Workday;
- Greenhouse;
- Ashby;
- Recruitee;
- BambooHR;
- generic web fallback;
- JobsPipe transport, disabled by configuration.

Repository also contains additional connector modules that must be classified as implemented/tested/validated/deferred before use.

## Connector activation rule
Mandatory sequence:
```text
implement
 -> unit/integration tests
 -> controlled live validation
 -> mark connector_available
 -> source approval
 -> activate source
```

Never change Source Registry first for a connector that is not validated.

## Coverage batches
Implement/validate in small batches by transport family:
1. public APIs/feeds;
2. ATS boards;
3. company career sites with reusable connector;
4. generic web fallback eligible sites;
5. blocked/restricted sources remain deferred.

## Status contract
Per source:
- inactive;
- pending;
- completed;
- failed;
- skipped;
- unsupported/deferred;
- blocked;
- no_extractable_jobs;
- partial where applicable.

Run counters must be real and internally consistent.

## #49 redefinition
Success is NOT `sources_processed > 1` alone.
Success requires:
- plan built from catalog;
- multiple independent source routes where available;
- explicit unsupported/deferred reasons;
- source-level failures isolated;
- records per source;
- cross-provider output deduplicated;
- no silent substitutions such as counting an aggregator as all catalog sources.

## JobsPipe
Keep disabled throughout Package 2 unless a separate explicit decision reopens it.

---

# 7. Release 2D - Data quality + FIT + local UX

## Issues
#4, #75, #34, #9.

## Dedup first
Before recalibrating FIT on a broader source set:
- stable cross-provider identity;
- first_seen preserved across runs;
- repost history;
- explicit cross-provider tests.

## FIT v2
FIT remains preference/relevance score, separate from ATS.

Design requirements before code:
- remove high baseline behavior that makes nearly all filtered jobs high-fit;
- separate hard filters from scoring;
- define dimensions and weights;
- explanatory breakdown in UI;
- deterministic versioned algorithm;
- calibration fixture set with expected ordering.

Do not use an LLM for core FIT v2 unless explicitly approved; deterministic/free implementation is preferred.

## KPI filters
Implement locally in frontend only; zero provider request/workflow.

## Release management
Create single technical version source and tags/release notes per published release.

---

# 8. Release 2E - ATS Match v1 parallel track

## Issue
#74.

Start only after 2C source/JD data is stable enough for reliable job details.
Can run in parallel with later 2D work.

## Storage
Single-user local/private storage only.
No real CV in Git, Cloudflare static assets or run logs.

## Functional contract
```text
Job + selected CV version
 -> CV parse
 -> JD Required/Preferred extraction
 -> deterministic ATS v1
 -> score + gaps + evidence + history
```

Scoring:
- Required 75%;
- Preferred 25%;
- Direct evidence 1.0;
- Skills-only 0.5;
- Not found 0;
- Parseability PASS/RISK/FAIL separate from percentage;
- FAIL may return CANNOT VERIFY.

Algorithm must have `algorithm_version`.

## Implementation dependency decision
PDF/DOCX parsing may require browser libraries. Adding dependencies requires explicit approval before implementation. Preparation should identify the minimal viable parser options and security/privacy implications before coding.

---

# 9. Branch and PR strategy

Preparation branch:
- `feature/package-2-preparation`

Suggested implementation branches after GO:
- `feature/package-2a1-admin-contracts`
- `feature/package-2a2-source-governance`
- `feature/package-2b-scheduler`
- `feature/package-2c-connectors-batch-1`
- subsequent connector batch branches;
- `feature/package-2d-data-quality-fit`
- `feature/package-2e-ats-v1`

Each PR:
- references #82 + child issues;
- has `ai-generated` where applicable;
- updates CHANGELOG `[Unreleased]`;
- updates architecture/data contracts when relevant;
- no live full crawl in CI;
- ends with controlled E2E when runtime behavior changes.

---

# 10. Release gates

## Gate 2A
- admin shell works;
- source CRUD canonical;
- no config/source mutation triggers full search;
- security tests green;
- contract migration lossless.

## Gate 2B
- automation OFF validated over at least one scheduler tick;
- automation ON dispatches exactly once when due;
- run trigger is `scheduled`;
- no concurrent full runs.

## Gate 2C
- connector inventory reconciled;
- validated connectors activated only after tests;
- multi-source run counters correct;
- source errors isolated;
- JobsPipe remains disabled.

## Gate 2D
- cross-provider dedup stable;
- FIT v2 calibrated on fixtures;
- KPI filters local-only;
- release version consistent.

## Gate 2E
- CV data remains private/local;
- parser failures are explicit;
- ATS v1 deterministic/versioned;
- no personal CV fixture in repository.

---

# 11. Estimated effort by release

| Release | Estimate |
|---|---:|
| 2A1 Admin + contracts | 12-18h |
| 2A2 Source governance | 14-22h |
| 2B Scheduler | 8-12h |
| 2C Connectors/coverage | 20-32h |
| 2D Dedup/FIT/KPI/release | 12-18h |
| 2E ATS v1 | parallel / 16-26h depending on parser decision |

Roadmap package estimate remains approximately 70-110h for the core medium-term scope; ATS can increase the upper bound depending on parsing implementation.

---

# 12. GO checklist

Before implementation starts:
- [ ] Package 1 current live run completed.
- [ ] Package 1 result review completed.
- [ ] #79/#81 disposition confirmed.
- [ ] #49 updated to current AS-IS.
- [ ] #77 context updated to mark Package 1 trigger work completed.
- [ ] category canonical model decided before 2A2.
- [ ] no new dependency approved implicitly.
- [ ] explicit user GO for first implementation slice.
