# Package 2 Technical Decisions

Status: preparation / no runtime implementation.

Issue: #82.

## TD-2.1 - Delivery model
Package 2 is split into small release PRs. No mega-PR.

Order:
1. 2A1 Admin shell + contracts;
2. 2A2 source governance;
3. 2B scheduler;
4. 2C connector coverage;
5. 2D data quality/FIT/UX;
6. 2E ATS v1 parallel after 2C stability.

## TD-2.2 - Frontend structure
Do not add React Router or another frontend dependency.

`frontend/src/main.jsx` is already large. Admin pages are extracted into local React modules/components using current React/Vite dependencies.

No behavior change is allowed in the structural refactor itself.

## TD-2.3 - Canonical source categories
Package 2 requires category management independent of source existence: create empty category, global rename, disable/order and safe delete.

Therefore categories can no longer remain only values derived from `sources[].category`.

Canonical target:
`data/source-categories.json`

Minimum contract:
```json
{
  "schema_version": "1.0",
  "categories": [
    {
      "id": "cat-example",
      "name": "Example",
      "active": true,
      "sort_order": 10
    }
  ]
}
```

`data/sources.json` migrates from free-text `category` to canonical `category_id`.

Migration rules:
- generate one category row for every current distinct canonical category;
- preserve display names;
- map every source to exactly one `category_id`;
- reject orphan category references;
- duplicate category names are checked after trim + case-insensitive normalization;
- category delete is blocked while referenced unless sources are explicitly moved first;
- no second canonical category truth is maintained after migration.

This is source-domain data, not a generic Nomenclatoare table.

## TD-2.4 - Source governance state and connector capability are separate
Minimum source concepts:
- catalog identity;
- governance/validation state;
- active flag;
- connector capability/routing.

`approved` does not imply `active`.
`connector_available` does not imply `approved`.

Activation requires:
1. source approved;
2. executable validated collection path;
3. no explicit operational exclusion.

Target validation statuses:
- `pending`;
- `validating`;
- `validated`;
- `requires_connector`;
- `rejected`;
- `approved`;
- `disabled`.

## TD-2.5 - Connector first, registry second
For ATS/API connectors the mandatory order remains:
```text
implement
 -> mock/unit/integration test
 -> controlled live validation
 -> mark connector capability
 -> approve source
 -> activate source
```

Never activate or rewrite Source Registry first and hope the connector works later.

## TD-2.6 - Workday #60 is not greenfield
Current `main` already contains:
- `scripts/job_search_workday.py`;
- `scripts/test_workday_connector.py`;
- Workday routing in `scripts/source_orchestration.py`.

Package 2 treats #60 as revalidation/completion:
- rerun tests;
- confirm acceptance criteria;
- controlled live validation;
- activate relevant source routes only after validation;
- close #60 when complete.

## TD-2.7 - #49 is coverage/reconciliation, not single-provider architecture
The engine is already catalog-driven and can route multiple connector types.

#49 is redefined around:
- Source Registry / connector registry reconciliation;
- explicit deferred/unsupported/requires_connector state;
- no silently ignored active source;
- real source-level counters;
- controlled multi-source E2E;
- cross-provider dedup dependency #4.

JobsPipe remains disabled.

## TD-2.8 - Scheduler architecture
Use a lightweight GitHub Actions scheduler separate from `job-search-full.yml`.

New canonical file:
`data/automation-config.json`

Target contract:
```json
{
  "schema_version": "1.0",
  "enabled": false,
  "interval_hours": 8,
  "schedule_anchor_at": null,
  "paused_until": null,
  "updated_at": null
}
```

Rules:
- default OFF;
- interval options: 1, 2, 4, 8, 12, 24 hours;
- enabling automation sets `schedule_anchor_at=now`;
- changing interval resets `schedule_anchor_at=now`;
- therefore enable/change does NOT immediately run a search;
- `next_run_at` is derived, not written on every scheduler tick;
- manual runs do not reset automatic cadence;
- scheduled cadence uses the last `trigger=scheduled` run plus interval, with `schedule_anchor_at` as initial/fallback anchor;
- `paused_until` prevents dispatch until the pause expires.

Scheduler tick recommendation: hourly.

Tick algorithm:
```text
read automation config
 -> OFF => exit
 -> paused => exit
 -> derive next_run_at
 -> not due => exit
 -> inspect Full job search queued/in_progress
 -> active => exit/defer
 -> dispatch Full job search(run_trigger=scheduled)
```

Scheduler tick performs zero crawl/provider API calls.

## TD-2.9 - Full-search concurrency
`job-search-full.yml` already has concurrency group `full-job-search` with `cancel-in-progress: false`.

This protects execution but would queue a second dispatch. Package 2 scheduler must still check active/queued runs before dispatch so the product rule remains `one active/requested full run`, not merely `GitHub queues duplicates`.

## TD-2.10 - Automation storage is separate from search criteria
Do not put scheduler policy inside `search-config.json`.

Reason:
- search criteria and execution cadence are separate responsibilities;
- easier API validation and audit;
- lower coupling with manual Save/Run semantics from Package 1.

Suggested API:
- `GET /automation`
- `PUT /automation`

`PUT /automation` persists only and never dispatches full search.

## TD-2.11 - Category and automation writes never trigger full search
The following are configuration operations only:
- source CRUD;
- source approval/validation state updates;
- category CRUD;
- nomenclature CRUD;
- automation ON/OFF/interval/pause changes.

Only:
- explicit `Ruleaza acum` => `manual-ui`;
- scheduler due tick => `scheduled`.

## TD-2.12 - FIT and ATS remain separate
FIT v2:
- deterministic preference/relevance score;
- recalibrated after source/dedup stability;
- no high baseline that makes all filtered jobs high-fit;
- explainable breakdown;
- algorithm versioned.

ATS v1:
- job + selected CV version;
- Required 75 / Preferred 25;
- evidence 1.0 / 0.5 / 0;
- Parseability separate;
- mandatory gaps separate;
- privacy-local single-user storage;
- does not replace FIT.

## TD-2.13 - ATS parser dependency gate
PDF/DOCX parsing may require new browser libraries.

No parser dependency is added implicitly. Before 2E coding:
1. inventory browser-native/minimal options;
2. compare bundle size, parsing quality and privacy;
3. request explicit approval for any new dependency.

## TD-2.14 - No paid provider dependency by default
Package 2 prefers public/free/documented APIs and local deterministic logic.
No new paid API/LLM dependency is introduced without explicit approval.

## TD-2.15 - Active Package 1 run isolation
While the current live Package 1 run is active:
- do not write `main`;
- do not alter `data/*`;
- do not alter Source Registry;
- do not alter full-search workflow;
- Package 2 preparation stays on `feature/package-2-preparation` plus GitHub issue metadata only.
