# ARCHITECTURE.md — Job Search Command Center

Versiune document: `v1.10`
Versiune aplicatie de referinta: `0.06-dev`
Ultima actualizare: `2026-09-11`

## 1. Rol

Acest document este sursa unica de adevar pentru structura tehnica a proiectului.

Documente complementare:

- `GOVERNANCE.md` — proces, aprobare, branching si DoD;
- `.ai-instructions.md` — reguli obligatorii pentru AI;
- `docs/data-contract.md` — contractele runtime JSON;
- `docs/analysis/2026-09-09-canonical-nomenclatures.md` — analiza Package 2A8;
- `docs/package-2a8-implementation-plan.md` — planul de implementare aprobat;
- `docs/adr/ADR-002-ai-github-bridge.md` — decizia pentru identitati GitHub App operationale;
- `docs/analysis/2026-09-09-ai-github-bridge.md` — analiza si statusul bridge-ului AI GitHub;
- `docs/analysis/2026-09-10-remote-mcp-claude.md` — implementarea si validarea Remote MCP Claude.

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
- costul operational este mentinut redus;
- pentru domeniile controlate, datele canonice nu se dubleaza functional intre React, Worker si Python;
- infrastructura AI pentru GitHub este separata de Command API si nu devine proxy GitHub generic.

## 3. Componente

| Componenta | Responsabilitate |
|---|---|
| `frontend` | autentificare, joburi, filtre locale, criterii, aplicari, Administrare |
| `Cloudflare Worker / Command API` | auth, autorizare, protectie date, comenzi, configuratie, source governance, nomenclatoare |
| `GitHub Actions` | orchestration full search, secrets runtime, publicare rezultate |
| `search engine` | colectare, normalizare, geografie, dedupe/repost, filtrare, FIT |
| `connectors` | transport/provider specific, fara FIT |
| `data/*.json` | persistenta runtime/versionata si domenii canonice |
| `ai-github-bridge` | infrastructura separata de engineering/governance pentru operatii GitHub allowlisted sub identitati GitHub App distincte; expune REST controlat si Remote MCP stateless |

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

`Administrare`:

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
- `Ruleaza verificarea` / `Ruleaza acum` este comanda explicita de executie;
- dupa Package 2A8, UI nu mai detine liste functionale independente pentru regions/countries/work_modes/contract_types.

## 5. Command API

Entry point: `command-api/src/secure-entry.js`.

Logica principala: `command-api/src/index.js`.

Source governance: `command-api/src/source-governance.js`.

Endpoint-uri curente:

- `GET /health`;
- `GET /auth/config`;
- `POST /auth/session`;
- `POST /commands/run`;
- `PUT /config`;
- CRUD/action Surse;
- CRUD Categorii surse;
- `GET /data/*` prin Worker/protected assets.

Package 2A8 adauga endpoint-uri autentificate pentru citirea si administrarea nomenclatoarelor conform modelului system/extensible. Contractul exact este definit in #117/#120 si `docs/data-contract.md` inainte de cod.

Semantica executiei:

- `PUT /config` valideaza/persista si nu face dispatch;
- source/category/nomenclature CRUD nu face dispatch;
- `POST /commands/run` verifica rulare concurenta si produce maximum un `workflow_dispatch` cu `run_trigger=manual-ui`;
- target geografic gol este invalid.

## 6. Source governance

`Source catalog != Operational connector`.

Sursa noua:

```text
validation_status = pending
approval_status = pending
active = false
```

Flux:

```text
pending
  -> validating
  -> validated | requires_connector | rejected

validated
  -> approved
  -> active
```

Reguli:

- activarea necesita `validated + approved`;
- aprobarea nu activeaza automat sursa;
- categoria trebuie sa existe si sa fie activa;
- URL-urile duplicate sunt respinse;
- stergerea unei categorii este blocata daca exista surse asociate;
- validarea tehnica automata a surselor noi ramane Package 2C.

## 7. Nomenclatoare canonice — Package 2A8

### 7.1 Decizie

Se introduce `data/nomenclatures.json`, schema `1.0`, ca sursa canonica de date pentru domeniile controlate explicit:

- `regions`;
- `countries`;
- `work_modes`;
- `contract_types`;
- `application_statuses`;
- `seniority` ca infrastructura, fara filtru functional in 2A8.

Nu intra in acest contract: role groups/titles, freshness, FIT threshold, rate, immediate start, exclusions si JobsPipe settings.

### 7.2 Model system vs extensible

Nomenclatoarele cu semantica folosita de business logic sunt `system/semantic`. Codurile lor nu se creeaza/sterg arbitrar din UI.

Initial system/semantic:

- countries;
- regions;
- work_modes;
- contract_types;
- seniority.

Un domeniu poate fi extensibil numai daca este declarat explicit si consumatorii pot trata codurile generic. `application_statuses` poate evolua astfel; prima migrare pastreaza obligatoriu `applied` si nu inventeaza alte statusuri.

Fiecare valoare are minimum:

- `code` stabil;
- `label` user-friendly;
- `active`;
- `sort_order`;
- metadata tehnica optionala, inclusiv `aliases` sau membership.

Label-ul poate fi schimbat fara schimbarea codului tehnic.

### 7.3 Geografie canonica

- `EU` inseamna Uniunea Europeana, nu continentul Europa;
- un eventual `EUROPE` va fi cod separat;
- `US` pastreaza semantica actuala;
- `ASIA` pastreaza membership-ul curent in migrarea 2A8;
- `Worldwide` si `EMEA` raman remote scopes, nu target regions in 2A8;
- membership-ul `region -> country_codes` este definit o singura data in nomenclator;
- React, Command API si Python citesc aceleasi date canonice, dar isi pastreaza algoritmii specifici stratului;
- target gol si conflictele include/exclude raman fail-safe.

### 7.4 Work modes

Coduri canonice:

- `remote`;
- `hybrid`;
- `onsite`.

`N/A` ramane stare tehnica pentru date nedeterminate, nu optiune normala de selectie.

`search-config.json` ramane compatibil cu structura curenta si se extinde cu `work_modes.onsite`.

### 7.5 Contract types

Coduri canonice initiale:

- `permanent`;
- `temporary`;
- `contract`;
- `freelance`.

Jobul publicat primeste `contract_type`. Valoarea provider-specific poate fi pastrata separat ca `employment_type_raw` sau echivalent documentat. Normalizarea este conservatoare; lipsa certitudinii produce `unknown`.

### 7.6 Integritate referentiala

Deactivate/delete pe o valoare deja folosita nu modifica silent configuratia.

Comportament tinta:

```text
request deactivate/delete
        -> reference check
        -> 409 Conflict + referinte
        -> modificare/migrare explicita de catre utilizator
```

Aceasta regula este obligatorie pentru geografie si orice valoare referentiata de `search-config.json`.

## 8. GitHub Actions

Full search: `.github/workflows/job-search-full.yml`.

Trigger operational curent:

- `workflow_dispatch` only.

Nu exista `push` sau `schedule` pe workflow-ul greu.

Schedulerul lightweight este Package 2B si ramane separat de full search. Cand automation este OFF sau not due, nu se apeleaza provideri.

Publicarea rezultatelor:

- fara force push;
- retry maximum 3 la modificari concurente non-data;
- conflict pe fisiere canonice de rezultate => fail explicit.

## 9. Search engine

Entry point: `scripts/job_search_runner.py`.

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
- connectorii dedicati `scripts/job_search_*.py`;
- `shared/source-connectors.json` — rutare comuna.

Dupa 2A8, runner-ul incarca nomenclatoarele canonice pentru membership geografic, aliases si valorile semantice migrate. Algoritmul Python ramane separat; datele nu se copiaza in constante paralele.

Geo-eligibility ramane fail-safe:

- exista cel putin o tara/regiune tinta;
- Hybrid/Onsite cu geografie necunoscuta nu este presupus eligibil;
- geografia este evaluata inainte de FIT.

## 10. Connectors

Connectorii livreaza `CollectionResult` si nu dubleaza geografie/FIT/dedup.

Un connector nou care respecta contractul existent nu necesita ADR. Schimbarea contractului comun necesita ADR.

JobsPipe ramane:

```text
jobspipe_mode = disabled
```

Package 2 exclude explicit implementarea generica #49.

Package 2C activeaza surse numai dupa `implementat + testat + validat + aprobat`.

## 11. Runtime data

Fisiere publicate/protejate curente:

- `data/jobs.json`;
- `data/run-status.json`;
- `data/run-history.json`;
- `data/search-config.json`;
- `data/sources.json`;
- `data/source-categories.json`;
- `data/applications.json`.

Package 2A8 adauga:

- `data/nomenclatures.json`.

Fisier intern:

- `data/search-state.json` — nu este publicat frontend-ului.

### Runtime asset manifest

#121 introduce manifest comun sau CI parity guard intre:

- fisierele copiate in `command-api/public/data`;
- protected-data allowlist;
- contractele validate in CI/frontend.

Obiectivul este prevenirea repetarii regresiei #114. `search-state.json` ramane explicit exclus.

## 12. Run state

Stari active:

- `queued`;
- `pending`;
- `running`;
- `in_progress`.

Stari terminale:

- `completed`;
- `completed_with_errors`;
- `failed`.

Frontend-ul urmareste rularea pana la stare terminala reala si poate relua urmarirea dupa refresh.

## 13. Autentificare si securitate

- Google Identity Services;
- Worker valideaza semnatura JWT, issuer, audience si identitatea autorizata;
- credentialele GitHub nu ajung in browser;
- `/data/*` necesita autentificare;
- protected data foloseste `no-store`;
- fara secrete in cod/documentatie;
- HTTPS obligatoriu.

Pentru `ai-github-bridge`:

- bridge bearer credentials sunt separate pentru ChatGPT si Claude pe interfata REST existenta;
- actorul REST este derivat server-side din credential, nu din payload;
- GitHub App private keys sunt Worker secrets;
- JWT si installation tokens nu sunt returnate clientului si nu sunt logate;
- repository-ul este hard-allowlisted;
- interfata Remote MCP foloseste Streamable HTTP stateless la `/mcp`;
- MCP client -> Worker foloseste OAuth 2.1, cu grant single-owner si actor asociat server-side;
- OAuth state/token storage foloseste Cloudflare KV prin binding-ul `OAUTH_KV`;
- `MCP_OWNER_ACCESS_CODE` ramane Worker secret si nu este transmis modelului;
- Remote MCP operational curent este Claude-only si expune `read_file`, `get_issue`, `create_issue`, `update_issue`;
- toate cele patru tools folosesc GitHub App Claude server-side; issue tools apeleaza direct GitHub API, fara self-call MCP -> REST;
- `read_file` este strict read-only; files/branches/PR write raman excluse;
- identitatea downstream este `jobsearch-claude-agent[bot]` si nu poate fi selectata din payload;
- bridge-ul nu expune proxy GitHub generic.

## 14. Build/deploy

Cloudflare Workers Builds are configuratie operationala cu working directory diferit pe trigger.

Production Command API:

- Root directory: `command-api`;
- Deploy command:

```bash
npm install --ignore-scripts --no-audit --no-fund && npx wrangler deploy
```

Preview/version, conform configuratiei validate existente:

```bash
cd command-api && npm install --ignore-scripts --no-audit --no-fund && npx wrangler versions upload
```

Asimetria este intentional documentata deoarece trigger-ele Cloudflare au working directory diferit in configuratia curenta.

Build-ul Worker executa build-ul Vite si copiaza numai runtime assets aprobate.

`ai-github-bridge` are lifecycle separat si nu foloseste build-ul frontend.

Configuratie Cloudflare Workers Builds validata pentru bridge:

- production branch: `main`;
- root directory: `/ai-github-bridge/`;
- deploy command: `npx wrangler deploy`;
- non-production/version command: `npx wrangler versions upload`.

Validare locala/CI a bridge-ului:

```bash
cd ai-github-bridge
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

Deploy-ul bridge necesita secrets GitHub App, `MCP_OWNER_ACCESS_CODE` si binding-ul `OAUTH_KV` descrise in `docs/ai-github-bridge.md`. Remote MCP Claude este deployat si validat live.

## 15. CI

CI include:

- sintaxa/config Python;
- regresii search logic;
- guard full-search manual-only;
- validare contracte JSON;
- teste frontend Node;
- teste Command API Node;
- Vite production build;
- Wrangler dry-run.

Package 2A8 adauga:

- parity tests geografie;
- teste nomenclature -> UI/API/runner;
- runtime asset parity guard;
- teste referential integrity;
- contract type normalization tests.

`ai-github-bridge` are workflow CI separat cu teste Node izolate si Wrangler dry-run. Testele nu apeleaza GitHub real si acopera OAuth, tool surface MCP si issue calls GET/POST/PATCH directe.

CI nu face crawl live si nu porneste full search.

## 16. Persistenta si limite arhitecturale

Nu exista baza de date activa pentru aplicatia Job Search Command Center.

Trecerea aplicatiei la alta persistenta, multi-user sau storage privat pentru CV necesita analiza/ADR conform guvernantei.

Cloudflare KV `OAUTH_KV` este exclusiv storage tehnic al infrastructurii Remote MCP/OAuth si nu devine persistenta functionala a aplicatiei.

Introducerea `nomenclatures.json` nu schimba boundary-ul arhitectural si nu necesita ADR separat: ramane in modelul existent JSON versionat + Command API + static frontend + Python runner.

ATS Match v1 este separat de FIT. Orice dependinta noua de parsing PDF/DOCX necesita aprobare explicita.

## 17. Status Package 2

- 2A0 polling robust: implementat;
- 2A core Administrare/contracts/source governance: integrat in `main` prin PR #112;
- hotfix protected assets #114/#115: implementat si production green;
- 2A8 nomenclatoare canonice #116/#117-#122: implementare integrata, E2E PROD final ramane gate-ul de inchidere;
- 2B scheduler controlled: planificat dupa 2A8;
- 2C conectori aprobati: planificat;
- 2D data quality/FIT v2: planificat;
- 2E ATS v1: planificat, cu dependency gate;
- #49: exclus din Package 2.

## 18. AI GitHub Bridge

Decizie: `ADR-002-ai-github-bridge.md`.

Boundary:

```text
ChatGPT / Claude integration
        -> ai-github-bridge
        -> GitHub App JWT
        -> installation token
        -> GitHub REST API
```

Bridge-ul este infrastructura de engineering/governance si ramane separat de runtime-ul functional al Job Search Command Center.

MVP allowlist REST:

- `GET /health` public;
- `GET /v1/issues/:number`;
- `POST /v1/issues`;
- `PATCH /v1/issues/:number`.

Repository v1:

`Shosetzel69/job-search-command-center`

Identitati:

- ChatGPT credential -> `jobsearch-chatgpt-agent[bot]`;
- Claude credential -> `jobsearch-claude-agent[bot]`.

### 18.1 Remote MCP Claude #136 - operational

Remote MCP este o interfata suplimentara peste acelasi boundary, nu o componenta noua.

Flux operational:

```text
Claude Web
  -> OAuth 2.1
  -> /mcp (Streamable HTTP, stateless)
  -> GitHub App Claude
  -> installation token
  -> GitHub API
  -> jobsearch-claude-agent[bot]
```

OAuth state/token storage foloseste `OAUTH_KV`. Remote MCP expune numai `read_file`, `get_issue`, `create_issue` si `update_issue`; write pe files/branches/PR ramane exclus.

Dupa validarea initiala, PR #140 a eliminat self-call-ul intern MCP -> REST pentru issue tools. `get_issue`, `create_issue` si `update_issue` folosesc acum direct acelasi mecanism GitHub App/installation token ca `read_file`.

Validare live 2026-09-10:

- OAuth Claude Web: PASS;
- `read_file`: PASS;
- `get_issue`: PASS;
- `create_issue`: PASS;
- `update_issue` + close: PASS;
- issue de validare: #143;
- autor: `jobsearch-claude-agent[bot]`;
- titlu si labels pastrate la update.

Remote MCP ChatGPT nu este activ in configuratia curenta. Extinderea spre ChatGPT, comments, files, branches, pull requests sau checks necesita contract explicit, teste de branch/main safety si actualizarea ADR/documentatiei relevante.

## 19. Boundary de testare Claude

Aceasta sectiune descrie exclusiv capabilitatile garantate de integrarea Claude definita de proiect. Nu face afirmatii despre toate capabilitatile produsului Claude in afara acestei arhitecturi.

### 19.1 Capabilitati garantate de proiect

Prin Remote MCP Claude sunt garantate numai:

- citirea fisierelor din repository prin `read_file`;
- citirea Issue-urilor prin `get_issue`;
- crearea Issue-urilor prin `create_issue`;
- actualizarea Issue-urilor prin `update_issue`;
- executia acestor operatii sub identitatea `jobsearch-claude-agent[bot]`.

Orice alta capabilitate trebuie tratata ca indisponibila sau negarantata pana cand este implementata si validata explicit in arhitectura proiectului.

### 19.2 Capabilitati negarantate in arhitectura curenta

Remote MCP Claude nu ofera in prezent:

- shell/terminal local;
- executie directa `npm`, `node`, `python`, `pytest`, `Playwright` sau alte comenzi din repository;
- browser automation sau Computer Use ca parte a MCP-ului proiectului;
- acces garantat la browser DevTools, Network sau Console;
- acces la Cloudflare Dashboard, Worker logs, settings sau secrets;
- acces la GitHub Actions pentru dispatch, rerun, logs, checks sau artifacts;
- write pe fisiere, branch-uri sau pull requests;
- acces la token-uri Google, cookies, bearer tokens, GitHub App private keys, installation tokens sau alte secrete;
- bypass pentru login Google sau alte interactiuni care necesita actiunea owner-ului.

Daca sesiunea Claude ofera separat browser/computer-use sau alte instrumente, acestea pot fi folosite numai dupa un preflight explicit. Ele nu devin implicit parte din arhitectura proiectului si nu pot fi presupuse de un test viitor.

### 19.3 Regula obligatorie pentru proiectarea testelor Claude

Toate testele, runbook-urile si ticket-ele de QA destinate executiei de catre Claude trebuie scrise in limita capabilitatilor de mai sus.

Reguli:

- numai capabilitatile garantate pot fi pasi autonomi obligatorii;
- orice pas care necesita browser, DevTools, retea, shell, GitHub Actions, Cloudflare sau alta capabilitate negarantata trebuie marcat explicit `CONDITIONAL` si verificat la preflight;
- lipsa unei capabilitati a executorului produce `BLOCKED`, nu `FAIL` al produsului;
- `FAIL` se foloseste numai cand comportamentul produsului a fost observat si contrazice rezultatul asteptat;
- un test nu cere niciodata Claude sa extraga, afiseze sau primeasca secrete pentru a depasi o limitare;
- autentificarea interactiva este `OWNER ACTION`: Claude se opreste, cere autentificarea si continua numai dupa confirmare;
- o asertiune HTTP exacta, de exemplu `409`, este obligatorie numai daca executorul are acces validat la request/response; altfel se valideaza comportamentul UI disponibil si asertiunea HTTP se marcheaza `BLOCKED`;
- testele nu presupun ca Claude poate rula testele CLI sau Playwright din repository; acestea raman responsabilitatea CI sau a unui executor cu runtime explicit;
- testele nu presupun acces direct la Cloudflare sau GitHub Actions; dovezile din aceste sisteme trebuie furnizate printr-un canal disponibil sau verificate de alt executor;
- actiunile cu efect operational semnificativ, inclusiv Full job search, deploy sau mutatii greu reversibile, necesita gate-ul de owner definit in test, chiar daca o capabilitate viitoare le-ar permite tehnic;
- orice mutatie permisa in PROD trebuie sa aiba baseline, rollback explicit si verificare finala; imposibilitatea rollback-ului este `CRITICAL`.

### 19.4 Structura minima a unui test destinat lui Claude

Fiecare test nou destinat lui Claude trebuie sa contina minimum:

1. `Executor`: Claude;
2. `Environment`: DEV / TEST / PROD;
3. `Required capabilities`: lista explicita;
4. `Preflight`: verificarea capabilitatilor disponibile in sesiunea concreta;
5. `Steps` si `Expected result`;
6. `Evidence`: ce poate fi observat si prin ce canal;
7. `Capability fallback`: ce se intampla daca o capabilitate optionala lipseste;
8. clasificare `PASS / FAIL / BLOCKED / N/A`;
9. `Mutations / rollback`, daca testul schimba stare;
10. `Owner gate`, daca exista operatii sensibile.

Un test nu poate fi declarat PASS daca o asertiune obligatorie nu a putut fi executata. In acest caz rezultatul este `BLOCKED` sau `PASS WITH BLOCKED ITEMS`, dupa natura gate-ului.

### 19.5 Separarea defectului de limitarea executorului

Raportarea QA trebuie sa separe explicit:

```text
Product behavior
!=
Executor capability
```

Exemple:

- Claude nu are DevTools -> `BLOCKED` pentru verificarea HTTP, nu bug;
- login-ul necesita owner -> `OWNER ACTION`, nu bug;
- UI afiseaza valoare gresita observabila -> `FAIL`, bug candidat;
- o comanda CLI nu poate fi rulata de Claude MCP -> verificare CI/alt executor, nu bug.

### 19.6 Evolutie

Daca Remote MCP Claude primeste ulterior tool-uri noi, de exemplu browser control, Actions/checks, comments, file write, branch/PR sau un test runner dedicat, capabilitatea devine utilizabila ca pas obligatoriu numai dupa:

1. implementare;
2. validare live;
3. actualizarea acestei sectiuni si a documentatiei asociate;
4. actualizarea regulilor de testare AI.

Pana atunci, toate testele noi se proiecteaza dupa boundary-ul curent, nu dupa capabilitati presupuse ale modelului sau ale interfetei Claude.
