# Contracte date JSON

Versiune aplicatie: `0.05`
Schema principala: `1.0`
Ultima actualizare: `2026-09-06`

## 1. Reguli

Contractele principale folosesc `schema_version = "1.0"`. Timestamp-urile generate de motor sunt UTC ISO-8601.

Frontend-ul valideaza explicit schema pentru `jobs.json`, `run-status.json`, `run-history.json` si `search-config.json`.

`applications.json` ramane contract legacy. `sources.json` este acceptat legacy la citire si este normalizat la schema 1.0 la prima modificare persistenta prin Command API.

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

Optionale: `collection_freshness_hours`, `incremental_sync`, `expired_pruned`, `jobspipe_usage`, `excluded_sample`.

Campuri job principale:

- `id`;
- `title`;
- `company`;
- `fit`;
- `location`;
- `countries` - lista completa de tari normalizate;
- `country_codes` - coduri ISO alpha-2;
- `remote_scope` - `Worldwide`, `EU`, `EMEA`, `Country` sau `Unknown`;
- `romania_eligible` pentru joburile Remote;
- `mode` - `Remote`, `Hybrid`, `Onsite`, `N/A`;
- `type`;
- `age`;
- `remote`;
- `b2b`;
- `repost`;
- `status`;
- `pros`;
- `risks`;
- `url`;
- `description`;
- `date_posted`;
- `source`;
- `verified_at`.

Pentru compatibilitate cu joburile istorice retinute incremental, validarea accepta temporar lipsa campurilor geografice noi; la procesarea unei rulari noi acestea sunt adaugate/normalizate.

## 3. `data/run-status.json`

Campuri principale:

- `schema_version`;
- `run_id`;
- `status`;
- `started_at`;
- `completed_at`;
- `sources`;
- `sources_processed`;
- `failed_sources`;
- `records_inspected`;
- `jobs_published`;
- `excluded`;
- `limitations`.

Optionale:

- `source_results`;
- `jobspipe_optimization` pentru Direct;
- `jobspipe_transport` pentru modul efectiv si metadate.

JobsPipe este numarat o singura data in `sources_processed` chiar daca transportul Apify executa mai multe query-uri.

Status: `running`, `completed`, `completed_with_errors`, `failed`.

## 4. `data/run-history.json`

Contract:

```json
{
  "schema_version": "1.0",
  "runs": []
}
```

`runs` contine maximum 10 intrari, cea mai recenta prima.

Campuri intrare:

- `run_id`;
- `status`;
- `trigger`;
- `started_at`;
- `completed_at`;
- `duration_seconds`;
- `transport`;
- `sources`;
- `sources_processed`;
- `failed_sources`;
- `records_inspected`;
- `jobs_published`;
- `excluded`;
- `source_results`;
- `limitations`;
- `publication`.

O intrare vizibila in aplicatie are `publication = "published"`, deoarece istoricul este publicat in acelasi commit de date cu rezultatele si statusul.

## 5. `data/search-config.json`

Sursa canonica pentru motor si valorile implicite UI.

Campuri geografice:

- `target_regions`;
- `target_country_codes`;
- `excluded_regions`;
- `excluded_country_codes`.

Compatibilitate: `search_country_codes` ramane momentan sincronizat cu selectia explicita de tari pentru componentele legacy.

Campuri JobsPipe:

- `jobspipe_mode`;
- `jobspipe_apify_max_items_per_run`;
- `jobspipe_credit_budget_per_run`;
- `jobspipe_monthly_credit_guard`;
- `jobspipe_incremental_overlap_minutes`.

Valori curente relevante:

- `target_regions = []`;
- `target_country_codes = [RO, BE, LU]`;
- `excluded_regions = []`;
- `excluded_country_codes = []`;
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

## 6. Mapare `PUT /config`

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
- `exclusions` -> `exclusions`;
- `targetRegions` -> `target_regions`;
- `targetCountries` -> `target_country_codes` si temporar `search_country_codes`;
- `excludedRegions` -> `excluded_regions`;
- `excludedCountries` -> `excluded_country_codes`.

Valori permise:

- regiuni: `EU`, `US`, `ASIA`;
- tari: coduri ISO alpha-2;
- `freshness`: 24, 36, 48, 120;
- `jobspipeMode`: `disabled`, `apify`, `direct`;
- `jobspipeApifyMaxItems`: 100-20.000;
- `jobspipeDirectRunBudget`: 1-1.000;
- `jobspipeDirectMonthlyGuard`: 1-100.000.

## 7. `data/search-state.json`

Fisier intern pentru JobsPipe Direct: progres incremental, cursor, watermark, first-seen, estimare quota si circuit breaker. Nu este publicat in Cloudflare Static Assets.

## 8. `data/sources.json`

Forma canonica dupa prima modificare persistenta:

- root: `schema_version`, `count`, `sources`;
- sursa: `id`, `name`, `url`, `category`, `active`, `connector_available`.

Reguli:

- ID stabil;
- URL http/https valid;
- URL duplicat interzis;
- `connector_available` nu este setat de utilizator;
- campul legacy `priority` este eliminat la normalizare;
- stergerea este efectiva din registrul curent.

## 9. `data/applications.json`

Contract legacy pentru istoricul aplicarilor. Frontend-ul consuma companie, rol, locatie, data aplicarii, referinta, status, urmatorul status check, URL si ID/campuri geografice cand exista.

## 10. Publicare

Static Assets protejate includ:

- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `applications.json`;
- `sources.json`;
- `search-config.json`.

`search-state.json` este exclus intentionat.
