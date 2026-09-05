# Contracte date JSON

Actualizare: 2026-09-05

## 1. Reguli generale

Contractele principale folosesc `schema_version = "1.0"`.

Timestamp-urile generate de motor sunt UTC, format ISO-8601.

Frontend-ul React valideaza explicit `schema_version` pentru:

- `jobs.json`;
- `run-status.json`;
- `search-config.json`.

`applications.json` si `sources.json` sunt inca pe un contract legacy fara `schema_version`; frontend-ul le parseaza defensiv. Uniformizarea lor la schema versionata ramane un gap tehnic.

## 2. `data/jobs.json`

### Root obligatoriu

- `schema_version`;
- `generated_at`;
- `freshness_hours`;
- `criteria`;
- `records_inspected`;
- `results`;
- `excluded_count`;
- `jobs`.

### Root optional

- `collection_freshness_hours`;
- `incremental_sync`;
- `expired_pruned`;
- `jobspipe_usage`.

### Job - campuri consumate de frontend

- `id` - optional;
- `title`;
- `company`;
- `initial` - optional;
- `fit`;
- `location`;
- `mode`;
- `type` - optional;
- `age` - optional/fallback;
- `remote`;
- `b2b`;
- `repost`;
- `status`;
- `pros`;
- `risks`;
- `url` - optional/null;
- `description`;
- `date_posted`;
- `source`;
- `verified_at` - optional.

### Normalizare UI

`mode` este normalizat la:

- `Remote`;
- `Hybrid`;
- `Onsite`;
- `N/A`.

Frontend-ul calculeaza vechimea din `date_posted`; `age` este fallback.

`description` poate fi sir gol.

`url` poate fi `null`.

## 3. `data/run-status.json`

### Campuri principale

- `schema_version`;
- `run_id`;
- `status`;
- `started_at`;
- `completed_at`;
- `sources`;
- `records_inspected`;
- `jobs_published`;
- `excluded`;
- `limitations`.

### Campuri optionale

- `source_results`;
- `jobspipe_optimization`.

### `source_results[]`

- `connector`;
- `query`;
- `status`;
- `records`;
- `total_available`;
- `error`.

### Status permis

- `running`;
- `completed`;
- `completed_with_errors`;
- `failed`.

### Reguli

- o colectare independenta esuata nu opreste automat celelalte colectari;
- succes partial -> `completed_with_errors`;
- esec total -> `failed`;
- esec total nu trebuie sa suprascrie `jobs.json` valid cu lista goala falsa;
- cand JobsPipe este dezactivat, statusul poate fi `completed` cu `records_inspected=0` si limitare explicita.

## 4. `data/search-config.json`

Este sursa canonica de configuratie pentru motor.

### Campuri curente

- `schema_version`;
- `role_groups`;
- `work_modes`;
- `freshness_hours`;
- `collection_freshness_hours`;
- `fit_threshold`;
- `keep_reposts`;
- `rate_min_eur_day`;
- `rate_max_eur_day`;
- `immediate_start`;
- `search_country_codes`;
- `eligible_remote_country_codes`;
- `work_mode_priority`;
- `source_strategy`;
- `jobspipe_enabled`;
- `jobspipe_credit_budget_per_run`;
- `jobspipe_monthly_credit_guard`;
- `jobspipe_incremental_overlap_minutes`;
- `exclusions`;
- `excluded_company_patterns`;
- `excluded_role_keywords`;
- `deep_erp_terms`.

### Valori curente relevante

- `freshness_hours = 24`;
- `collection_freshness_hours = 120`;
- `fit_threshold = 80`;
- `rate_min_eur_day = 250`;
- `rate_max_eur_day = 650`;
- `jobspipe_enabled = false`;
- `jobspipe_credit_budget_per_run = 14`;
- `jobspipe_monthly_credit_guard = 950`;
- `jobspipe_incremental_overlap_minutes = 2`;
- `source_strategy = "all active sources equally"`.

### `role_groups`

Fiecare grup foloseste:

- `enabled` - boolean;
- `titles` - lista de titluri.

Grupuri curente:

- `pm`;
- `delivery`;
- `service`;
- `scrum`;
- `program`.

### Reguli

- motorul foloseste configuratia la query/filter/scoring;
- frontend-ul foloseste aceeasi configuratie pentru valorile implicite;
- filtrele locale UI nu modifica automat configuratia canonica;
- `PUT /config` modifica numai campurile whitelist;
- secretele nu sunt permise in fisier.

## 5. Mapare `PUT /config`

Payload UI -> configuratie canonica:

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
- `jobspipeEnabled` -> `jobspipe_enabled`;
- `exclusions` -> `exclusions`.

Valori permise pentru `freshness`:

- 24;
- 36;
- 48;
- 120.

## 6. `data/search-state.json`

Fisier intern, nepublicat in Cloudflare Static Assets.

Scop:

- progres incremental JobsPipe;
- cursor backlog;
- watermark;
- first seen pentru joburi fara data utilizabila;
- estimare quota locala;
- circuit breaker provider.

Campuri principale:

- `schema_version`;
- `query_progress`;
- `job_first_seen`;
- `usage`.

Reguli:

- watermark-ul nu avanseaza cat timp exista backlog cursor;
- query esuat nu isi avanseaza watermark-ul;
- consumul estimat se reseteaza la schimbarea lunii UTC;
- daca providerul raporteaza quota exhausted, luna este marcata pentru circuit breaker.

## 7. `data/sources.json`

Contract legacy curent:

```json
{
  "count": 129,
  "sources": []
}
```

Fiecare sursa poate contine:

- `category`;
- `name`;
- `url`;
- `active`;
- `priority` - camp legacy.

Reguli curente:

- fisierul este catalog UI;
- `active` poate fi modificat local in browser;
- schimbarea locala nu controleaza inca connectorii reali;
- `priority` nu este parte din strategia curenta de colectare si nu trebuie interpretat ca prioritate operationala;
- strategia functionala ramane `all active sources equally` dupa implementarea connectorilor.

## 8. `data/applications.json`

Contract legacy curent:

```json
{
  "applications": []
}
```

Campuri consumate de frontend pentru fiecare aplicare:

- `company`;
- `title`;
- `location`;
- `applied_at`;
- `reference`;
- `status`;
- `next_status_check`;
- `url` - optional;
- `id` - optional.

Frontend-ul transforma aplicarile in acelasi model vizual de rand ca joburile.

## 9. Publicare Static Assets

`command-api/scripts/build-static.mjs` copiaza numai:

- `jobs.json`;
- `run-status.json`;
- `applications.json`;
- `sources.json`;
- `search-config.json`.

`search-state.json` este exclus intentionat.

## 10. Compatibilitate

- adaugarea de campuri optionale poate pastra schema `1.0`;
- redenumirea/eliminarea unui camp obligatoriu cere versiune noua;
- uniformizarea `sources.json` si `applications.json` cu `schema_version` trebuie facuta controlat pentru a pastra compatibilitatea frontend.

## 11. Validare

- motorul valideaza configuratia si output-ul principal;
- workflow-ul ruleaza validarea dupa executie;
- frontend-ul valideaza schema pentru jobs/run-status/search-config;
- build-ul Static Assets verifica existenta tuturor fisierelor protejate obligatorii.
