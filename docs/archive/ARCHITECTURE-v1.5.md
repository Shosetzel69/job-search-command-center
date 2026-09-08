# ARCHITECTURE.md — Job Search Command Center

Versiune document: `v1.5`
Versiune aplicatie de referinta: `0.06-dev`
Ultima actualizare: `2026-09-08`

## 1. Rol

Acest document este sursa unica de adevar pentru structura tehnica a proiectului.

Documente complementare:

- `GOVERNANCE.md` — proces, aprobare, branching si DoD;
- `.ai-instructions.md` — reguli obligatorii pentru AI;
- `docs/data-contract.md` — contractele runtime JSON.

## 2. Principii

Arhitectura MVP este:

`static-first + serverless command/access-control`

Principii:

- frontend static React;
- operatiile privilegiate trec prin Cloudflare Worker;
- full search ruleaza separat in GitHub Actions;
- search engine este independent de UI;
- Source Registry este separat de connectorii operationali;
- geografia este separata de FIT/scoring;
- Save/configuration != Run;
- secretele nu ajung in browser;
- persistenta curenta ramane JSON versionat in repository;
- costul operational este mentinut redus.

## 3. Componente

| Componenta | Responsabilitate |
|---|---|
| `frontend` | autentificare, joburi, filtre locale, criterii, aplicari, Administrare |
| `Cloudflare Worker / Command API` | auth, autorizare, protectie date, comenzi, configuratie, source governance |
| `GitHub Actions` | orchestration full search, secrets runtime, publicare rezultate |
| `search engine` | colectare, normalizare, geografie, dedupe/repost, filtrare, FIT |
| `connectors` | transport/provider specific, fara FIT |
| `data/*.json` | persistenta runtime/versionata |

## 4. Frontend

Stack:

- React 18.3.1;
- Tailwind CSS 3.4.17;
- Vite 5.4.14.

Navigatie principala:

- Joburi noi;
- De evaluat;
- Aplicari;
- Criterii de selectie;
- Administrare.

`Administrare` are structura:

```text
Administrare
├─ Overview
├─ Actualizare date
├─ Surse
│  ├─ Surse
│  ├─ Aprobare surse
│  └─ Categorii surse
├─ Nomenclatoare
└─ Loguri
```

Reguli:

- UI nu acceseaza GitHub direct;
- Google ID token ramane numai in memoria paginii;
- filtrele/KPI locale nu declanseaza provider request;
- modificarile administrative nu pornesc full search;
- `Ruleaza verificarea` / `Ruleaza acum` este comanda explicita de executie.

## 5. Command API

Entry point:

`command-api/src/secure-entry.js`

Logica principala:

`command-api/src/index.js`

Source governance:

`command-api/src/source-governance.js`

Endpoint-uri:

- `GET /health`;
- `GET /auth/config`;
- `POST /auth/session`;
- `POST /commands/run`;
- `PUT /config`;
- `POST /sources`;
- `PUT /sources/:id`;
- `DELETE /sources/:id`;
- `POST /sources/:id/actions`;
- `GET /source-categories`;
- `POST /source-categories`;
- `PUT /source-categories/:id`;
- `DELETE /source-categories/:id`;
- `GET /data/*` prin Worker/protected assets.

Semantica executiei:

- `PUT /config` valideaza/persista si nu face dispatch;
- source/category CRUD nu face dispatch;
- `POST /commands/run` verifica rulare concurenta si produce maximum un `workflow_dispatch` cu `run_trigger=manual-ui`;
- target geografic gol este invalid.

## 6. Source governance

Catalogul si executia sunt concepte distincte:

`Source catalog != Operational connector`

Sursa noua este creata:

```text
validation_status = pending
approval_status = pending
active = false
```

Fluxul canonic:

```text
pending
  -> validating
  -> validated | requires_connector | rejected

validated
  -> approved
  -> active
```

Campurile sunt distincte:

- `validation_status` — validare tehnica;
- `approval_status` — decizie owner/admin;
- `active` — participare operationala.

Reguli:

- o sursa nu poate deveni activa daca nu este `validated` si `approved`;
- aprobarea nu activeaza automat sursa;
- categoria trebuie sa existe in `source-categories.json` si sa fie activa la adaugarea/mutarea unei surse;
- URL-urile duplicate sunt respinse;
- stergerea unei categorii este blocata daca exista surse asociate;
- validarea tehnica automata a surselor noi este implementata in Package 2C, nu in 2A.

Catalogul legacy este normalizat compatibil la prima mutatie prin Command API.

## 7. GitHub Actions

Full search:

`.github/workflows/job-search-full.yml`

In Package 2A triggerul operational ramane numai:

- `workflow_dispatch`.

Nu exista `push` sau `schedule` pe workflow-ul greu.

Schedulerul lightweight este Package 2B si trebuie sa ramana separat de full search. Daca automatizarea este OFF sau nu este due, schedulerul nu apeleaza provideri.

Publicarea rezultatelor:

- fara force push;
- retry maximum 3 la modificari concurente non-data;
- conflict pe fisiere canonice de rezultate => fail explicit.

## 8. Search engine

Entry point:

`scripts/job_search_runner.py`

Pipeline:

```text
Collect
 -> Normalize
 -> Geo Eligibility
 -> Deduplicate / Repost
 -> Filter
 -> Score
 -> Publish
```

Componente principale:

- `job_search.py` — model comun, geografie, filtrare, scoring;
- `source_orchestration.py` — plan/rutare/raportare surse;
- `job_identity.py` — identitate/deduplicare;
- `job_search_jobicy.py` — Jobicy;
- `job_search_web.py` + `web_transport.py` + `web_browser.py` — colectare web bounded;
- connectorii ATS dedicati din `scripts/job_search_*.py`;
- `shared/source-connectors.json` — rutare comuna.

Geo-eligibility este fail-safe:

- trebuie sa existe cel putin o tara/regiune tinta;
- Hybrid/Onsite cu geografie necunoscuta nu este presupus eligibil;
- geografia este evaluata inainte de FIT.

## 9. Connectors

Connectorii livreaza `CollectionResult` si nu dubleaza geografie/FIT/dedup.

Un connector nou care respecta contractul existent nu necesita ADR. Schimbarea contractului comun necesita ADR.

JobsPipe:

```text
jobspipe_mode = disabled
```

Codul Direct/Apify poate ramane in repository, dar nu este apelat cat timp modul este disabled.

Provider roots generic amanate raman in afara crawlerului generic cand este necesara ruta dedicata. Package 2 exclude explicit implementarea generica #49.

Package 2C activeaza surse numai dupa:

`implementat + testat + validat + aprobat`.

## 10. Runtime data

Fisiere publicate/protejate pentru frontend:

- `data/jobs.json`;
- `data/run-status.json`;
- `data/run-history.json`;
- `data/search-config.json`;
- `data/sources.json`;
- `data/source-categories.json`;
- `data/applications.json`.

Fisiere interne:

- `data/search-state.json` — stare interna JobsPipe Direct; nu este publicat frontend-ului.

Contractele publice folosesc `schema_version` si sunt validate in CI/frontend.

## 11. Run state

Stari active recunoscute de UI:

- `queued`;
- `pending`;
- `running`;
- `in_progress`.

Stari terminale:

- `completed`;
- `completed_with_errors`;
- `failed`.

Frontend-ul urmareste o rulare pana la stare terminala reala, fara timeout functional fix de 5 minute, si poate relua urmarirea dupa refresh.

## 12. Autentificare si securitate

Autentificare:

- Google Identity Services;
- Worker valideaza semnatura JWT, issuer, audience si identitatea autorizata.

Secrete Cloudflare:

- `GITHUB_TOKEN`;
- configuratia privata de autorizare.

Secrete GitHub Actions:

- provider secrets necesare conectorilor aprobati.

Reguli:

- fara secrete in cod/documentatie;
- credentialele GitHub nu ajung in browser;
- `/data/*` necesita autentificare;
- `search-state.json` nu este publicat;
- HTTPS obligatoriu.

## 13. Build/deploy

Cloudflare Workers Builds ruleaza din `command-api`.

Comenzile validate operational:

```bash
cd command-api && npm install --ignore-scripts --no-audit --no-fund && npx wrangler versions upload
```

pentru preview/version si:

```bash
cd command-api && npm install --ignore-scripts --no-audit --no-fund && npx wrangler deploy
```

pentru productie.

Build-ul Worker executa build-ul Vite si copiaza numai fisierele runtime aprobate in `command-api/public/data`.

## 14. CI

CI include:

- sintaxa/config Python;
- regresii search logic;
- guard full-search manual-only in 2A;
- validare contracte JSON;
- teste frontend Node;
- teste Command API Node;
- Vite production build;
- Wrangler dry-run.

CI nu face crawl live si nu porneste full search.

## 15. Persistenta si limite arhitecturale

Nu exista baza de date activa.

Trecerea la alta persistenta, multi-user sau storage privat pentru CV sunt schimbari arhitecturale si necesita analiza/ADR conform guvernantei.

ATS Match v1 este separat de FIT. Orice dependinta noua de parsing PDF/DOCX necesita aprobare explicita inainte de implementare.

## 16. Status Package 2

- 2A0 polling robust: implementat;
- 2A Administrare/contracts/source governance: in Development;
- 2B scheduler controlled: planificat;
- 2C conectori aprobati: planificat;
- 2D data quality/FIT v2: planificat;
- 2E ATS v1: planificat, cu dependency gate;
- #49: exclus din Package 2.
