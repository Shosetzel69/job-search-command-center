# Changelog

## [Unreleased]

> App version: `0.8.0` — frontend cutover to Search Profile APIs plus PWA-first responsive Mobile V1.

### Security

- #250 / R1.5: protected `/data/*` reads now use the current isolated runtime repository instead of the immutable deploy Static Assets snapshot, so Source Registry/config/nomenclature mutations persist visibly across reload.
- #242 / Release 1 Wave 3: migrateaza toate action-urile GitHub externe active la full commit SHA verificat, actualizeaza runtime-urile la Node 24 si adauga un guard CI permanent impotriva referintelor mutable.
- #234 / Release 1 Wave 3: documentata procedura de rotire a credentialelor compromise si adoptata decizia de pinning a tuturor action-urilor externe la full commit SHA; implementarea este separata in #242.
- #233 / Release 1 Wave 3: adaugat gate CI Gitleaks fail-closed, cu binar versionat si verificat SHA-256, scan range PR/push, self-test cu secret sintetic temporar si politica de allowlist scoped.
- #232 / Release 1 Wave 3: extinsa suita negativa pentru identity authorization, protected data fara sesiune, CORS interzis, payload config invalid si forced reauthentication la protected 401.

### Functionalitati

- #489 / ATC-489-06 + #476: frontend-ul foloseste acum lista bounded `GET /me/jobs`, refresh USER/ADMIN prin `/me/refresh` si `/admin/refresh`, onboarding fara Retrieve fortat, paginare profile-scoped si stare tranzitorie de return context in `sessionStorage`; aceeasi aplicatie React devine PWA-first full responsive, cu bottom navigation compact, detalii full-screen pe mobil si actiuni touch explicite.
- #384/#385/#386: Administrare -> Surse afiseaza validarea obligatorie a categoriei, serializeaza create-category + save-source prin single-fire guard si transforma cardurile summary in quick filters cu predicate identice count/filter; Logs are prezentare compacta fara tabel lat ca interactiune primara.


- #489 / ATC-489-01: adaugata fundatia persistenta tenant-aware pentru Search Profile si Candidate Profile, cu ID-uri distincte de Nile tenant/workspace, provisioning/backfill idempotent si referinta logica fail-closed Search Profile -> Candidate Profile compatibila cu tenant hard-delete Nile; comportamentul UI/API existent ramane neschimbat in acest slice.
- #483: promovarea GCP DEV/TEST include DB migration Job environment-scoped din exact Service digest-ul candidatului, verifica manifestul/checksum-urile/schema inainte de rollout, mentine checklist operational `promotion-status.json` si il afiseaza ADMIN-only in UI.


- #265 / Multiuser work package: implementat corpusul shared PostgreSQL, identity/profile + FORCE RLS, preferinte/FIT/state/aplicatii per profil, sesiuni JSCC opace Google-first, lifecycle ADMIN, collection/scheduler global, operational history PostgreSQL, separare runtime/migration DB credentials, capacity guard si tooling backup/restore non-PROD; profile changes nu declanseaza provider retrieval.

- #93 / Release 1 Wave 3: materializate campurile canonice de guvernanta pentru toate sursele non-Monster din `data/sources.json`; eliminata dependenta de metadata implicita la citire, cu Monster pastrat explicit ca exceptie legacy in #237.
- #231 / Release 1 Wave 3: Loguri consuma outcome/error_code/failure_stage structurat, publica agregate in run-status/run-history si separa `success_empty`/starile asteptate de neexecutie de runtime failures.
- #230 / Release 1 Wave 3: adaugate diagnostic events JSON pentru run/source lifecycle, corelare prin `run_id`/`source_execution_id` si sanitizare centrala a secretelor/upstream exception messages, inclusiv in run-status/run-history.
- #229 / Release 1 Wave 3: introdus contractul structurat per source execution (`outcome`, `source_execution_id`, `error_code`, `failure_stage`, `http_status`) cu compatibilitate pentru statusurile legacy; `success_empty` si starile operationale asteptate nu mai trebuie interpretate ca erori din text liber.
- #227: simplificat outputul sanity la cinci campuri: ultima interactiune, ultima actiune materiala, subiect, actualitate (DA/PARTIAL/NU/INCHIS) si verdict; statusul general de proiect este ascuns implicit, iar `Schimbat intre timp` apare doar pentru diferente materiale.
- #222: sanity devine chat-first: raporteaza mai intai ultima actiune materiala, subiectul si actualitatea lui (CURRENT/PARTIALLY_CURRENT/SUPERSEDED/CLOSED), apoi doar starea GitHub relevanta; verdictul de continuare/stergere ramane fail-closed pentru informatia UNIQUE nepersistata.
- #211: adaugat snapshot automat read-only pentru project sanity, derivat din checkpoint/FRC PR, defecte/QA si evidence artifacts DEV/TEST/PROD; la reluarea unui chat JSCC contextul este comparat cu snapshot-ul, iar LEGACY si mediile aplicatiei nu sunt mutate de sanity.
- #204: automatizarea release-ului permite ChatGPT sa porneasca DEV/TEST printr-un comentariu GitHub owner `/jscc-deploy ...`; workflow-ul GitHub-native valideaza strict owner-ul, SHA-ul si evidence-ul, apoi dispatch-uieste doar `deploy-environment.yml` din `main`. PROD ramane exclus. Extensia ai-github-bridge DEV/TEST este pastrata optional pentru integrari viitoare.
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

- #313-#320 / Package 2C: pregatit batch-ul Remote-first cu 29 surse fail-closed; 23 reutilizeaza Greenhouse/Ashby, Whereby reutilizeaza Lever, Slite reutilizeaza BambooHR, Cal.com foloseste noul connector generic BreezyHR, SafetyWing noul connector generic Pinpoint, Traefik Labs un collector bounded peste transportul web securizat, iar Float pastreaza semantica `success_empty`. Nicio sursa noua nu este activata implicit.
- #315: connectorul Lever existent este cablat in dispatch-ul ATS canonic.
- #58: adaugat connector SmartRecruiters Public Posting API cu paginare, detalii complete, normalizare in `CollectionResult` si teste izolate; nu este rutat sau activat in Source Registry pana la validarea live.

### Remedieri

- #483: eliminat false-SUCCESS-ul in care `/health/db` confirma doar conectivitatea iar schema TEST putea lipsi complet; promotion PASS necesita acum migration/schema readiness si checklist terminal fara pasi incompleti.


- #266: health/readiness PROD valideaza acum accesul real la `data/search-config.json` prin GitHub Contents API, eliminand false-PASS-ul produs de verificarea doar a metadata repo.

- #207: normalizat `FRONTEND_ORIGIN` in etapa de capturare a evidence-ului DEV/TEST, evitand esecul `curl` produs de whitespace in GitHub Environment variable dupa un deploy reusit.
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