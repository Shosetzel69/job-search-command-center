# Package 2 - status implementare

Ultima actualizare: 2026-09-13

## Scope

Package 2 este livrat incremental. #49 este exclus explicit. JobsPipe ramane disabled.

## 2A0 - Run state

Status: `DONE / STABLE`

- polling pana la stare terminala reala;
- recuperare dupa refresh;
- backoff controlat;
- PR #84 integrat.

## 2A - Administrare / contracts / source governance

Status: `CORE + 2A8 DELIVERED / STABILIZED`

Livrat in `main`:

- Administrare ca intrare unica UI;
- Overview / Actualizare date / Surse / Nomenclatoare / Loguri;
- Surse / Aprobare surse / Categorii surse;
- `applications.json` schema 1.0;
- `source-categories.json` schema 1.0;
- lifecycle validation/approval/active separat;
- CRUD categorii si source governance prin Command API;
- polling robust;
- protected runtime assets;
- nomenclatoare canonice Package 2A8;
- E2E PROD Package 2A8 PASS prin #126.

### Follow-up care nu blocheaza stabilizarea

- #93 cleanup semantic Source Registry ramane deschis separat;
- defectele P3 de polish observate in #126 pot fi tratate separat.

#93 nu invalideaza baseline-ul functional si nu blocheaza trecerea la urmatorul pachet.

## 2A8 - Nomenclatoare canonice

Status: `DONE / PROD E2E PASS`

Livrat:

- `data/nomenclatures.json` schema 1.0;
- domains: regions, countries, work_modes, contract_types, application_statuses, seniority infrastructure;
- clasificare system/extensible;
- geografie canonica React / Command API / Python;
- Remote/Hibrid/Onsite; unknown tehnic;
- contract types canonice;
- `contract_type` + raw provider value;
- Administrare -> Nomenclatoare functional;
- 409 + references pentru valori utilizate;
- manifest/parity guard pentru runtime assets;
- zero dispatch la operatii de config/admin;
- #117-#121 CLOSED;
- #122 satisfacut prin smoke-ul PROD #126.

## 2B - Scheduler controlat

Status: `PLANNED / NOT STARTED`

- automation config implicit OFF;
- interval 1/2/4/8/12/24h;
- scheduler lightweight separat de Full Search;
- no-op cand OFF/not due;
- exact un dispatch `scheduled` cand due.

## 2C - Conectori aprobati

Status: `PLANNED / PARTIAL TECHNICAL FOUNDATION`

- connectorii se implementeaza si valideaza in loturi mici;
- activarea Source Registry se face numai dupa implementare + teste + validare + aprobare;
- JobsPipe ramane disabled;
- #49 nu este obiectiv implicit.

## 2D - Data quality / FIT / UX

Status: `PLANNED`

- dedup cross-provider;
- first_seen/repost history;
- FIT v2 explicabil;
- KPI local + release management.

## 2E - ATS Match v1

Status: `PLANNED / DEPENDENCY GATE`

- ATS separat de FIT;
- scoring determinist;
- privacy boundary single-user;
- orice dependinta noua PDF/DOCX necesita aprobare explicita.

## Guardrails active

- JobsPipe disabled;
- #49 parcat/exclus din Package 2;
- CI nu face live crawl;
- Save/config/source/category/nomenclature != Run;
- Full Search ramane manual-only pana la 2B;
- fara dependinte noi fara aprobare explicita;
- target geografic gol invalid;
- niciun cleanup/migrare de referinte nu se face silent.

## Stabilization gate

Package 1 + Package 2A/2A8 sunt declarate stabile la 2026-09-13. Detalii: `docs/testing/reports/2026-09-13-stabilization-closeout.md`.
