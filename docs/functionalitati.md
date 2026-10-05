# Functionalitati

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-25`
Status baseline: `STABLE / CLOSE`

## 1. Acces

- Google Sign-In;
- mecanismul de autorizare curent permite un singur utilizator prin Google `sub`;
- suportul multi-user este `UNDER ANALYSIS` conform `ARCHITECTURE.md`;
- continut privat ascuns pana la autentificare;
- Google ID token nu este persistat in localStorage/sessionStorage;
- dupa login se poate retine local numai emailul autorizat ca `login_hint` non-secret;
- la reload, Google Identity Services reobtine un credential care este revalidat server-side;
- profil + logout;
- retry separat pentru erori de incarcare date.

## 2. Joburi

- lista joburilor publicate de motor;
- KPI numai in `Joburi noi`;
- KPI `Roluri noi`, `Fit ridicat`, `Repostari`, `Remote` sunt filtre rapide single-select;
- filtrele de pe pagina Joburi sunt marcate explicit **GUI ONLY** si nu pornesc Retrieve/provider calls;
- filtre text, FIT, B2B, vechime 24h/36h/48h/5 zile;
- multiselect Remote/Hibrid/Onsite pentru prezentare;
- `Mod lucru: Toate` inseamna lipsa filtrului de prezentare pe mod de lucru si include inclusiv starea tehnica `N/A`;
- selectarea unui subset Remote/Hibrid/Onsite filtreaza strict acel subset;
- sortare FIT;
- reset filtre, inclusiv filtrul KPI;
- `De evaluat` se deriva din scorul FIT si pragul FIT salvat curent, nu din statusul backend ramas de la un run anterior;
- tara afisata separat in liste;
- multi-country afisat compact `prima tara + N`;
- tabel compact cu arhivare locala, aplicare si detalii;
- drawer cu locatie, lista completa de tari, remote scope, descriere, pro, riscuri, sursa si link job;
- joburile retinute din rulari anterioare sunt reevaluate fata de criteriile curente inainte de publicare (#160/#163).

## 3. Aplicari

- `Aplicari` citeste `data/applications.json`;
- schema este versionata;
- statusul canonic `applied` ramane compatibil;
- afiseaza tara cand aceasta poate fi determinata din datele aplicarii/jobului;
- aplicarile nu sunt editabile server-side din UI.

## 4. Criterii de selectie

Pagina separa explicit doua clase:

### 4.1 Criterii RETRIEVE

Aceste controale afecteaza urmatorul Full Search si setul publicat in runtime-ul JSON tranzitoriu curent:

- grupuri de roluri — selectie runtime legacy pana la cutover-ul taxonomiei #403;
- Remote / Hibrid / Onsite;
- regiuni/tari incluse si excluse;
- tipuri contract canonice Permanent / Temporar / Contract / Freelance;
- freshness / vechime maxima;
- pastrare/excludere repostari;
- excluderi de business.

Validari fail-safe:
- minimum un grup de roluri;
- minimum un mod de lucru;
- minimum un tip de contract;
- target geografic nenul;
- fara conflicte include/exclude.

`Salveaza preferintele` persista configuratia prin `PUT /config` si nu porneste Full Search.

### 4.2 Preferinte GUI

- pragul High FIT este marcat **GUI**;
- schimbarea lui nu porneste Full Search;
- High FIT / De evaluat se recalculeaza in frontend pe baza `job.fit` si a pragului curent.

### 4.3 Controale scoase din Criteria

- JobsPipe/providerii apartin zonei Administrare, nu criteriilor utilizatorului;
- rate min/max si Disponibilitate imediata nu sunt afisate ca filtre active cat timp motorul curent nu le aplica efectiv.

### 4.4 Limitare tranzitorie

Aceasta separare face explicita semantica runtime-ului curent, dar nu reprezinta cutover-ul complet ADR-005:
- taxonomia #403 nu este inca S5 runtime;
- corpusul canonic shared si Profile Evaluation raman dependente de ATC-402-02..04 / #275;
- un criteriu RETRIEVE modificat necesita inca un Full Search in runtime-ul tranzitoriu.

## 5. Administrare

Structura canonica:

```text
Administrare
|- Overview
|- Actualizare date
|- Surse
|- Nomenclatoare
`- Loguri
```

### 5.1 Status migrare/promovare

- ADMIN vede checklist-ul ultimei promovari DEV/TEST din `promotion-status.json`;
- starea este actualizata prin polling la fiecare 5 secunde cat timp interfata este deschisa;
- pasii afiseaza explicit PENDING / IN_PROGRESS / PASS / FAIL;
- FAIL pastreaza motivul sanitizat fara secrete;
- statusul operational de promovare este separat de statusul rularii de cautare si nu foloseste `run-status.json`.

### 5.2 Surse

- registru persistent `data/sources.json`;
- cautare si sortare;
- adaugare/editare sursa;
- activare/dezactivare conform lifecycle-ului aprobat;
- categorii controlate in `data/source-categories.json`;
- validare/aprobare/activare sunt stari distincte;
- URL-urile duplicate sunt blocate;
- o sursa poate exista in catalog fara ruta operationala;
- connectorul se implementeaza si se valideaza inainte de activare operationala;
- modificarile Surse/Categorii nu pornesc Full Search.

Issue #93 ramane cleanup semantic de registry si nu este blocker pentru baseline-ul stabilizat.

### 5.3 Nomenclatoare

Sursa canonica: `data/nomenclatures.json`, schema 1.0.

Domenii:

- regions;
- countries;
- work_modes;
- contract_types;
- application_statuses;
- seniority - infrastructura, fara filtru activ in baseline.

Reguli:

- codurile system/semantic sunt stabile;
- label-ul este separat de cod;
- numai domeniile extensibile aprobate permit valori noi;
- deactivate/delete pe valoare referentiata este respins cu HTTP 409 + referinte;
- configuratia nu este modificata silent;
- modificarile de nomenclator nu pornesc Full Search.

## 6. Rulare si status

`Ruleaza verificarea` / `Ruleaza acum`:

- necesita autentificare;
- executa `POST /commands/run`;
- valideaza configuratia curenta;
- evita pornirea unei a doua rulari active;
- declanseaza maximum un `workflow_dispatch` cu trigger canonic `manual-ui`;
- in DEV si TEST foloseste explicit `execution_mode=manual-full`, pastrand `SEARCH_MODE=disabled` respectiv `smoke`;
- in PROD pastreaza executia `policy/live` existenta;
- frontend-ul urmareste run-ul pana la stare terminala reala si recupereaza starea dupa refresh;
- reincarca datele dupa publicare.

Full Search este `manual-only` in baseline-ul stabilizat:

- fara trigger `push`;
- fara trigger `schedule`;
- commit-urile de config/cod/admin nu lanseaza cautarea;
- scheduler-ul este Package 2B si este neimplementat/OFF in baseline.

Zona `Ultima rulare` afiseaza starea si numarul surselor procesate.

Publicarea datelor foloseste protectii de concurenta/retry si nu foloseste force push.

## 7. Loguri

Pagina `Loguri`:

- foloseste `data/run-history.json`;
- pastreaza maximum 10 rulari de cautare;
- afiseaza status, trigger, ora, durata, surse procesate si rezultate;
- afiseaza agregate separate pentru `success`, `success_empty`, `failed` si starile asteptate de neexecutie;
- erorile sunt grupate dupa `error_code` si `failure_stage`;
- source results afiseaza outcome-ul structurat si, numai pentru failures, codul/etapa/statusul HTTP;
- starile `deferred_provider`, `blocked_credentials`, `validation_pending`, `disabled_config`, `excluded_policy` si `skipped` nu sunt etichetate ca runtime errors;
- mesajele text sanitizate raman detaliu uman si nu sunt folosite de UI pentru clasificare;
- istoricul este protejat prin Cloudflare Worker.

## 8. JobsPipe si provideri

Moduri suportate contractual:

- `disabled` - zero cereri JobsPipe/Apify;
- `apify` - disponibil numai daca este activat explicit;
- `direct` - disponibil numai daca este activat explicit.

Stare baseline:

- `jobspipe_mode=disabled`;
- JobsPipe nu este provider principal;
- connectorii directi/gratuiti sunt preferati acolo unde exista;
- providerii cu quota/cost se activeaza numai controlat si cu guard-uri de cost.

Strategia providerilor este urmarita separat in `docs/source-strategy.md` si #142.

## 9. Persistenta

Canonica in GitHub JSON:

- joburi;
- run status;
- istoric 10 rulari;
- configuratie;
- aplicari;
- catalog surse;
- categorii surse;
- nomenclatoare.

`search-state.json` ramane intern si nepublicat.

Locala in browser: arhivarea rapida a joburilor.

Nu exista baza de date activa in baseline.

## 10. Infrastructura AI / engineering

`ai-github-bridge` si Remote MCP sunt infrastructura de engineering/governance, separate de runtime-ul functional al aplicatiei.

Stare:

- bridge dedicat Cloudflare Worker;
- GitHub Apps separate pentru identitati AI;
- Remote MCP Claude deployat si validat live;
- repository allowlisted;
- secretele si installation tokens raman server-side.

Aceste componente nu sunt dependinta functionala pentru cautarea joburilor.

## 11. Limitari si backlog

- #49 este reactivat prin decizia ownerului din 2026-09-25; Full Search traverseaza toate sursele active eligibile operational;
- #93 ramane cleanup semantic Source Registry;
- scheduler-ul configurabil ramane Package 2B;
- connectorii suplimentari se valideaza/activeaza incremental in Package 2C;
- ATS/FIT/CV library raman track-uri ulterioare;
- separarea DEV/TEST/PROD este aprobata arhitectural si urmarita prin #161, dar nu face parte din baseline-ul runtime curent;
- aplicarile nu sunt editabile server-side;
- mecanismul de autorizare curent este single-user.

## 12. Validare stabilizare

Baseline-ul a fost validat prin:

- repository/CI audit;
- browser PROD E2E;
- Package 2A8 E2E PASS;
- retesturi PASS pentru #153 auth reload si #154 De evaluat;
- Full Search controlat `workflow_dispatch` run #51 finalizat cu succes;
- #160 remediat prin PR #163 cu regression tests/CI green;
- zero Full Search neintentionat in scenariile de configurare/admin;
- cleanup complet al mutatiilor temporare.

Stare finala la 2026-09-13: `STABLE / CLOSE`.

Gap acceptat: nu exista o a doua rulare Full Search live dupa fixul #160. Fixul este merged si acoperit de regression tests green; absenta retestului live este retinuta in raportul de closeout, nu reprezinta un defect cunoscut deschis.

Evidence-ul closeout este disponibil numai in istoricul Git.
