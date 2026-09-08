# Package 2 - status implementare

Ultima actualizare: 2026-09-08

## Scope

Package 2 este livrat incremental. #49 este exclus explicit.

## 2A0 - Run state

Status: `DONE`

- polling pana la stare terminala reala;
- recuperare dupa refresh;
- backoff controlat;
- CI + Cloudflare verzi;
- PR #84 integrat.

## 2A - Administrare / contracts / source governance

Status: `IN DEVELOPMENT`

Branch: `feature/package-2a1-admin-contracts`
PR: #112

Implementat pe branch:

- `Administrare` ca intrare unica UI;
- Overview / Actualizare date / Surse / Nomenclatoare / Loguri;
- Surse / Aprobare surse / Categorii surse;
- `applications.json` schema 1.0;
- `source-categories.json` schema 1.0;
- validation/approval/active separate;
- sursa noua pending + inactive;
- CRUD categorii;
- Command API source governance actions;
- teste frontend/backend fara dependinte noi;
- contractele noi incluse in protected assets si CI;
- ARCHITECTURE v1.5, v1.4 arhivat.

Ramas in 2A:

- cleanup semantic Source Registry (#93);
- review final PR;
- merge/deploy;
- E2E controlat (#96).

## 2B - Scheduler controlat

Status: `PLANNED`

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
- Save/config/source/category != Run;
- fara dependinte noi fara aprobare explicita.
