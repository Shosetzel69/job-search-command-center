# Changelog

## [Unreleased]

### Functionalitati

- #204: ai-github-bridge poate dispatch-ui strict allowlisted workflow-ul #198 `deploy-environment.yml` pentru DEV/TEST prin REST si Remote MCP Claude; repository/ref/action sunt fixate server-side, PROD este respins, iar GitHub App necesita Actions write.
- #198: implementat fluxul fail-closed de promovare a aceluiasi `CANDIDATE_SHA` DEV -> TEST -> PROD, cu evidence artifacts separate pentru DEV PASS, TEST deploy, TEST PASS independent si PROD release record; PROD necesita candidate reachability din `main`, rollback pregatit si `PROD_GO` explicit.
- #161 / Phase 3: adaugat manifestul canonic `config/environments.json`, CLI unic `env:*`, guard-uri fail-closed, dry-run plans pentru bootstrap/deploy/status/isolation si workflow generic manual-only; Phase 3 nu provision-eaza resurse si nu modifica PROD.
- #161 / Phase 2: introdus contract environment-aware fail-closed (`APP_ENV`, runtime repo/ref, immutable `SOURCE_SHA`, `RUNTIME_DATA_SHA`, `SEARCH_MODE`, `FRONTEND_ORIGIN`), `/health` identity, dispatch cu `source_sha` si marker UI DEV/TEST; fara provisioning DEV/TEST si fara schimbarea functionala a PROD.
- #136: Remote MCP Claude este deployat si validat live pe `ai-github-bridge`, cu OAuth 2.1, `read_file`, `get_issue`, `create_issue` si `update_issue` sub identitatea `jobsearch-claude-agent[bot]`; validarea operationala a fost finalizata prin issue #143.
- #132: adaugat MVP `ai-github-bridge`, Worker Cloudflare separat pentru operatii GitHub issues allowlisted sub identitati GitHub App distincte ChatGPT/Claude; actorul este derivat din credential, repository-ul este fix, iar `ai-generated` este impus automat.
- #120 / Pachetul 2A8: `Administrare -> Nomenclatoare` este functional; domeniile system si extensible au operatii diferentiate, iar deactivate/delete pe valori referentiate este blocat cu `409 Conflict` si lista referintelor, fara modificarea silent a configuratiei.
- #119 / Pachetul 2A8: modurile de lucru canonice sunt `Remote/Hibrid/Onsite`, iar tipurile de contract `Permanent/Temporar/Contract/Freelance`; joburile publica `contract_type` si `employment_type_raw`, cu `unknown` pentru cazurile nedeterminate.
- #118 / Pachetul 2A8: geografia foloseste acelasi contract canonic in React, Command API si Python pentru tari, regiuni si membership; `EU` ramane Uniunea Europeana, iar divergenta legacy ASIA/PK din frontend a fost eliminata.
- #117 / Pachetul 2A8: adaugat `data/nomenclatures.json` schema 1.0 ca sursa canonica pentru `regions`, `countries`, `work_modes`, `contract_types`, `application_statuses` si infrastructura `seniority`; domeniile sunt clasificate explicit `system` sau `extensible`, cu coduri tehnice stabile separate de label-uri.
- #85 / Pachetul 2A: adaugata zona `Administrare` cu Overview, Actualizare date, Surse, Nomenclatoare si Loguri; vechile pagini Surse/Loguri sunt integrate sub o singura intrare de administrare.
- #90/#91: Source Registry foloseste stari distincte pentru validare, aprobare si activare; sursele noi sunt create `pending` si inactive, iar aprobarea nu activeaza automat sursa.
- #76/#90: adaugat `source-categories.json` schema 1.0 si CRUD controlat pentru categorii; formularul de sursa foloseste selectie din taxonomie, cu actiune explicita pentru categorie noua.
- #25/#92: `applications.json` este versionat la schema 1.0 si validat de frontend/CI.

### Conectori

- #58: adaugat connector SmartRecruiters Public Posting API cu paginare, detalii complete, normalizare in `CollectionResult` si teste izolate; nu este rutat sau activat in Source Registry pana la validarea live.

### Remedieri

- #154: badge-ul `De evaluat` foloseste aceeasi eligibilitate de freshness si mod de lucru ca lista; resetarea filtrelor produce un contor coerent cu randurile eligibile.
- #153: reload-ul poate reobtine un Google ID token prin Google Identity Services folosind numai emailul contului autorizat ca `login_hint`; tokenul nu este persistat, iar `/auth/session` continua sa valideze server-side `ALLOWED_GOOGLE_SUB`. Logout explicit dezactiveaza auto-select.
- #140: eliminat self-call-ul intern MCP -> REST pentru `get_issue`, `create_issue` si `update_issue`; issue tools folosesc acum direct GitHub App Claude -> installation token -> GitHub API, rezolvand `Unexpected bridge error` observat live.
- #121 / Pachetul 2A8: build-ul Static Assets, allowlist-ul `/data/*` si testele de securitate folosesc manifestul comun `shared/runtime-data.mjs`; `nomenclatures.json` este protejat coerent, iar `search-state.json` ramane intern.
- #114: adaugat `source-categories.json` in allowlist-ul protected data al Worker-ului; eliminat 404-ul care bloca incarcarea tuturor paginilor dupa deploy-ul Package 2A si adaugat test de regresie pentru toate asset-urile protejate.
- #83 / Pachetul 2A0: UI urmareste rularea manuala pana la un status terminal real, cu backoff controlat, recuperare a starii active dupa reload si tratament distinct pentru `completed_with_errors`; eliminata limita fixa de aproximativ 5 minute.
- #79 / Pachetul 1: full search este manual-only; eliminate trigger-ele `push` si `schedule`, iar `PUT /config` nu mai porneste cautarea.
- #79 / Pachetul 1: `POST /commands/run` foloseste criteriile curente, blocheaza concurenta si produce un singur dispatch `manual-ui`.
- #79 / Pachetul 1: geografia devine fail-safe: target explicit obligatoriu, RO/BE/LU restaurat, iar Hybrid/Onsite cu geografie necunoscuta nu este presupus eligibil.
- #79 / Pachetul 1: adaugate teste de regresie, securitate si guard CI pentru a preveni reintroducerea trigger-elor automate.
- #33 / Pachetul 1: publicarea rezultatelor pastreaza commit-urile concurente non-data prin retry si opreste explicit publicarea daca fisierele canonice de rezultate au fost modificate concurent; acoperit prin test Git real, fara force push.
- #81: documentata configuratia Cloudflare Workers Builds: root-ul proiectului trebuie sa fie `command-api`; rularea Wrangler din repository root fara config produce `Missing entry-point to Worker script or to assets directory`.

- #54: providerii generici LinkedIn, Indeed, Workday, Greenhouse, Workable, SmartRecruiters, Ashby si Lever nu mai sunt trimisi crawlerului web cat timp ruta dedicata este amanata; JobsPipe ramane dezactivat.
- #54: adaugat fallback Chromium/Playwright pentru prima pagina dinamica accesibila fara `JobPosting`, fara bypass robots/login/CAPTCHA si cu maximum 2 sesiuni browser simultan.
- #54: restransa descoperirea linkurilor non-job (`pricing`, `products`, `resources`, `webinars`, `status`, `demo`, `career-advice` etc.) si extins diagnosticul per sursa cu metoda, URL final, HTTP/robots, browser si motivul esecului.

- Validare live #49: 128 surse web incercate, 56 anunturi extrase din 12 site-uri. Corectate atribute HTML nule, adrese JSON-LD in liste si detectarea eronata a login-ului; Loguri separa rezultatele partiale si blocajele.

- #49 redeschis: colectare web reala pentru surse fara API, prin pagini de cariere/anunturi/paginare si JobPosting JSON-LD. Rezultate si limite per pagina/sursa, transport public protejat, teste izolate; fara dependinte noi.

- #49: colectare din catalog pentru toate sursele active suportate; JobsPipe si Jobicy independente, fara modificarea scoring-ului.
- Loguri: acoperire reala, surse nesuportate si omiteri motivate, erori/query si records/sursa.
- Deduplicare intre provideri si protectie pentru ID-uri locale identice; pastrarea rezultatelor la esec total.
- Rutare comuna Python/Worker/UI; cooldown Jobicy de o ora si teste izolate in CI. E2E de confirmat dupa merge.

### Documentatie

- #198: documentat lantul permanent de artifacts `promotion-dev-pass -> promotion-test-deployed -> promotion-test-pass -> release-record`, gate-urile automate, concurenta per mediu si cerintele conditionale de rollback/config/DB.
- Clarificata capabilitatea Claude de testare web/browser: `ARCHITECTURE.md` -> v1.11 si `.ai-instructions.md` -> v1.8. Browser/UI testing este mod QA suportat atunci cand sesiunea Claude il expune si preflight-ul confirma accesul; DevTools/Network, shell/CLI/Playwright, GitHub Actions si Cloudflare raman capabilitati separate. Toate testele Claude viitoare trebuie sa declare conditiile de browser, autentificare, evidence, rollback si owner gate.
- #145: revizuite si aliniate documentele proiectului afectate de configuratia finala AI GitHub; `ARCHITECTURE.md` -> v1.9, `GOVERNANCE.md` -> v1.5, `.ai-instructions.md` -> v1.6; README, CONTRIBUTING, ADR-002 si analizele bridge/MCP descriu acum starea operationala reala.
- #141/#144: documentate `Branch Target Safety Rule` si `Issue Metadata Preservation Rule`; operatiile de continut nu folosesc direct `main`, iar titlul/label-urile unui Issue existent se pastreaza implicit.
- #136: actualizate analiza si documentatia operationala pentru Remote MCP Claude; adaugate dependintele MCP/OAuth si pasii de configurare `OAUTH_KV` + `MCP_OWNER_ACCESS_CODE`.
- Governance: introdus baseline obligatoriu pe starea GitHub, `Implementation Preservation Rule`, interdictia refactorizarii oportuniste si `Deploy Immutability Rule`; conversatia/memoria/copii locale raman context, nu adevar tehnic.
- #132: adaugate ADR-002, analiza/runtime docs pentru `ai-github-bridge`; `ARCHITECTURE.md` actualizat la v1.7 si v1.6 arhivat.
- Pachetul 2A8: documentat contractul canonic pentru nomenclatoare, distinctia `system/semantic` vs `extensible`, geografia canonica, tipurile de lucru/contract si regulile de integritate referentiala.
- Pachetul 2A: `ARCHITECTURE.md` actualizat la v1.5, v1.4 arhivat; documentate contractele `sources`, `source-categories` si `applications`, plus statusul livrarii Package 2.
- Definit fluxul formal `Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> implementare` si interzisa trecerea directa din idei sau analiza in Development.
- Adaugate criteriile de maturitate pentru transferul unei idei in `Analiza` si formatul scurt de sumar pentru transfer.
- Aliniate `GOVERNANCE.md`, `.ai-instructions.md`, `CONTRIBUTING.md` si `README.md` cu noul flux de lucru.
- Aliniate `GOVERNANCE.md`, `.ai-instructions.md`, `CONTRIBUTING.md`, `README.md` si documentele tehnice cu `ARCHITECTURE.md` v1.0.
- Clarificata precedenta intre arhitectura, guvernanta si instructiunile AI.
- Documentat taskul programat ChatGPT `Actualizare documentatie proiect` pentru review periodic la 2 ore.
- Restructurat `docs/requirements.md` conform structurii oficiale a documentului de cerinte.
- Eliminata documentatia backend legacy care contrazice arhitectura curenta.
- Clarificat faptul ca autorizarea curenta este single-user, iar arhitectura multi-user este `UNDER ANALYSIS`.

## 0.05 - 2026-09-06

### Interfata

- KPI-urile din `Joburi noi` devin filtre rapide single-select.
- Tara este afisata separat in Joburi noi, De evaluat si Aplicari.
- Joburile multi-country folosesc `prima tara + N` in lista si toate tarile in detalii.
- Detaliile jobului includ campuri separate pentru locatie, tari, remote scope si sursa.
- `Criterii de selectie` include regiuni `EU`, `US`, `Asia` si tari individuale.
- Adaugate excluderi teritoriale pe regiuni si tari.
- Cardul `Excluderi` este compactat.
- `Ultima rulare` afiseaza numarul surselor procesate.
- Adaugata pagina `Loguri` cu ultimele 10 rulari.

### Surse

- Pagina `Surse` permite adaugare, editare, activare/dezactivare si stergere.
- Modificarile sunt persistate canonic prin Command API si GitHub Contents API.
- URL-urile duplicate sunt blocate.
- UI separa starea din catalog de disponibilitatea connectorului.
- Catalogul legacy este normalizat la schema 1.0 la prima modificare persistenta.

### Geografie

- Adaugate campurile canonice `countries`, `country_codes`, `remote_scope`.
- Remote fara teritoriu explicit este tratat ca Worldwide.
- Remote cu tari explicite necesita Romania intre tarile acceptate.
- Remote EU/EMEA foloseste restrictia declarata.
- Remote Worldwide ramane eligibil la excluderi regionale.
- Conflictele includere/excludere sunt blocate in UI, Command API si configuratia motorului.

### Rulare si loguri

- `run-status.json` include `sources_processed` si `failed_sources`.
- JobsPipe este numarat ca o singura sursa indiferent de transportul Apify/Direct.
- Adaugat `data/run-history.json`, maximum 10 rulari.
- Publicarea rezultatelor reincearca de maximum 3 ori daca `main` se modifica in timpul push-ului.

### CI

- CI valideaza si Python/search configuration.
- Adaugate teste de regresie pentru geografie si normalizarea sursei JobsPipe.
- Raman active validarile React/Vite si Cloudflare Worker dry-run.

### Stare operationala

- JobsPipe transport: `apify`.
- Plafon Apify: 100 joburi brute/rulare.
- Validarea CI este finalizata; validarea E2E live pentru 0.05 ramane de confirmat.

## 0.04 - 2026-09-05

### JobsPipe transport

- Adaugat `jobspipe_mode`: `disabled`, `apify`, `direct`.
- Apify devine transportul recomandat dupa stabilizare.
- JobsPipe Direct ramane fallback cu quota guards.
- UI permite selectarea transportului si configurarea limitelor specifice.
- Adaugat suport pentru secretul GitHub Actions `APIFY_TOKEN`.
- Plafon Apify implicit: 5.000 joburi brute/rulare; configurabil 100-20.000.
- La introducerea functionalitatii transportul a ramas initial dezactivat pentru stabilizare.

## 0.03 - 2026-09-05

### Frontend

- Migrare completa la React 18 + Tailwind CSS + Vite.
- Layout principal centrat, maximum 1400 px.
- Fundal slate deschis si carduri albe cu border/shadow discret.
- Profil discret cu dropdown si logout.
- Albastru rezervat actiunii primare `Ruleaza verificarea`.
- Verde folosit pentru stari active/succes.
- KPI-uri afisate numai in `Joburi noi`.
- Filtre impartite pe doua randuri.
- Filtru vechime: 24h / 36h / 48h / 5 zile.
- Multiselect Remote / Hibrid / Onsite / N/A.
- FIT descrescator implicit + optiune crescator.
- `Reseteaza filtrele`.
- Tabel compact cu actiuni la hover.
- Badge-uri sidebar cu contrast ridicat.
- `Criterii de selectie` in grid responsive 1/2 coloane.

### Autentificare si securitate

- Google Sign-In integrat in React.
- Separare explicita intre login si incarcarea datelor.
- Eroarea de date nu mai invalideaza sesiunea Google.
- Retry explicit pentru incarcarea datelor protejate.
- Token Google pastrat numai in memoria paginii.
- `/data/*` protejat prin Cloudflare Worker.
- Logout-ul goleste datele clientului.

### Command API

- `GET /auth/config`.
- `POST /auth/session`.
- `POST /commands/run`.
- `PUT /config`.
- Protectie duplicate run.
- Persistenta configuratie prin GitHub Contents API.

### Search engine

- Colectare maxima 5 zile pentru filtrare locala 24h/36h/48h/5 zile.
- JobsPipe polling incremental.
- Preview gratuit.
- Cursor backlog.
- Buget 14 credite/rulare.
- Guard lunar 950.
- Circuit breaker quota.
- JobsPipe a fost dezactivat in perioada initiala de stabilizare.

### Build si hosting

- GitHub Pages eliminat din arhitectura.
- Hosting prin Cloudflare Worker Static Assets.
- Build React/Vite integrat in build-ul Worker.
- CI valideaza frontend-ul si `wrangler deploy --dry-run`.

### Documentatie

- Cerinte sincronizate cu implementarea React.
- Arhitectura actualizata.
- Command API actualizat.
- Contractele JSON actualizate.
- Strategia surselor actualizata.
- Adaugat inventar functional separat.

## 0.02 - 2026-09-03

### Functionalitati

- Previzualizare dinamica a rezultatelor in Criterii de selectie.
- Redenumirea aplicatiei in Job Search.

### Buguri rezolvate

- Separarea continutului intre Joburi noi, De evaluat, Aplicari, Criterii de selectie si Surse.
- Ascunderea controalelor care apartin altor pagini.
- Ascunderea actiunii Ruleaza verificarea in Criterii de selectie.

## 0.01 - 2026-09-03

### Functionalitati

- Criterii de selectie salvate local.
- Excluderi dinamice.
- Afisarea versiunii aplicatiei.
