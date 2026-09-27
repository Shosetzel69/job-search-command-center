# ARCHITECTURE.md — Job Search Command Center

Versiune document: `v1.17`
Versiune aplicatie de referinta: `0.06-dev`
Ultima actualizare: `2026-09-25`

## 1. Rol

Acest document este sursa unica de adevar pentru structura tehnica a proiectului.

Documente complementare:

- `GOVERNANCE.md` — proces, aprobare, branching si DoD;
- `.ai-instructions.md` — reguli obligatorii pentru AI;
- `docs/data-contract.md` — contractele runtime JSON;
- `docs/analysis/2026-09-09-canonical-nomenclatures.md` — analiza Package 2A8;
- `docs/package-2a8-implementation-plan.md` — planul de implementare aprobat;
- `docs/adr/ADR-002-ai-github-bridge.md` — decizia pentru identitati GitHub App operationale;
- `docs/adr/ADR-003-environment-isolation.md` — decizia acceptata pentru izolarea DEV / TEST / PROD;
- `docs/adr/ADR-004-nile-postgresql-backend.md` — Nile/PostgreSQL ca target persistent backend si principiile de migrare;
- `docs/adr/ADR-005-multiuser-ownership-isolation-shared-collection.md` — ownership multiuser, izolare tenant, shared collection si scheduler global;
- `docs/adr/ADR-006-google-cloud-runtime.md` — target hosting/runtime GCP, build-once si promovare prin image digest;
- `docs/analysis/2026-09-09-ai-github-bridge.md` — analiza si statusul bridge-ului AI GitHub;
- `docs/analysis/2026-09-10-remote-mcp-claude.md` — implementarea si validarea Remote MCP Claude.

## 2. Principii

Arhitectura MVP este:

`static-first + serverless command/access-control`

Principii:

- frontend static React;
- operatiile privilegiate trec prin Cloudflare Worker;
- full search ruleaza separat de request-ul HTTP; runtime-ul curent foloseste GitHub Actions, iar target-ul aprobat pentru hosting este Cloud Run Jobs conform ADR-006;
- search engine este independent de UI;
- Source Registry este separat de connectorii operationali;
- geografia este separata de FIT/scoring;
- Save/configuration != Run;
- colectarea externa este shared/system-owned; profilurile nu declanseaza retrieval separat;
- schedulerul de retrieval este global si controlat de ADMIN;
- evaluarea FIT si starea user-job sunt personale si separate de corpusul shared;
- secretele nu ajung in browser;
- runtime-ul curent foloseste inca JSON versionat in repository, dar target-ul persistent aprobat este Nile/PostgreSQL conform ADR-004;
- costul operational este mentinut redus;
- pentru domeniile controlate, datele canonice nu se dubleaza functional intre React, Worker si Python;
- infrastructura AI pentru GitHub este separata de Command API si nu devine proxy GitHub generic.

## 3. Componente

| Componenta | Responsabilitate |
|---|---|
| `frontend` | autentificare, joburi, filtre locale, criterii, aplicari, Administrare |
| `Cloudflare Worker / Command API` | auth, autorizare, protectie date, comenzi, configuratie, source governance, nomenclatoare |
| `GitHub Actions` | runtime/orchestration curent tranzitoriu; dupa cutover nu mai este dependency critica pentru PROD |
| `Cloud Build` | target CI/build; construieste o singura imagine per Git SHA |
| `Artifact Registry` | registry Docker comun; artifact immutable promovat DEV -> TEST -> PROD |
| `Cloud Run Service` | target hosting pentru aplicatie/API |
| `Cloud Run Jobs` | target execution pentru heavy search async/manual/scheduled |
| `Cloud Scheduler` | target scheduling pentru search PROD |
| `search engine` | colectare, normalizare, geografie, dedupe/repost, filtrare, FIT |
| `connectors` | transport/provider specific, fara FIT |
| `data/*.json` | persistenta runtime/versionata curenta si compatibilitate tranzitorie in timpul migrarii |
| `Nile / PostgreSQL` | target persistent pentru stare tranzactionala, multiuser/tenant, operational history si domeniile migrate incremental |
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
- in target-ul ADR-005, retrieval-ul ramane shared/system-owned; manual collection este o actiune administrativa/operator, nu un retrieval per profil;
- `Ruleaza verificarea` / `Ruleaza acum` poate porni explicit o collection run globala in DEV si TEST prin `manual-full`; nu exista trigger automat si nu se schimba politica PROD;
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

- `PUT /config` din runtime-ul curent valideaza/persista si nu face dispatch;
- source/category/nomenclature CRUD nu face dispatch;
- target-ul ADR-005 separa configuratia shared/system de profilul personal;
- collection run este global/shared, nu profile-owned;
- operatorul autorizat poate solicita manual o collection run globala;
- DEV (`SEARCH_MODE=disabled`) si TEST (`SEARCH_MODE=smoke`) permit heavy collection numai prin explicit `manual-full`; PROD pastreaza `live`/policy;
- exista maximum o executie grea globala admisa simultan;
- schimbarile profilului produc re-evaluare personala, nu provider retrieval;
- target geografic gol ramane invalid pentru profilurile care folosesc criterii geografice.

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

## 7A. Target cloud runtime — ADR-006

Target-ul de hosting/runtime este Google Cloud, fara redeschiderea deciziei Nile/PostgreSQL.

```text
GitHub
 -> Cloud Build
 -> Artifact Registry
 -> same immutable image digest
      -> DEV
      -> TEST
      -> PROD

Cloud Run Service -> UI/API
Cloud Run Jobs    -> heavy search
Cloud Scheduler   -> scheduled PROD search
Secret Manager    -> secrets
Nile/PostgreSQL   -> persistent backend target
```

Reguli:
- proiecte separate `jscc-dev`, `jscc-test`, `jscc-prod`;
- infrastructura comuna de build/artifacts in `jscc-shared`;
- build once per exact Git SHA;
- promovare prin acelasi immutable image digest, fara rebuild intre medii;
- heavy search este async si are initial maximum o executie activa per environment;
- Cloud SQL si Firestore nu sunt introduse de migrarea de hosting;
- TEST trebuie sa compare source-health inainte/dupa migrare;
- costul se masoara agregat DEV+TEST+PROD;
- target PROD nu depinde de GitHub-hosted Actions minutes dupa cutover.

Detaliile, fazele, rollback-ul si cost guardrails sunt canonice in ADR-006.

## 8. GitHub Actions

Full search: `.github/workflows/job-search-full.yml`.

Trigger operational curent:

- `workflow_dispatch` only.

Nu exista `push` sau `schedule` pe workflow-ul greu.

Schedulerul lightweight ramane separat de full search, dar ADR-005 ii schimba ownership-ul: schedulerul este global/system-owned si configurabil numai de ADMIN.

Package 2B (#86/#97-#101) trebuie rebaselined fata de aceasta regula. Nu exista scheduler per profil si profilurile nu declanseaza provider retrieval. Cand automation este OFF sau not due, nu se apeleaza provideri.

Publicarea rezultatelor:

- fara force push;
- retry maximum 3 la modificari concurente non-data;
- conflict pe fisiere canonice de rezultate => fail explicit.

## 9. Search engine

Entry point: `scripts/job_search_runner.py`.

Pipeline AS-IS:

```text
Collect
 -> Normalize
 -> Geo Eligibility
 -> Deduplicate / Repost
 -> Filter
 -> Score
 -> Publish
```

Boundary target aprobat prin ADR-005:

```text
SHARED COLLECTION
Sources
 -> Collect
 -> Normalize
 -> Canonical Job / Source Posting
 -> Deduplicate / Repost
 -> Persist shared corpus

PERSONAL EVALUATION
Shared Job + User Profile
 -> hard eligibility on explicit contradictory evidence
 -> FIT / pros / risks
 -> personal user-job state
```

Collection si personal evaluation sunt componente logice separate. User count nu trebuie sa multiplice provider calls.

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

### Ownership target ADR-005

Target-ul persistent separa trei domenii:

- **shared/product** — canonical jobs, source postings, lifecycle, dedup/repost, role-family classification, Source Registry, source categories, nomenclatures;
- **personal/profile-owned** — profile, search preferences, FIT/evaluations, seen/archive state, applications, notes, UI preferences;
- **system/operational** — collection policy, scheduler config/state, runs, source diagnostics si provider/collector state.

`search-config.json` este un contract tranzitoriu mixt si nu are succesor 1:1: campurile sale vor fi separate intre configuratie system/collection si profil personal.


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

### Candidate-managed shared/product data in runtime

Conform #322 si ADR-003 revizuit, izolarea runtime nu inseamna ca un environment poate ramane fara shared/product data cerute de exact candidate-ul validat.

In perioada JSON tranzitorie, urmatoarele fisiere sunt candidate-managed allowlisted:

- `data/sources.json`;
- `data/source-categories.json`;
- `data/nomenclatures.json`.

Reguli:

- aceste fisiere nu se copiaza DEV -> TEST -> PROD;
- fiecare environment reconciliaza independent continutul exact din `CANDIDATE_SHA` cu propriul runtime;
- **reconciliation baseline** este ultima versiune candidate-managed acceptata in environment, nu `main` curent; este distinct de operational baseline din `GOVERNANCE.md` §3.1;
- bootstrap-ul initial foloseste numai seed digests explicite;
- runtime-only change fata de baseline este pastrat daca candidate-ul nu a schimbat acelasi fisier;
- candidate-only change poate fi aplicat daca runtime-ul este inca la baseline;
- schimbare concurenta candidate + runtime pe acelasi fisier produce conflict si fail closed;
- nu exista merge automat field-level;
- decizia se calculeaza per fisier, dar setul rezultat este validat si commit-uit batch-atomic;
- generic `data/*` promotion este interzis;
- metadata de release-control pentru baseline/digests este operationala, environment-owned si nu este browser-visible;
- o schema/versiune de release-control metadata necunoscuta sau nesuportata de trusted promotion contract opreste promovarea fail closed si necesita un update/migration al control-plane contract revizuit separat;
- un promotion attempt esuat/reverted/degraded nu devine niciodata silent noul reconciliation baseline; accepted baseline se actualizeaza numai dupa verificarea functionala reusita.

Candidate content este input inert. Reconciliation/promotion logic, validatorii, allowlist-ul si credentialele ruleaza numai din trusted control-plane baseline.

Dupa commit-ul runtime se obtine noul `RUNTIME_DATA_SHA`, apoi se deployeaza exact `CANDIDATE_SHA` folosind acel snapshot. Daca deploy/verification esueaza dupa mutatia runtime, se face compensating revert numai daca runtime HEAD nu s-a schimbat; altfel environment-ul ramane explicit `DEGRADED/BLOCKED` pentru reconciliere manuala.


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

- Google Identity Services ramane IdP pentru utilizatorii browser;
- Worker valideaza semnatura JWT, issuer si audience;
- CI/CD functional verification foloseste separat GitHub Actions OIDC, cu token short-lived emis per workflow run;
- GitHub OIDC este acceptat numai pentru read-only functional verification numai pentru `GET /data/sources.json`, `GET /data/source-categories.json` si `GET /data/nomenclatures.json`, cu issuer/audience/repository_id/environment/workflow_ref/time claims validate fail-closed;
- GitHub OIDC nu autorizeaza `/commands`, configuratie sau alte mutatii si nu substituie autentificarea Google a utilizatorului;
- lifecycle-ul nu depinde de un Google user ID token stocat manual in GitHub Environments;
- target multiuser: `Google sub -> app_user.user_id -> profile.profile_id`, cu exact un profil per user in MVP;
- `ALLOWED_GOOGLE_SUB` ramane numai mecanism AS-IS single-user pana la cutover;
- profilul autorizat este rezolvat server-side; un `profile_id` trimis de browser nu confera acces;
- repository-urile personale necesita profile context autentificat;
- tabelele personale folosesc PostgreSQL RLS si `FORCE ROW LEVEL SECURITY` unde se aplica;
- ADMIN nu primeste bypass pentru continutul personal al altor utilizatori;
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

### 16.1 Runtime curent

Aplicatia operationala continua temporar sa foloseasca fisiere JSON versionate in runtime repositories pentru domeniile care nu au fost inca migrate.

Acest model ramane compatibilitate tranzitorie, nu target-ul persistent pe termen mediu.

### 16.2 Target persistent aprobat

Conform ADR-004 si ADR-005:

**Nile / PostgreSQL este backend-ul persistent target al JSCC.**

Principii:

- migrarea din JSON este incrementala, nu big-bang;
- frontend-ul React, Cloudflare Worker / Command API, GitHub Actions search engine si connectorii raman componente arhitecturale;
- accesul la date persistente trece printr-un repository/data-access boundary;
- business logic si frontend-ul nu se leaga direct de SQL sau de API-uri proprietare Nile;
- mediile raman strict separate: `jobsearch_dev`, `jobsearch_test`, `jobsearch_prod`;
- nu exista fallback implicit intre DEV / TEST / PROD;
- runtime-ul single-user curent trebuie sa ramana utilizabil in timpul migrarii;
- dupa cutover, fiecare domeniu are exact un authoritative system of record;
- permanent dual-write JSON/PostgreSQL este interzis.

Pregatirea Nile din `job-search-discovery#8` si PR #9 ramane technical preparation evidence; nu autorizeaza singura schema mutation sau migration.

### 16.3 Multiuser / shared collection contract

ADR-005 fixeaza urmatoarele boundary-uri:

- retrieval extern este shared/system-owned;
- un singur corpus canonical de joburi este reutilizat de toate profilurile;
- profilurile aplica eligibility/FIT/state independent;
- `Canonical Job` si `Source Posting` sunt entitati distincte;
- Source Posting identity foloseste prioritar `source + external_job_id`, fallback `source + canonical_url`;
- cross-source merge este conservator; false merge este mai grav decat un duplicate temporar;
- shared job lifecycle: `ACTIVE -> UNCONFIRMED -> INACTIVE`;
- freshness/display window nu este lifecycle/deletion;
- inactive shared jobs au retention implicit 90 zile, cu protectie pentru referinte personale care necesita jobul;
- Application este profile-owned si are `job_id` optional; aplicatiile externe sunt valide cu `job_id = NULL`;
- FIT este profile-owned si se recalculeaza incremental la job/profile/fit-version changes;
- hard eligibility exclude doar pe contradictie explicita; missing/unknown nu este negative evidence.

### 16.4 Account lifecycle si authorization

Lifecycle:

`ACTIVE <-> DEACTIVATED -> DELETED`

- DEACTIVATED blocheaza accesul si pastreaza datele personale pentru reactivare;
- DELETED sterge ireversibil domeniul personal si pastreaza datele shared/system;
- nu se pastreaza tombstone identificabil;
- se poate pastra maximum 90 zile un deletion audit event neidentificabil;
- re-signup dupa DELETE creeaza un account/profile nou.

MVP roles:

- `USER`;
- `ADMIN`.

ADMIN are drepturi USER doar asupra propriului profil si capabilitati administrative asupra account lifecycle, shared/system configuration, scheduler, manual collection si diagnostics. ADMIN nu acceseaza continutul personal al altui user.

Tenant isolation este defense-in-depth:

- authenticated identity -> server-side app_user/profile resolution;
- repository scoping obligatoriu pentru personal data;
- PostgreSQL RLS pe personal tables;
- `FORCE ROW LEVEL SECURITY` unde se aplica;
- browser-supplied user/profile id nu confera autoritate;
- ADMIN nu primeste personal-content RLS bypass.

### 16.5 Runtime connectivity si privilege gate

Path target:

`Cloudflare Worker -> repository/data-access -> node-postgres (pg) -> Cloudflare Hyperdrive -> Nile PostgreSQL`

- Hyperdrive este folosit pentru pooling;
- query caching este initial OFF pentru persistence runtime;
- DEV/TEST/PROD folosesc bindings statice separate catre `jobsearch_dev`, `jobsearch_test`, `jobsearch_prod`;
- request-selected DB si cross-environment fallback sunt interzise;
- runtime CRUD authority trebuie separata demonstrabil de migration/DDL authority inainte de personal-data/multiuser PROD cutover;
- broad DDL poate fi tolerat temporar numai in DEV/TEST si migration work controlat;
- daca providerul nu permite separarea demonstrabila, riscul revine la Architecture pentru owner decision explicit.

### 16.6 Cost guardrail

Pilot variable infrastructure budget este **EUR 0**.

- auto-upgrade si paid overage sunt interzise fara owner approval;
- 70% din capacitatea Nile inclusa este operational warning/gate;
- inainte de PROD multiuser trebuie demonstrat fie ca paid overage nu poate aparea fara owner action, fie ca workload-ul non-essential poate fi oprit/degradat inainte de consum platit;
- daca fail-closed cost control nu poate fi demonstrat, multiuser PROD ramane blocat.

### 16.7 Migration order si authority

Migrarea este domain-by-domain:

1. operational history;
2. shared job corpus;
3. multiuser personal core;
4. global scheduler;
5. remaining shared administration/runtime state.

JSON poate ramane temporar pentru compatibility/export. Rollback-ul este per domain/slice.

Shared source/category/nomenclature JSON poate ramane in GitHub pana cand exista un motiv concret de migrare.

### 16.8 Alternative superseded si storage tehnic separat

- SQLite (#2) nu mai este target backend;
- Cloudflare D1 (#44 persistence proposal) nu mai este target backend;
- Cloudflare KV `OAUTH_KV` este exclusiv storage tehnic al infrastructurii Remote MCP/OAuth si nu devine persistenta functionala a aplicatiei.

Cerintele functionale valide din ticket-ele superseded raman active numai unde sunt preluate de requirements/ADR-uri curente.

ATS Match v1 ramane separat de FIT. Orice dependinta noua de parsing PDF/DOCX necesita aprobare explicita.

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

Aceasta sectiune descrie capabilitatile si conditiile de executie folosite de Claude pentru QA in acest proiect. Capabilitatea de testare web este separata de Remote MCP GitHub: MCP-ul ofera acces controlat la repository/issues, iar browserul Claude ofera interactiunea cu aplicatia web atunci cand este disponibil in sesiunea de test.

### 19.1 Capabilitati suportate

#### A. Remote MCP GitHub

Prin Remote MCP Claude sunt garantate:

- citirea fisierelor din repository prin `read_file`;
- citirea Issue-urilor prin `get_issue`;
- crearea Issue-urilor prin `create_issue`;
- actualizarea Issue-urilor prin `update_issue`;
- executia acestor operatii sub identitatea `jobsearch-claude-agent[bot]`.

#### B. Testare web / browser

Claude poate executa testare web functionala si E2E atunci cand sesiunea activa Claude expune capabilitatea de browser/web interaction.

In acest mod Claude poate, in limita controalelor disponibile in sesiune:

- deschide URL-ul aplicatiei;
- naviga intre pagini si sectiuni;
- actiona controale UI prin click/select/input;
- citi texte, valori, statusuri si mesaje vizibile;
- salva configuratii atunci cand scenariul permite explicit mutatia;
- face reload si verifica recuperarea starii;
- observa tranzitii UI si rezultate vizibile;
- captura dovezi vizuale/screenshot-uri daca instrumentul de browser le permite;
- executa smoke, functional si E2E bazat pe comportamentul vizibil al produsului.

Testarea web nu depinde de Remote MCP si nu necesita adaugarea unui tool MCP de browser.

### 19.2 Conditii obligatorii pentru testarea web Claude

Un test web destinat lui Claude poate trata browserul ca executor valid numai daca sunt indeplinite toate conditiile relevante:

1. sesiunea concreta Claude are capabilitatea browser/web interaction activa si functionala;
2. URL-ul tinta este accesibil din browserul Claude;
3. autentificarea poate fi realizata printr-o sesiune deja autorizata sau printr-o actiune interactiva controlata a owner-ului;
4. testul nu cere expunerea catre Claude a parolelor, token-urilor, cookies, bearer tokens sau altor secrete;
5. pasii necesari pot fi executati din UI fara shell/CLI, daca testul nu declara separat un runtime pentru acestea;
6. orice mutatie in PROD este reversibila si are baseline + rollback explicit;
7. actiunile cu impact operational semnificativ au owner gate explicit;
8. daca site-ul sau autentificarea blocheaza automatizarea prin CAPTCHA, anti-bot sau alta limitare externa, testul se marcheaza `BLOCKED` pentru acel pas, nu `FAIL` al produsului, daca nu exista dovada ca blocajul apartine produsului nostru.

Disponibilitatea browserului poate varia intre sesiuni. De aceea fiecare runbook Claude incepe cu un preflight de capabilitati si nu presupune persistenta unei sesiuni browser intre executii.

### 19.3 Ce poate valida browserul si ce nu implica automat

Testarea web Claude valideaza direct comportamentul observabil al UI. Ea NU implica automat acces la:

- DevTools;
- Network panel sau request/response headers;
- status HTTP exact pentru request-uri individuale;
- browser console;
- shell/terminal;
- executie `npm`, `node`, `python`, `pytest` sau Playwright local;
- GitHub Actions controls/logs/artifacts;
- Cloudflare Dashboard/Worker logs/settings/secrets;
- write pe fisiere, branch-uri sau pull requests prin Remote MCP.

Daca o sesiune Claude expune separat DevTools/Network/Console sau alte instrumente, acestea se valideaza la preflight si pot fi folosite numai pentru asertiunile care le cer explicit.

Exemplu: un mesaj UI de conflict poate fi validat prin browser. Afirmatia exacta `HTTP 409` se face numai daca raspunsul HTTP a fost observat printr-un instrument disponibil; altfel asertiunea HTTP este `BLOCKED`, chiar daca protectia UI este PASS.

### 19.4 Autentificare

Pentru aplicatia curenta:

- Claude poate continua cu o sesiune browser deja autentificata;
- daca Google login necesita interactiune a owner-ului, pasul devine `OWNER ACTION`;
- dupa autentificarea efectuata de owner, Claude continua testarea in aceeasi sesiune daca browserul o permite;
- credentialele si token-urile nu se cer si nu se includ in prompt, raport sau documentatie;
- un login care necesita owner action nu este defect;
- un auth loop sau refuz neasteptat dupa o autentificare valida poate deveni `FAIL` daca este observat si reproductibil.

### 19.5 Reguli PROD

Pentru testarea web in PROD:

- defaultul este read-only/smoke;
- mutatiile reversibile sunt permise numai daca scenariul le defineste explicit;
- inainte de mutatie se captureaza starea initiala;
- dupa test se face rollback exact si se verifica starea finala;
- daca rollback-ul esueaza, executia se opreste si rezultatul este `CRITICAL`;
- modificarile de Sources/Source Categories sau alte date operationale sensibile nu se fac fara autorizare explicita in runbook/owner gate;
- Full job search nu se porneste fara autorizarea explicita definita de test;
- o autorizare permite actiunea, dar nu elimina celelalte conditii de siguranta.

### 19.6 Regula obligatorie pentru proiectarea testelor Claude

Toate testele, runbook-urile si ticket-ele de QA destinate executiei de catre Claude trebuie sa respecte acest boundary.

Reguli:

- testele UI/web pot folosi browserul Claude ca executor suportat, dar trebuie sa declare `Browser/UI interaction` in `Required capabilities` si sa confirme disponibilitatea la preflight;
- lipsa browserului intr-o sesiune produce `BLOCKED`, nu `FAIL` al produsului;
- `FAIL` se foloseste numai cand comportamentul produsului a fost observat si contrazice rezultatul asteptat;
- testul nu poate substitui o asertiune de retea cu o presupunere bazata doar pe UI;
- testele nu cer Claude sa obtina secrete, token-uri sau workaround-uri neaprobate;
- testele nu presupun shell/CLI/Playwright, GitHub Actions sau Cloudflare daca acea capabilitate nu este declarata si validata separat;
- actiunile cu efect operational semnificativ, inclusiv Full job search, deploy sau mutatii greu reversibile, necesita owner gate;
- orice mutatie permisa in PROD trebuie sa aiba baseline, rollback si verificare finala;
- pentru servicii externe care necesita upload de date personale, CV-uri sau alte documente private, testul necesita aprobarea explicita a owner-ului inainte de upload.

### 19.7 Structura minima a unui test destinat lui Claude

Fiecare test nou destinat lui Claude trebuie sa contina minimum:

1. `Executor`: Claude;
2. `Environment`: DEV / TEST / PROD;
3. `Required capabilities`: inclusiv `Browser/UI interaction` pentru orice test web;
4. `Preflight`: verificarea capabilitatilor disponibile in sesiunea concreta;
5. `Authentication condition`: existing session / OWNER ACTION / not required;
6. `Steps` si `Expected result`;
7. `Evidence`: UI, screenshot, HTTP sau alta dovada, fara a pretinde un canal indisponibil;
8. `Capability fallback`: ce se intampla daca o capabilitate lipseste;
9. clasificare `PASS / FAIL / BLOCKED / N/A`;
10. `Mutations / rollback`, daca testul schimba stare;
11. `Owner gate`, daca exista operatii sensibile.

Un test nu poate fi declarat PASS daca o asertiune obligatorie nu a putut fi executata. In acest caz rezultatul este `BLOCKED` sau `PASS WITH BLOCKED ITEMS`, dupa natura gate-ului.

### 19.8 Separarea defectului de limitarea executorului

Raportarea QA separa explicit:

```text
Product behavior
!=
Executor capability
```

Exemple:

- browserul Claude nu este disponibil in sesiunea curenta -> `BLOCKED` pentru scenariile UI, nu bug;
- browserul este disponibil, iar un buton produce comportament gresit -> `FAIL`, bug candidat;
- Claude nu are DevTools -> `BLOCKED` numai pentru asertiunea HTTP/Network, testul UI poate continua;
- login-ul necesita owner -> `OWNER ACTION`, nu bug;
- o comanda CLI nu poate fi rulata de browser/MCP -> verificare CI/alt executor, nu bug.

### 19.9 Evolutie

Extinderea Remote MCP cu tool-uri noi si evolutia capabilitatilor browser Claude sunt tratate separat.

Un nou tool MCP devine parte garantata din arhitectura proiectului numai dupa implementare + validare live + actualizarea documentatiei. Pentru browser/web testing, capabilitatea este deja acceptata ca mod de executie QA, dar disponibilitatea concreta se confirma la fiecare sesiune prin preflight.

Toate testele viitoare pentru Claude se scriu conform acestor conditii.

## 19. Phase 2 - Environment-awareness (#161)

Baseline: `865aebfc73f3b78491972c2d0989c2f9e052c500`; G0 si G1 COMPLETE.

Phase 2 introduce numai contractul environment-aware. Nu provision-eaza DEV/TEST si nu muta runtime data.

Concepte separate explicit:

```text
APP_ENV
GITHUB_RUNTIME_OWNER
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_SHA
RUNTIME_DATA_SHA
SEARCH_MODE
FRONTEND_ORIGIN
```

Reguli implementate:
- lipsa/invaliditatea environment identity -> fail closed;
- fara fallback implicit la PROD;
- `SOURCE_SHA` este immutable si este transportat de `POST /commands/run` pana in `workflow_dispatch`;
- workflow-ul valideaza `source_sha` si executa codul din checkout-ul exact al acelui SHA;
- runtime Contents read/write folosesc exclusiv runtime repository/ref explicit;
- Command API si Nomenclature API folosesc acelasi transport `runtime-github.js`;
- `/health` expune environment, source SHA, runtime repo/ref, runtime data SHA si search mode fara secrete;
- DEV/TEST au marker UI `[ DEV ]` / `[ TEST ]`; PROD nu afiseaza marker non-production.

Mapping tranzitoriu Phase 2 PROD:

```text
APP_ENV=prod
GITHUB_RUNTIME_OWNER=Shosetzel69
GITHUB_RUNTIME_REPO=job-search-command-center
GITHUB_RUNTIME_REF=main
SEARCH_MODE=live
```

`SOURCE_SHA` si `RUNTIME_DATA_SHA` sunt generate la build din SHA-ul real al checkout-ului, nu hard-codate. In Phase 2, source si runtime data sunt inca in acelasi repository; separarea fizica este Phase 3+.

**Gate G2:** toate testele/CI/build trebuie sa fie green si PROD trebuie sa ramana functional identic baseline-ului stabilizat. Dupa G2 se opreste; provisioning-ul necesita faza urmatoare explicita.

## 20. Phase 3 - Environment automation (#161)

Gate G2 este PASS. Phase 3 introduce automatizarea parametrizata fara provisioning de resurse si fara mutarea PROD.

Artefacte canonice:

```text
config/environments.json
scripts/environment.mjs
scripts/environment/contract.mjs
scripts/environment/plans.mjs
scripts/environment/report.mjs
.github/workflows/deploy-environment.yml
```

Contract:
- environment-ul este obligatoriu si poate fi numai `dev|test|prod`;
- `SOURCE_SHA` este obligatoriu si trebuie sa fie SHA complet immutable;
- runtime repository este mapat canonic per environment;
- DEV foloseste `SEARCH_MODE=disabled`, TEST `smoke`, PROD `live`; aceste roluri raman canonice, iar DEV/TEST au numai exceptia explicita manual-only `manual-full` pentru Full Search;
- lipsa account ID / credential / origin produce FAIL;
- `bootstrap-all` include structural numai DEV + TEST;
- orice operatie PROD necesita owner gate explicit;
- Phase 3 permite numai validate/dry-run; live bootstrap/deploy ramane blocat pana la faza environment-specific;
- runtime data seed se deriva din `shared/runtime-data.mjs`, nu din trei liste copiate;
- nicio resursa runtime DEV/TEST/PROD nu este creata de Phase 3.

Workflow-ul `deploy-environment.yml` este manual-only si `dry_run=true` implicit. G3 cere validarea statica/dry-run pentru toate cele trei environments si zero mutatii PROD.

**Gate G3:** automation + CI + dry-run PASS. Dupa G3 se opreste; bootstrap DEV necesita Phase 4 / GO conform planului #161.
