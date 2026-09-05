# Contracte date JSON

Actualizare: 2026-09-05

## 1. Reguli

Contractele principale folosesc `schema_version = "1.0"`. Timestamp-urile generate de motor sunt UTC ISO-8601.

Frontend-ul valideaza explicit schema pentru `jobs.json`, `run-status.json` si `search-config.json`.

`sources.json` si `applications.json` raman contracte legacy fara `schema_version`.

## 2. `data/jobs.json`

Root principal:

- `schema_version`;
- `generated_at`;
- `freshness_hours`;
- `criteria`;
- `records_inspected`;
- `results`;
- `excluded_count`;
- `jobs`.

Optionale: `collection_freshness_hours`, `incremental_sync`, `expired_pruned`, `jobspipe_usage`.

Joburile pot contine: `id`, `title`, `company`, `fit`, `location`, `mode`, `type`, `age`, `remote`, `b2b`, `repost`, `status`, `pros`, `risks`, `url`, `description`, `date_posted`, `source`, `verified_at`.

`mode` este normalizat la `Remote`, `Hybrid`, `Onsite` sau `N/A`.

## 3. `data/run-status.json`

Campuri principale: `schema_version`, `run_id`, `status`, `started_at`, `completed_at`, `sources`, `records_inspected`, `jobs_published`, `excluded`, `limitations`.

Optionale:

- `source_results`;
- `jobspipe_optimization` pentru Direct;
- `jobspipe_transport` pentru modul efectiv si metadate.

Status: `running`, `completed`, `completed_with_errors`, `failed`.

Esec total nu trebuie sa suprascrie un `jobs.json` valid cu o lista goala falsa.

## 4. `data/search-config.json`

Sursa canonica pentru motor si valorile implicite UI.

Campuri JobsPipe:

- `jobspipe_mode`;
- `jobspipe_apify_max_items_per_run`;
- `jobspipe_credit_budget_per_run`;
- `jobspipe_monthly_credit_guard`;
- `jobspipe_incremental_overlap_minutes`.

Valori curente relevante:

- `freshness_hours = 24`;
- `collection_freshness_hours = 120`;
- `fit_threshold = 80`;
- `rate_min_eur_day = 250`;
- `rate_max_eur_day = 650`;
- `jobspipe_mode = apify`;
- `jobspipe_apify_max_items_per_run = 100`;
- `jobspipe_credit_budget_per_run = 14`;
- `jobspipe_monthly_credit_guard = 950`;
- `jobspipe_incremental_overlap_minutes = 2`;
- `source_strategy = "all active sources equally"`.

## 5. Mapare `PUT /config`

Payload UI -> configuratie:

- `rolePm` -> `role_groups.pm.enabled`;
- `roleDelivery` -> `role_groups.delivery.enabled`;
- `roleService` -> `role_groups.service.enabled`;
- `roleScrum` -> `role_groups.scrum.enabled`;
- `roleProgram` -> `role_groups.program.enabled`;
- `workRemote` -> `work_modes.remote`;
- `workHybrid` -> `work_modes.hybrid`;
- `freshness` -> `freshness_hours`;
- `fitThreshold` -> `fit_threshold`;
- `keepReposts` -> `keep_reposts`;
- `rateMin` -> `rate_min_eur_day`;
- `rateMax` -> `rate_max_eur_day`;
- `immediateStart` -> `immediate_start`;
- `jobspipeMode` -> `jobspipe_mode`;
- `jobspipeApifyMaxItems` -> `jobspipe_apify_max_items_per_run`;
- `jobspipeDirectRunBudget` -> `jobspipe_credit_budget_per_run`;
- `jobspipeDirectMonthlyGuard` -> `jobspipe_monthly_credit_guard`;
- `exclusions` -> `exclusions`.

Compatibilitate legacy: `jobspipeEnabled` este acceptat numai daca `jobspipeMode` lipseste si este convertit la `direct`/`disabled`; campul `jobspipe_enabled` este eliminat din configuratia canonica.

Valori permise:

- `freshness`: 24, 36, 48, 120;
- `jobspipeMode`: `disabled`, `apify`, `direct`;
- `jobspipeApifyMaxItems`: 100-20.000;
- `jobspipeDirectRunBudget`: 1-1.000;
- `jobspipeDirectMonthlyGuard`: 1-100.000.

## 6. `data/search-state.json`

Fisier intern pentru JobsPipe Direct: progres incremental, cursor, watermark, first-seen, estimare quota si circuit breaker. Nu este publicat in Cloudflare Static Assets.

## 7. `data/sources.json`

Catalog UI legacy. `active` poate fi schimbat local; `priority` este legacy si nu controleaza ordinea operationala.

## 8. `data/applications.json`

Contract legacy pentru istoricul aplicarilor. Frontend-ul consuma companie, rol, locatie, data aplicarii, referinta, status, urmatorul status check, URL si ID cand exista.

## 9. Publicare

Static Assets includ `jobs.json`, `run-status.json`, `applications.json`, `sources.json`, `search-config.json`. `search-state.json` este exclus intentionat.
