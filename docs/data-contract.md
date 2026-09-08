# Contracte date JSON

Versiune aplicatie: `0.06-dev`
Schema principala: `1.0`
Ultima actualizare: `2026-09-08`

## 1. Reguli

Contractele publicate frontend-ului folosesc `schema_version = "1.0"`.

Frontend-ul si CI valideaza:

- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `applications.json`.

Timestamp-urile generate de motor sunt UTC ISO-8601.

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

Campuri job principale:

- `id`, `title`, `company`, `fit`;
- `location`, `countries`, `country_codes`, `remote_scope`;
- `mode`, `type`, `date_posted`, `age`;
- `remote`, `b2b`, `repost`, `status`;
- `pros`, `risks`, `description`;
- `url`, `source`, `verified_at`.

Campurile geografice istorice pot lipsi temporar pentru joburi pastrate incremental; o rulare noua le normalizeaza.

## 3. `data/run-status.json`

Campuri principale:

- `schema_version`;
- `run_id`, `status`;
- `started_at`, `completed_at`;
- `sources`, `sources_processed`, `failed_sources`;
- `records_inspected`, `jobs_published`, `excluded`;
- `limitations`.

Stari active acceptate de UI:

- `queued`;
- `pending`;
- `running`;
- `in_progress`.

Stari terminale:

- `completed`;
- `completed_with_errors`;
- `failed`.

Campuri aditive pentru observabilitate pot include `source_results` si contoare `sources_*`.

## 4. `data/run-history.json`

```json
{
  "schema_version": "1.0",
  "runs": []
}
```

`runs` contine maximum 10 intrari, cea mai recenta prima.

Campuri uzuale:

- `run_id`, `status`, `trigger`;
- `started_at`, `completed_at`, `duration_seconds`;
- `sources`, `sources_processed`, `failed_sources`;
- `records_inspected`, `jobs_published`, `excluded`;
- `source_results`, `limitations`, `publication`.

## 5. `data/search-config.json`

Sursa canonica pentru criteriile motorului si valorile initiale UI.

Campuri geografice:

- `target_regions`;
- `target_country_codes`;
- `excluded_regions`;
- `excluded_country_codes`;
- `search_country_codes` pentru compatibilitate temporara.

Campuri principale:

- `role_groups`;
- `work_modes`;
- `freshness_hours`;
- `collection_freshness_hours`;
- `fit_threshold`;
- `keep_reposts`;
- `rate_min_eur_day`, `rate_max_eur_day`;
- `immediate_start`;
- `source_strategy`;
- `exclusions`.

JobsPipe:

- `jobspipe_mode`;
- `jobspipe_apify_max_items_per_run`;
- `jobspipe_credit_budget_per_run`;
- `jobspipe_monthly_credit_guard`.

In Package 2 `jobspipe_mode` ramane `disabled`.

## 6. `PUT /config`

Mapare UI principala:

- `rolePm` -> `role_groups.pm.enabled`;
- `roleDelivery` -> `role_groups.delivery.enabled`;
- `roleService` -> `role_groups.service.enabled`;
- `roleScrum` -> `role_groups.scrum.enabled`;
- `roleProgram` -> `role_groups.program.enabled`;
- `workRemote` / `workHybrid` -> `work_modes`;
- `freshness` -> `freshness_hours`;
- `fitThreshold` -> `fit_threshold`;
- `keepReposts` -> `keep_reposts`;
- `rateMin` / `rateMax` -> rate B2B;
- `immediateStart` -> `immediate_start`;
- `targetRegions` / `targetCountries` -> geografie inclusa;
- `excludedRegions` / `excludedCountries` -> geografie exclusa;
- `exclusions` -> reguli textuale aprobate.

Persistarea configuratiei nu porneste full search.

## 7. `data/sources.json`

Root:

- `schema_version`;
- `count`;
- `sources`.

Campuri sursa canonice dupa normalizarea Package 2A:

- `id`;
- `name`;
- `url`;
- `category`;
- `active`;
- `collection_method`;
- `connector_available`;
- `validation_status`;
- `approval_status`;
- `last_validated_at`;
- `validation_reason`.

`validation_status`:

- `pending`;
- `validating`;
- `validated`;
- `requires_connector`;
- `rejected`.

`approval_status`:

- `pending`;
- `approved`;
- `rejected`.

Reguli:

- sursa noua = `pending`, `pending`, `active=false`;
- activarea necesita `validated + approved`;
- aprobarea si activarea sunt actiuni distincte;
- URL duplicat interzis;
- `connector_available` si `collection_method` nu sunt controlate liber de utilizator;
- campul legacy `priority` nu face parte din contractul canonic.

Catalogul legacy poate fi citit si este normalizat compatibil la prima mutatie prin Command API.

## 8. `data/source-categories.json`

Contract:

```json
{
  "schema_version": "1.0",
  "count": 0,
  "categories": []
}
```

Camp categorie:

- `id`;
- `label`;
- `active`;
- `order`.

Reguli:

- `label` este unic case/trim-insensitive;
- o sursa noua/mutata poate folosi numai o categorie existenta si activa;
- redenumirea actualizeaza referintele surselor;
- stergerea este blocata cat timp exista surse asociate.

## 9. `data/applications.json`

Contract:

```json
{
  "schema_version": "1.0",
  "applications": []
}
```

Campuri folosite in prezent:

- `id` optional;
- `company`;
- `title`;
- `location`;
- `countries` optional;
- `applied_at`;
- `reference` optional;
- `status`;
- `next_status_check` optional;
- `url` optional.

## 10. `data/search-state.json`

Fisier intern pentru starea JobsPipe Direct/cursor/usage. Nu este publicat in Cloudflare Static Assets.

## 11. Publicare protected assets

Build-ul publica numai:

- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `applications.json`;
- `sources.json`;
- `source-categories.json`;
- `search-config.json`.

`search-state.json` este exclus intentionat.

## 12. Extensii observabilitate/colectare existente

`source_results` poate include campuri aditive precum:

- `source`, `source_id`, `connector`, `collection_method`;
- `status`, `records`, `error`, `failure_reason`;
- `url`, `web_outcome`;
- `pages_attempted`, `pages_fetched`, `jobs_detected`;
- `limitations`, `page_results`, `queries`.

Lipsa acestor campuri in istoricul vechi ramane compatibila; UI nu inventeaza valori absente.
