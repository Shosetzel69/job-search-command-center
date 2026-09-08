# Package 2 - status implementare

Ultima actualizare: 2026-09-09

## Scope

Package 2 este livrat incremental. #49 este exclus explicit. JobsPipe ramane disabled.

## 2A0 - Run state

Status: `DONE`

- polling pana la stare terminala reala;
- recuperare dupa refresh;
- backoff controlat;
- PR #84 integrat.

## 2A - Administrare / contracts / source governance

Status: `CORE MERGED / 2A8 IN IMPLEMENTATION`

Livrat in `main`:

- PR #112 Administrare / source governance;
- `Administrare` ca intrare unica UI;
- Overview / Actualizare date / Surse / Nomenclatoare / Loguri;
- Surse / Aprobare surse / Categorii surse;
- `applications.json` schema 1.0;
- `source-categories.json` schema 1.0;
- validation/approval/active separate;
- sursa noua pending + inactive;
- CRUD categorii;
- Command API source governance actions;
- teste frontend/backend;
- hotfix #114/#115 pentru protected asset `source-categories.json`;
- production UI reconfirmat functional de owner dupa hotfix.

Ramas in 2A:

- #93 cleanup semantic Source Registry;
- #116 Package 2A8 nomenclatoare canonice;
- #96/#122 E2E final.

### 2A8 - Nomenclatoare canonice

Status: `IN IMPLEMENTATION`

Branch: `feature/116-canonical-nomenclatures`

Implementat pana acum:

- #117: `data/nomenclatures.json` schema 1.0 creat;
- domenii canonice: regions, countries, work_modes, contract_types, application_statuses, seniority infrastructure;
- clasificare `system` / `extensible`;
- coduri stabile separate de label;
- membership EU/US/ASIA capturat in contract;
- CI valideaza schema, unicitatea codurilor/labelurilor si referintele geografice;
- `docs/data-contract.md` sincronizat.

Ordine ramasa:

1. #118 geografie canonica si parity migration;
2. #119 work modes + contract types;
3. #120 Admin Nomenclatoare + integritate referentiala;
4. #121 runtime asset manifest/CI guard;
5. #122 migration + E2E.

Issues: #116-#122.

Documente:

- `docs/analysis/2026-09-09-canonical-nomenclatures.md`;
- `docs/package-2a8-implementation-plan.md`;
- `ARCHITECTURE.md` v1.6.

## 2B - Scheduler controlat

Status: `PLANNED AFTER 2A8`

- automation config implicit OFF;
- interval 1/2/4/8/12/24h;
- scheduler lightweight separat de full search;
- no-op cand OFF/not due;
- exact un dispatch `scheduled` cand due.

Issues: #86, #97-#101.

## 2C - Conectori aprobati

Status: `PLANNED`

- inventar/gate;
- loturi mici de validare;
- ATS publice concrete;
- Workday CXS pe tenant-uri concrete;
- activare numai dupa implementare + teste + validare + aprobare.

Issues: #87, #102-#105.

## 2D - Data quality / FIT / UX

Status: `PLANNED`

- dedup cross-provider pentru connectorii folositi;
- first_seen/repost history;
- FIT v2 explicabil;
- KPI local + release management.

Issues: #88, #106-#110.

## 2E - ATS Match v1

Status: `PLANNED / DEPENDENCY GATE`

- ATS separat de FIT;
- scoring determinist;
- privacy boundary single-user;
- orice dependinta noua PDF/DOCX necesita aprobare explicita inainte de implementare.

Issues: #89, #111, #113.

## Guardrails active

- JobsPipe ramane disabled;
- #49 nu se implementeaza in Package 2;
- CI nu face live crawl;
- Save/config/source/category/nomenclature != Run;
- full search ramane manual-only pana la 2B;
- fara dependinte noi fara aprobare explicita;
- target geografic gol ramane invalid;
- niciun cleanup/migrare de referinte nu se face silent.
