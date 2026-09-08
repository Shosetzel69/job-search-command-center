# Contracte date JSON

Versiune aplicatie: `0.06-dev`
Schema principala: `1.0`
Ultima actualizare: `2026-09-09`

## 1. Reguli generale

Contractele runtime publicate frontend-ului folosesc `schema_version = "1.0"`.

Protected runtime contracts:
- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `nomenclatures.json`;
- `applications.json`.

Manifestul canonic pentru publicare/protectie este `shared/runtime-data.mjs`.
`search-state.json` este intern si nu este publicat.

## 2. `data/jobs.json`

Root minim:
- `schema_version`;
- `generated_at`;
- `freshness_hours`;
- `criteria`;
- `records_inspected`;
- `results`;
- `excluded_count`;
- `jobs`.

Job:
- `id`, `title`, `company`, `fit`;
- `location`, `countries`, `country_codes`, `remote_scope`;
- `mode`, `date_posted`, `age`;
- `contract_type`;
- `employment_type_raw`;
- `remote`, `b2b`, `repost`, `status`;
- `pros`, `risks`, `description`;
- `url`, `source`, `verified_at`.

`contract_type` foloseste:
- `permanent`;
- `temporary`;
- `contract`;
- `freelance`;
- `unknown` numai ca valoare tehnica cand clasificarea nu este sigura.

`employment_type_raw` pastreaza valoarea provider-specific pentru trasabilitate.

## 3. `data/run-status.json`

Campuri principale:
- `schema_version`;
- `run_id`, `status`;
- `started_at`, `completed_at`;
- `sources`, `sources_processed`, `failed_sources`;
- `records_inspected`, `jobs_published`, `excluded`;
- `limitations`.

Stari active UI: `queued`, `pending`, `running`, `in_progress`.
Stari terminale: `completed`, `completed_with_errors`, `failed`.

## 4. `data/run-history.json`

```json
{
  "schema_version": "1.0",
  "runs": []
}
```

Maximum 10 rulari, cea mai recenta prima.

## 5. `data/search-config.json`

Sursa canonica pentru selectiile efective ale motorului. Valorile controlate sunt definite de `data/nomenclatures.json`.

Geografie:
- `target_regions`;
- `target_country_codes`;
- `excluded_regions`;
- `excluded_country_codes`;
- `search_country_codes` - compatibilitate temporara.

Work modes:

```json
{
  "work_modes": {
    "remote": true,
    "hybrid": true,
    "onsite": false
  }
}
```

Tipuri contract:

```json
{
  "contract_types": ["permanent", "temporary", "contract", "freelance"]
}
```

`unknown`/`N/A` nu sunt optiuni normale de selectie.

Alte campuri principale:
- `role_groups`;
- `freshness_hours`, `collection_freshness_hours`;
- `fit_threshold`;
- `keep_reposts`;
- `rate_min_eur_day`, `rate_max_eur_day`;
- `immediate_start`;
- `source_strategy`;
- `exclusions`.

JobsPipe ramane `disabled` in Package 2.

## 6. `data/nomenclatures.json`

Root:

```json
{
  "schema_version": "1.0",
  "domains": {}
}
```

Domenii obligatorii:
- `regions`;
- `countries`;
- `work_modes`;
- `contract_types`;
- `application_statuses`;
- `seniority`.

Domeniu:
- `kind`: `system` sau `extensible`;
- `extensible`: boolean coerent cu `kind`;
- `values`: lista valorilor;
- optional `technical_values`.

Valoare:
- `code` stabil;
- `label` user-friendly;
- `active`;
- `sort_order`;
- optional `aliases`;
- optional `country_codes` pentru membership regional.

### Reguli system / semantic

Initial system:
- regions;
- countries;
- work_modes;
- contract_types;
- seniority.

Pentru acestea:
- codul nu se modifica;
- Add/Delete sunt blocate;
- label/order pot fi modificate;
- deactivate este permis numai daca nu exista referinte.

### Reguli extensible

`application_statuses` este extensibil.

Permite:
- Add;
- edit label/order;
- activate/deactivate;
- Delete numai daca valoarea nu este referentiata.

Codul existent `applied` ramane obligatoriu valid cat timp este folosit de istoricul aplicarilor.

### Geografie

- `EU` = Uniunea Europeana, nu continentul Europa;
- `US` pastreaza semantica existenta;
- `ASIA` pastreaza membership-ul motorului la migrare;
- `Worldwide` si `EMEA` sunt remote scopes, nu regions target;
- membership-ul regiune -> `country_codes` este canonic;
- target geografic gol ramane invalid.

### Work modes

Coduri selectabile:
- `remote`;
- `hybrid`;
- `onsite`.

`unknown` este tehnic si nu este optiune normala.

### Contract types

Coduri selectabile:
- `permanent`;
- `temporary`;
- `contract`;
- `freelance`.

`unknown` este tehnic.

### Seniority

Domeniul exista ca infrastructura, cu `values=[]` in 2A8. Nu este filtru functional.

## 7. Integritate referentiala nomenclatoare

Deactivate/Delete pe o valoare folosita nu modifica silent alte contracte.

Command API returneaza `409 Conflict` + `references`.

Referinte verificate:
- regions -> `search-config.target_regions`, `search-config.excluded_regions`;
- countries -> target/search/excluded country codes + membership in regiuni active;
- work modes -> `search-config.work_modes.<code>` daca este activ;
- contract types -> `search-config.contract_types`;
- application statuses -> `applications.status`.

Exemplu:

```json
{
  "error": "Valoarea este folosita si nu poate fi dezactivata.",
  "references": ["search-config.target_regions"]
}
```

## 8. Mapare `PUT /config`

- `rolePm` -> `role_groups.pm.enabled`;
- `roleDelivery` -> `role_groups.delivery.enabled`;
- `roleService` -> `role_groups.service.enabled`;
- `roleScrum` -> `role_groups.scrum.enabled`;
- `roleProgram` -> `role_groups.program.enabled`;
- `workRemote` / `workHybrid` / `workOnsite` -> `work_modes`;
- `contractTypes` -> `contract_types`;
- `freshness` -> `freshness_hours`;
- `fitThreshold` -> `fit_threshold`;
- `keepReposts` -> `keep_reposts`;
- `rateMin` / `rateMax` -> rate B2B;
- `immediateStart` -> `immediate_start`;
- `targetRegions` / `targetCountries` -> geografie inclusa;
- `excludedRegions` / `excludedCountries` -> geografie exclusa;
- `exclusions` -> reguli aprobate.

Save nu porneste full search.

## 9. `data/sources.json`

Root: `schema_version`, `count`, `sources`.

Campuri canonice:
- `id`, `name`, `url`, `category`;
- `active`;
- `collection_method`, `connector_available`;
- `validation_status`, `approval_status`;
- `last_validated_at`, `validation_reason`.

Sursa noua = pending + neaprobata + inactiva.
Activarea necesita validated + approved.
Monster ramane exclus operational.

## 10. `data/source-categories.json`

Camp categorie:
- `id`;
- `label`;
- `active`;
- `order`.

Label unic case/trim-insensitive. Stergerea este blocata cat timp exista surse asociate.

## 11. `data/applications.json`

```json
{
  "schema_version": "1.0",
  "applications": []
}
```

Campuri curente: `id`, `company`, `title`, `location`, `countries`, `applied_at`, `reference`, `status`, `next_status_check`, `url`.

`status` trebuie sa existe in `nomenclatures.application_statuses`. Valoarea existenta este `applied`.

## 12. Runtime asset safety

`shared/runtime-data.mjs` este sursa comuna pentru:
- build static assets;
- Worker protected allowlist;
- regression tests.

Un protected asset nou nu mai necesita trei liste functionale independente.
`search-state.json` este exclus explicit.
