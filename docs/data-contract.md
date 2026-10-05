# Contracte date JSON

Versiune aplicatie: `0.07-dev`
Schema principala: `1.0`
Ultima actualizare: `2026-10-04`

## 1. Reguli generale

> **AS-IS vs target:** acest document descrie in principal contractele JSON curente. Conform ADR-004/ADR-005/ADR-008, JSON-urile runtime sunt compatibilitate tranzitorie pentru domeniile nemigrate. Target-ul separa shared/product, tenant-aware personal content, global account/tenant metadata si system/operational state in PostgreSQL, domain-by-domain. `profile.profile_id == tenants.id` ramane invariant logic de provisioning fara FK fizic shared->tenant; tenant-aware personal tables use physical `tenant_id = logical profile_id`.

Contractele runtime publicate frontend-ului folosesc `schema_version = "1.0"`.

Protected runtime contracts:
- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `promotion-status.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `nomenclatures.json`;
- `applications.json`.

Manifestul canonic pentru publicare/protectie este `shared/runtime-data.mjs`.
`search-state.json` este intern si nu este publicat.

Invariant observability: pentru orice run terminal nou, `run-status.json` trebuie sa aiba un entry corespondent ca primul element din `run-history.json`. Cand run-ul produce un nou `jobs.json`, snapshot-ul include `run_id`, `run_status`, `run_completed_at` si, cand este disponibil, `source_sha`. Un run care nu produce un nou jobs snapshot nu reatribuie joburile istorice run-ului curent.

Protected runtime JSON este citit la request din repository-ul runtime configurat pentru mediul curent. Static Assets livreaza frontend-ul, dar nu reprezinta sursa de adevar pentru fisierele runtime mutabile. Astfel, mutatiile prin Command API devin vizibile la urmatorul reload fara redeploy.

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
- `source_results`;
- `source_outcome_counts`;
- `source_failure_codes`;
- `source_failure_stages`;
- `records_inspected`, `jobs_published`, `excluded`;
- `limitations`.

Agregatele source sunt derivate exclusiv din campurile structurate ale `source_results`:
- `source_outcome_counts` grupeaza dupa `outcome`;
- `source_failure_codes` grupeaza numai `outcome=failed` dupa `error_code`;
- `source_failure_stages` grupeaza numai `outcome=failed` dupa `failure_stage`.

`success_empty` ramane distinct de `failed`, iar starile asteptate de neexecutie (`deferred_provider`, `blocked_credentials`, `validation_pending`, `disabled_config`, `excluded_policy`, `skipped`) nu sunt raportate ca runtime failures.

Stari active UI: `queued`, `pending`, `running`, `in_progress`.
Stari terminale: `completed`, `completed_with_errors`, `failed`.

### 3.1 Source execution result contract

`source_results[]` pastreaza campul legacy `status` pentru compatibilitate, dar semantica noua este exprimata prin campuri structurate si nu se deriva din textul `error`.

Campuri canonice per source execution:
- `source`, `source_id`, `connector`, `collection_method`;
- `source_execution_id` — identificator unic in cadrul run-ului;
- `outcome`;
- `records`;
- `error_code` numai pentru `failed`;
- `failure_stage` numai pentru `failed`;
- `http_status` cand este disponibil;
- `error` / `failure_reason` raman text pentru oameni si compatibilitate, nu contract pentru automatizare.

Outcome-uri:
- `success` — executie reusita cu rezultate;
- `success_empty` — executie reusita fara rezultate valide;
- `failed` — executie incercata/esec de preflight care necesita clasificare de eroare;
- `deferred_provider` — ruta dedicata este amanata intentionat;
- `blocked_credentials` — connectorul necesita credentiale indisponibile;
- `validation_pending` — ruta exista dar validarea live nu este finalizata;
- `disabled_config` — sursa/transportul este dezactivat prin configuratie;
- `excluded_policy` — sursa este exclusa prin politica proiectului;
- `skipped` — omisiune operationala intentionata care nu este failure si nu se incadreaza in clasele specializate, de exemplu cooldown sau endpoint duplicat.

Coduri de eroare initiale pentru `failed`:
`HTTP_CLIENT_ERROR`, `HTTP_SERVER_ERROR`, `ACCESS_DENIED`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `DNS_ERROR`, `AUTH_REQUIRED`, `CONFIG_ERROR`, `API_ROUTE_INVALID`, `PARSE_ERROR`, `SCHEMA_ERROR`, `NORMALIZATION_ERROR`, `CONNECTOR_ERROR`, `UNEXPECTED_ERROR`.

`failure_stage` foloseste boundary-uri reale ale pipeline-ului, inclusiv `preflight`, `route_resolution`, `authentication`, `fetch`, `parse`, `normalize`, `filter`, `publish`, `postprocess`.

Automatizarea si UI-ul nu parseaza `error` / `failure_reason` pentru a deduce outcome, error code sau failure stage.

Exceptie legacy cunoscuta, provider-specific: JobsPipe direct mai foloseste un mesaj text pentru starea de quota lunara; remedierea este separata si amanata in #236. Aceasta exceptie nu face parte din contractul generic si nu poate fi folosita de consumatorii `source_results`.

### 3.2 Diagnostic event contract

Diagnostic events sunt JSON line-uri sanitizate si sunt supporting evidence, nu sursa canonica pentru run state.

Envelope stabil:
- `timestamp`;
- `level`;
- `event_name`;
- `service=job-search-runner`;
- `environment`;
- `run_id`.

Evente stabile initiale:
- `search.run.started`;
- `search.run.completed`;
- `source.collection.started`;
- `source.collection.completed`;
- `source.collection.failed`;
- `source.collection.skipped`.

Eventele source includ, unde exista:
- `source_execution_id`, `source_id`, `source`;
- `connector`, `collection_method`;
- `outcome`, `records`;
- `error_code`, `failure_stage`, `http_status`;
- `attempt`.

Severity este independenta de outcome:
- normal lifecycle / expected skip -> `INFO`;
- handled source failure / blocked credentials / run completed_with_errors -> `WARN`;
- run-level failure care impiedica rezultatul asteptat -> `ERROR`.

Sanitizarea este centrala in `scripts/diagnostics.py`. Credentialele, Authorization/Cookie, PAT/JWT, API keys, secret query parameters si userinfo din URL nu se emit in diagnostic events. Upstream exception text este sanitizat si in mesajele persistate in run-status/run-history.

## 3.3 `data/promotion-status.json`

Operational ADMIN-only contract for DEV/TEST promotion observability. It is environment-owned state stored under the GCP runtime seed namespace and is not candidate-managed product data.

Required fields:
- `schema_version=1.0`;
- `environment`, `operation_id`, `operation_type`;
- `pipeline_sha`, `candidate_sha`, `job_digest`, `service_digest`;
- `started_at`, `updated_at`, nullable `completed_at`;
- `status`, nullable `current_step`;
- ordered `steps[]` with `id`, `description`, `component`, `state`, timestamps and sanitized `error`.

Operation states: `IN_PROGRESS | PASS | FAIL`. Step states: `PENDING | IN_PROGRESS | PASS | FAIL | SKIPPED | N/A`.

The artifact must never contain DB URLs, passwords, tokens or secret values.

## 4. `data/run-history.json`

```json
{
  "schema_version": "1.0",
  "runs": []
}
```

Maximum 10 rulari, cea mai recenta prima.

Fiecare entry pastreaza `source_results` si agregatele `source_outcome_counts`, `source_failure_codes`, `source_failure_stages` pentru reporting fara reinterpretarea mesajelor text.

## 5. `data/search-config.json`

**AS-IS:** sursa canonica single-user pentru selectiile efective ale motorului. Valorile controlate sunt definite de `data/nomenclatures.json`.

**Target ADR-005/ADR-007:** acest fisier nu are succesor 1:1. Fiecare top-level key curent are exact o destinatie:

| Legacy key | Dispozitie | Target |
|---|---|---|
| `schema_version` | retired | none; target DB/contracts carry their own schema/migration versions |
| `role_groups` | profile | `profile_preferences.role_groups` |
| `work_modes` | profile | `profile_preferences.work_modes` |
| `contract_types` | profile | `profile_preferences.contract_types` |
| `freshness_hours` | profile | `profile_preferences.display_freshness_hours` |
| `collection_freshness_hours` | system | `collection_policy.collection_freshness_hours` |
| `fit_threshold` | profile | `profile_preferences.fit_threshold` |
| `keep_reposts` | profile | `profile_preferences.keep_reposts` |
| `rate_min_eur_day` | profile | `profile_preferences.rate_min_eur_day` |
| `rate_max_eur_day` | profile | `profile_preferences.rate_max_eur_day` |
| `immediate_start` | profile | `profile_preferences.immediate_start` |
| `target_regions` | profile | `profile_preferences.target_regions` |
| `target_country_codes` | profile | `profile_preferences.target_country_codes` |
| `excluded_regions` | profile | `profile_preferences.excluded_regions` |
| `excluded_country_codes` | profile | `profile_preferences.excluded_country_codes` |
| `search_country_codes` | derived then retired | compatibility projection of `profile_preferences.target_country_codes` during rollback window only |
| `eligible_remote_country_codes` | profile | `profile_preferences.remote_eligible_country_codes` |
| `work_mode_priority` | profile | `profile_preferences.work_mode_priority` |
| `source_strategy` | system | `collection_policy.source_strategy` |
| `web_browser_fallback_enabled` | system | `collection_policy.web_browser_fallback_enabled` |
| `jobspipe_credit_budget_per_run` | system | `collection_policy.jobspipe_credit_budget_per_run` |
| `jobspipe_monthly_credit_guard` | system | `collection_policy.jobspipe_monthly_credit_guard` |
| `jobspipe_incremental_overlap_minutes` | system | `collection_policy.jobspipe_incremental_overlap_minutes` |
| `exclusions` | profile | `profile_preferences.exclusions` |
| `excluded_company_patterns` | profile | `profile_preferences.excluded_company_patterns` |
| `excluded_role_keywords` | profile | `profile_preferences.excluded_role_keywords` |
| `deep_erp_terms` | profile | `profile_preferences.deep_erp_terms` |
| `jobspipe_mode` | system | `collection_policy.jobspipe_mode` |
| `jobspipe_apify_max_items_per_run` | system | `collection_policy.jobspipe_apify_max_items_per_run` |

Invariants:
- `freshness_hours` si `collection_freshness_hours` devin campuri target distincte; nu raman un singur concept ambiguu;
- target/search geography si remote-eligibility geography raman distincte;
- `search_country_codes` este numai alias legacy derivat si nu devine o a doua authority;
- machine exclusions (`excluded_company_patterns`, `excluded_role_keywords`, `deep_erp_terms`) sunt profile-owned deoarece exprima excluderile personale curente; o politica globala viitoare foloseste un contract separat;
- profile preference change produce numai personal re-evaluation, niciodata provider retrieval;
- setarile provider/browser/JobsPipe sunt system/collection-owned.

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

In target-ul multiuser Nile, verificarea referintelor personale cross-profile nu foloseste UDF PostgreSQL. ADR-008 defineste un Cross-Tenant Reference Guard application-level, allowlisted separat, care ruleaza numai query-uri aggregate/exists predefinite in global mode si returneaza numai count/boolean, fara tenant/profile IDs sau payload personal.

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
- `last_validated_at`, `validation_reason`;
- `policy_excluded`.

Semantica:
- `collection_method` descrie ruta de colectare disponibila (`web` sau connector dedicat), nu rezultatul unei rulari;
- `connector_available` indica existenta unei rute de colectare in registrul/codul curent;
- `validation_status` = `pending|validating|validated|requires_connector|rejected`;
- `approval_status` = `pending|approved|rejected`;
- `active=true` este permis numai pentru `validated + approved` si fara excludere de politica;
- `policy_excluded` este stare persistenta de guvernanta si nu trebuie confundata cu outcome-ul per-run `excluded_policy`.

Sursa noua = pending + neaprobata + inactiva.
Activarea necesita validated + approved.

Migrare #93:
- toate sursele non-Monster din catalog sunt materializate fizic cu aceste campuri canonice;
- normalizarea lor este idempotenta: citirea prin `normalizeSource()` nu mai inventeaza metadata lipsa;
- campul legacy `priority` este absent;
- Monster ramane singura exceptie fizica legacy, explicit amanata in #237; protectia operationala continua sa il normalizeze `policy_excluded=true` si `active=false`.

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


## 13. Target ownership contracts — ADR-005

Acestea sunt boundary-uri arhitecturale, nu schema SQL finala. Schema/keys/indexes sunt responsabilitatea #275.

### Shared/product

- Canonical Job;
- Source Posting;
- shared job lifecycle;
- dedup/repost relationships;
- role-family classification;
- Source Registry / source categories;
- nomenclatures.

### Account/security

- `app_user` cu internal `user_id`, role si ACTIVE/DEACTIVATED; `deletion_started_at` nullable si `deletion_initiated_by=SELF|ADMIN` sunt metadata interna de progres pentru hard-delete, nu introduc un status business nou si sunt eliminate odata cu randul account;
- `user_identity` cu provider + provider subject; Stage 1 provider = GOOGLE;
- `profile` ramane separat de account, cu exact un profil/user in MVP; fizic este global account/tenant metadata, cu `profile_id == tenants.id` ca invariant logic steady-state fara FK fizic shared->tenant, fara personal workspace payload; absenta temporara a tenantului este valida numai in provisioning incomplet sau hard-delete in curs; `provisioned_at` nullable devine non-null numai dupa finalizarea tuturor pasilor de provisioning necesari; emiterea sesiunii necesita in plus verificarea provider-safe a tenantului corespunzator `profile_id`;
- `user_session` este security state account-owned, cu token opac si numai hash persistat;
- Google `sub` si email nu devin foreign keys pentru personal-domain data;
- `DELETED` este operatie de hard-delete, nu status persistent.

Contractul detaliat este in `docs/multiuser-auth-security-contract.md`.

### Personal/profile-owned

- professional profile content (stored in tenant-aware personal tables, not in the global `profile` mapping);
- profile search preferences;
- user-job state: `seen_at`, `archived_at` si evaluation validity/version metadata;
- FIT/evaluation score, pros, risks;
- Applications cu `job_id` optional ca referinta logica la shared `canonical_jobs` (fara FK fizic tenant-aware->shared), validata de repository, si snapshot minim;
- personal notes;
- UI preferences.

### System/operational

- global collection configuration;
- global scheduler configuration/state;
- collection/search runs;
- source-run diagnostics;
- collector/provider state.

### Canonical job identity

Target-ul foloseste doua niveluri:
- `Canonical Job`;
- `Source Posting`.

Source Posting identity:
1. `source + external_job_id` daca exista;
2. altfel `source + canonical_url`.

Cross-source merge este conservator. Un requisition id nou nu este automat repost.

### Shared corpus PostgreSQL schema — ATC-275-03

Implementarea shared-domain foloseste doua tabele:
- `canonical_jobs` — identitatea canonica, title/company/location/country codes/work mode, role-family canonica si lifecycle;
- `source_postings` — posting-ul unei surse, cu `source_id`, `external_job_id`/canonical URL, identity precedence, provenance si relatie optionala de repost.

Invarianti:
- `source_postings` are unicitate pe `(source_id, identity_kind, identity_value)`;
- identity precedence este `EXTERNAL_ID` inainte de `CANONICAL_URL`;
- cross-source canonical merge este permis numai pe canonical URL exact in aceasta etapa; false merge are prioritate de evitare;
- un requisition id nou din aceeasi sursa creeaza un posting distinct si nu devine automat repost;
- relatia `repost_of_posting_id` se seteaza numai din predecessor explicit; repository-ul rezolva ID-ul numai catre un source-posting existent din aceeasi sursa. Nile a respins in DEV atat self-FK inline, cat si `ALTER TABLE ... ADD CONSTRAINT` pentru acest self-reference, astfel incat schema pastreaza UUID-ul nullable plus protectie anti-self-reference, fara FK fizic; aceasta exceptie nu autorizeaza write-uri directe in afara repository-ului si orice viitor physical purge trebuie sa curete/verifice explicit referintele inbound;
- seed/import foloseste UUID-uri determinate din identitatea stabila a source-posting-ului; cross-source exact-URL reuse este decis separat de repository lookup, astfel incat acelasi input si aceeasi ordine canonica de seed intr-un DB gol produc aceleasi ID-uri;
- rolul este clasificat numai in familiile canonice ADR-005; conflict/necunoscut cade fail-safe in `UNKNOWN`;
- campurile personale `fit/status/pros/risks/repost/romania_eligible` nu sunt persistate in shared payload;
- Cloud Run Job foloseste repository/data-access Python si `NILE_DATABASE_URL` environment-scoped; lipsa DB binding in container/GCP este fail-closed;
- PostgreSQL persistence se executa inainte de publicarea JSON tranzitorie, astfel incat un esec DB nu publica silent un nou snapshot divergent.

`data/jobs.json` ramane temporar output de compatibilitate pentru fluxul single-user pana la slice-urile de profile/FIT; nu devine o a doua autoritate permanenta pentru shared corpus.

### Shared lifecycle

`ACTIVE -> UNCONFIRMED -> INACTIVE`

Absenta dintr-un run partial/esuat nu produce automat INACTIVE.

Default retention pentru un shared job INACTIVE este 90 zile, exceptand cazurile in care o referinta personala retinuta necesita jobul.

ATC-275-03 materializeaza `retention_until` ca earliest purge eligibility, dar nu face physical purge in MU-S2. Pana cand ATC-275-06 introduce referintele personale persistente, fail-safe-ul este no-delete; un mecanism viitor de purge poate elimina un canonical job numai dupa expirarea retention si numai daca nu exista referinte retinute.

### Application

Application este profile-owned logic; fizic este tenant-aware cu `tenant_id = logical profile_id`.

- `job_id` este optional si, cand este non-null, este o referinta logica la shared `canonical_jobs.job_id` fara FK fizic cross-plane;
- write-urile user-originated cu `job_id` non-null valideaza existenta canonical job prin shared read sub tenant context inainte de persistenta personala;
- aplicatiile externe JSCC sunt permise;
- daca exista job link, snapshot-ul minim pastreaza company/title/location/reference/source URL;
- application lifecycle este independent de shared job lifecycle.

### Evaluation

`User Profile + Shared Job -> User-Job Evaluation`

FIT este personal si incremental. `profile_job_state.job_id` si `profile_job_evaluation.job_id` sunt referinte logice la shared canonical jobs, fara FK fizic cross-plane; evaluation/state derivata dintr-un shared canonical row satisface validarea referintei. Hard eligibility exclude numai pe contradictie explicita. Missing/unknown nu inseamna incompatibilitate.

ATC-489-03 face evaluarea Search-Profile-scoped si bounded:
- authority de listare target: `GET /me/jobs`;
- paginare keyset cu cursor opac; `limit` este bounded;
- query-ul citeste numai un candidate window bounded din shared corpus;
- filtrele temporare de view nu modifica Selection Criteria si nu cresc `profile_version`;
- Eligibility pastreaza `ELIGIBLE | INELIGIBLE | UNKNOWN`; numai `INELIGIBLE` este exclus;
- cache identity/validity: `tenant_id + search_profile_id + job_id + profile_version + job_version + fit_algorithm_version`;
- cache hit reutilizeaza FIT; cache miss/stale calculeaza numai randurile bounded necesare paginii curente plus prefetch bounded;
- `/data/jobs.json` este doar adapter temporar peste aceeasi cale bounded; full-corpus evaluate-on-GET este interzis;
- `GET /me/jobs` si adapterul legacy nu apeleaza provider Retrieve si nu modifica shared corpus.

`profile_job_evaluation` este cache derivat, nu workflow durable. Migration 008 il reconstruieste cu cheia `(tenant_id, search_profile_id, job_id)`; nu sterge Applications, state, Candidate Profile sau Selection Criteria.

### USER Refresh — ATC-489-04

`POST /me/refresh` este un control asupra Retrieve-ului **global**, nu o cautare privata a utilizatorului.

Outcomes canonice:
- `REUSED_CORPUS`: ultima colectare shared utilizabila este in fereastra `collection_freshness_hours`;
- `JOINED_EXISTING_RUN`: exista deja heavy Retrieve global sau request-ul pierde cursa de lock;
- `STARTED_RUN`: corpusul este stale/lipseste si endpoint-ul a pornit exact job-ul global existent;
- `BLOCKED_BY_POLICY`: USER refresh este dezactivat, environment/search policy nu permite Retrieve sau environment este PROD in acest slice.

Freshness authority este globala: ultima intrare `search_runs` cu status `completed` sau `completed_with_errors`, folosind `completed_at`. Nu exista freshness per tenant/Search Profile.

Invariants:
- USER Refresh nu modifica Selection Criteria si nu creste `profile_version`;
- nu calculeaza FIT;
- nu creeaza joburi user-owned;
- nu introduce al doilea lock; `heavy-search.lock` ramane singura autoritate de coalescing;
- endpoint-ul nu apeleaza providerii direct; poate doar reutiliza dispatcher-ul global existent;
- PROD enablement este explicit in afara ATC-489-04.


### ADMIN Refresh — ATC-489-05

`POST /admin/refresh` is the ADMIN-only global refresh control.

A narrowly allowlisted Cross-Tenant Refresh Scope Aggregator reads active Search Profile selection scope and returns only deduplicated aggregate scope data: Role Family, target regions/countries, remote-eligible countries, work modes, contract types, and `active_profile_count`. It never returns tenant/search-profile/user identity, email, Candidate Profile evidence, Applications, FIT/evaluation state, or arbitrary preferences JSON.

ADMIN Refresh uses the same global corpus freshness and heavy-search coalescing authority as USER Refresh. Canonical outcomes remain `REUSED_CORPUS | JOINED_EXISTING_RUN | STARTED_RUN | BLOCKED_BY_POLICY`.

ADMIN-started Retrieve uses `RUN_TRIGGER=admin-ui` for operational history. The current runtime still executes at most one shared global heavy Retrieve; it never fans out one run per user or scope. Provider-specific per-scope transport remains outside ATC-489-05.

PROD ADMIN Refresh is fail-closed in this slice. Legacy `/commands/run` remains compatibility-only until ATC-489-07.

### Frontend cutover — ATC-489-06

Frontend authority after this slice:
- job list/search/pagination: `GET /me/jobs`, bounded and cursor-based;
- Selection Criteria read/write: `GET/PUT /me/preferences`;
- USER refresh: `POST /me/refresh`;
- ADMIN refresh: `POST /admin/refresh`;
- profile-job workflow state: `PUT /me/jobs/:job_id/state`;
- Applications: `/applications`.

The frontend no longer reads jobs through `/data/jobs.json` and no longer dispatches `/commands/run`. Those backend adapters may remain temporarily for compatibility and are retired only in ATC-489-07.

UI invariants:
- an unconfigured Search Profile shows onboarding and does not force Retrieve;
- GUI/view filters never mutate Selection Criteria and never call providers;
- visible counts describe the bounded profile-result population currently loaded, never total shared-corpus size;
- pagination appends by canonical `job_id` and deduplicates;
- refresh outcome handling preserves the canonical four-state contract;
- USER UI does not depend on ADMIN-only operational history;
- `sessionStorage` stores transient return context only (view, GUI filters, selected job, scroll position), never authentication credentials or business datasets.

Mobile/PWA V1 does not change data ownership or API semantics. Its service worker is network-only and does not cache auth, API, job, application, criteria or other business payloads.


## 14. Multiuser migration authority

Planul canonic pentru trecerea JSON -> PostgreSQL pe domenii este `docs/multiuser-data-migration-plan.md`.

Reguli suplimentare:
- fiecare domeniu are o singura read/write authority dupa cutover;
- permanent dual-write este interzis;
- compatibility export este derivat one-way si limitat la rollback window;
- identity/session/account state nu foloseste JSON ca authority dupa multiuser auth cutover;
- personal data este intotdeauna profile-scoped si protejata prin repository authorization + ADR-008 fail-closed Tenant Data Gateway + Nile tenant context; Nile global mode fara tenant context este cross-tenant capable si este tratat ca risc rezidual controlat prin gateway/CI boundaries, nu ca DB-level default-deny;
- provider-sensitive schema/transaction changes require official Nile testing-container PASS before managed DEV mutation; generic PostgreSQL CI is portability evidence only.