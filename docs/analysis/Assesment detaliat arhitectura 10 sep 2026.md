# Assesment detaliat arhitectura 10 sep 2026

Data evaluare: `2026-09-10`
Repository: `Shosetzel69/job-search-command-center`
Branch de referinta evaluat: `main`
Versiune aplicatie declarata in repository: `0.06-dev`
Versiune document arhitectura: `ARCHITECTURE.md v1.9`

## 1. Scop si metoda

Acest document este un assessment AS-IS al arhitecturii si al maturitatii tehnice a aplicatiei la 10 septembrie 2026.

Assessment-ul acopera:
- arhitectura implementata si boundary-urile curente;
- fluxurile de executie, date, securitate si deploy;
- riscurile arhitecturale intampinate pana in prezent;
- masurile deja introduse pentru reducerea acestor riscuri;
- statusul dezvoltarilor la zi;
- diferentierea explicita intre `implementat`, `deployat`, `testat` si `validat`.

Surse folosite pentru evaluare:
- `ARCHITECTURE.md v1.9`;
- `README.md`;
- `CHANGELOG.md`;
- PR-urile si issue-urile relevante disponibile in GitHub;
- statusurile de validare documentate in repository.

Nu au fost executate teste, deploy-uri sau modificari runtime pentru acest assessment. Statusurile de testare si deploy sunt raportate numai unde exista evidenta documentata in repository.

## 2. Rezumat executiv

Arhitectura curenta este coerenta pentru un produs personal, single-user, cu obiectiv de cost operational foarte redus. Modelul dominant este:

```text
static-first + serverless command/access-control
```

Separarea principala este buna:

```text
React Frontend
      |
      v
Cloudflare Worker / Command API
      |
      +--> auth / config / protected data / source governance
      |
      +--> explicit run command
                 |
                 v
          GitHub Actions
                 |
                 v
          Python Search Engine
                 |
      connectors / web collection
                 |
                 v
      normalize / geo / dedupe / filter / FIT
                 |
                 v
          versioned JSON data
                 |
                 v
        Cloudflare static runtime
```

Separat de runtime-ul functional exista infrastructura de engineering/governance:

```text
Claude / ChatGPT integration
          |
          v
   ai-github-bridge
          |
          v
      GitHub App
          |
          v
      GitHub API
```

Evaluarea generala este pozitiva, dar aplicatia este inca intr-o etapa de maturizare tehnica, nu intr-un release stabil formal. Cea mai importanta dovada este faptul ca versiunea declarata ramane `0.06-dev`, iar `CHANGELOG.md` contine un bloc `[Unreleased]` semnificativ.

Principalele puncte forte:
- boundary clar intre UI, command plane si execution plane;
- full-search explicit si manual-only;
- secretele nu ajung in browser;
- geografia este fail-safe si separata de FIT;
- Source Registry este separat conceptual de connectorii operationali;
- contracte JSON versionate;
- CI acopera frontend, Worker, Python si contractele de date;
- mecanisme defensive introduse dupa incidente reale: protected asset manifest, retry la concurenta, branch safety, deploy immutability;
- infrastructura AI GitHub este separata de runtime-ul aplicatiei.

Principalele puncte slabe / riscuri ramase:
- persistenta functionala este inca legata de Git/GitHub si fisiere JSON;
- codul si runtime data au o dependenta operationala comuna in acelasi repository;
- 2A8 este implementat si testat automat, dar E2E PROD final este inca deschis;
- release/versioning-ul nu reflecta inca foarte clar diferenta dintre `main`, preview si production;
- provider coverage ramane fragil pentru LinkedIn/Indeed si alte surse fara API public stabil;
- JobsPipe este dezactivat, iar noua schimbare de pricing Apify din `2026-09-24` poate afecta strategia de provider/cost;
- mai multe surse/connectori exista tehnic, dar activarea operationala trebuie tratata separat de simpla existenta a codului;
- separarea DEV/TEST/PROD nu este inca suficient de puternica pentru a considera mediile complet izolate.

## 3. Arhitectura AS-IS

### 3.1 Frontend

Stack curent:
- React 18.3.1;
- Tailwind CSS 3.4.17;
- Vite 5.4.14.

Responsabilitati:
- autentificare;
- afisare joburi;
- filtre locale;
- criterii de selectie;
- aplicari;
- Administrare;
- vizualizare surse, nomenclatoare si loguri.

Principiu corect pastrat: frontend-ul nu detine credentiale GitHub si nu executa direct operatii privilegiate GitHub.

### 3.2 Command API

Implementat ca Cloudflare Worker.

Responsabilitati principale:
- autentificare si autorizare;
- protectia fisierelor `data/*` expuse aplicatiei;
- persistenta configuratiei;
- source governance;
- nomenclatoare;
- comanda explicita pentru full search.

Regula importanta:

```text
Save/configuration != Run
```

`PUT /config` persista configuratia, dar nu porneste full search. `POST /commands/run` este boundary-ul explicit de executie.

### 3.3 Execution plane

Full search ruleaza prin GitHub Actions si este separat de UI/Command API.

Workflow-ul greu este:

```text
workflow_dispatch only
```

Nu exista trigger operational `push` sau `schedule` pentru full-search.

Acest lucru reduce:
- consumul accidental de provider quota;
- costul necontrolat;
- rularea repetata din modificari de configuratie;
- efectele secundare greu de urmarit.

### 3.4 Search engine

Motorul Python are pipeline-ul:

```text
Collect
 -> Normalize
 -> Geo Eligibility
 -> Deduplicate / Repost
 -> Filter
 -> Score
 -> Publish
```

Boundary-ul este corect: connectorii sunt responsabili de transport/provider mapping, nu de FIT, geografie globala sau deduplicare globala.

### 3.5 Source architecture

Model conceptual:

```text
Source catalog != Operational connector
```

O sursa noua porneste:

```text
validation_status = pending
approval_status = pending
active = false
```

Activarea necesita validare si aprobare. Acest model reduce riscul ca simpla existenta a unei intrari in UI sa fie confundata cu o sursa realmente functionala.

JobsPipe este in prezent:

```text
jobspipe_mode = disabled
```

Providerii generici precum LinkedIn/Indeed nu sunt trimisi automat crawlerului generic atunci cand ruta dedicata nu este valida.

### 3.6 Date si persistenta

Nu exista baza de date functionala activa.

Persistenta curenta foloseste fisiere JSON versionate in Git:
- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `applications.json`;
- `nomenclatures.json`.

`search-state.json` ramane intern si nu este publicat frontend-ului.

Avantaj:
- cost operational aproape zero;
- audit/version history nativ Git;
- backup implicit;
- debugging simplu pentru un produs personal.

Limita:
- Git este folosit simultan ca source-control si storage operational;
- concurenta la write trebuie gestionata explicit;
- scalarea spre multi-user sau volum mare devine nepotrivita;
- deploy/runtime-data lifecycle ramane mai cuplat decat intr-o arhitectura cu storage separat.

### 3.7 Nomenclatoare canonice

Package 2A8 introduce `data/nomenclatures.json` schema 1.0 pentru:
- regions;
- countries;
- work_modes;
- contract_types;
- application_statuses;
- seniority ca infrastructura.

React, Command API si Python folosesc acelasi contract canonic pentru domeniile controlate. Aceasta rezolva o problema reala de drift intre straturi.

Integritatea referentiala foloseste fail-safe:

```text
deactivate/delete referenced value
        -> reference check
        -> 409 Conflict + references
        -> no silent migration
```

### 3.8 Securitate

Mecanisme curente:
- Google Identity Services;
- validare JWT in Worker;
- allowlist de identitate;
- tokenul Google pastrat doar in memoria paginii;
- `/data/*` autentificat;
- `no-store` pentru protected data;
- GitHub credentials server-side;
- HTTPS;
- secrete absente din frontend si JSON-uri publicabile.

Pentru AI GitHub Bridge:
- Worker separat de Command API;
- GitHub App identities distincte;
- repo hard-allowlisted;
- private keys ca Worker secrets;
- installation tokens generate server-side;
- tool surface limitat;
- fara proxy GitHub generic.

### 3.9 Build, deploy si CI

Command API / frontend folosesc Cloudflare Workers Builds.

CI curent acopera:
- Python syntax/config;
- regression search logic;
- guard manual-only pentru full-search;
- JSON contracts;
- frontend Node tests;
- Command API Node tests;
- Vite production build;
- Wrangler dry-run.

AI GitHub Bridge are workflow CI separat.

Punct pozitiv: testele automate nu fac crawl live si nu pornesc full search, reducand costul si dependenta de infrastructura externa in CI.

## 4. Riscuri intampinate si lectii arhitecturale

### R1. Drift intre runtime assets si protected-data allowlist

Incident: dupa Package 2A, `source-categories.json` nu era servit corect de Worker si UI a fost blocat.

Cauza arhitecturala: aceeasi lista de runtime assets era reprezentata in mai multe locuri.

Remediere:
- hotfix #114/#115;
- ulterior #121 introduce manifest comun / parity guard.

Status risc: **substantial redus**.

Lectie: orice allowlist duplicat intre build, security boundary si frontend contract devine sursa de drift.

### R2. Configuratie Cloudflare dependenta de working directory

Incident: Wrangler executat din repository root nu gasea entry point/config corect.

Remediere documentata prin #81:
- root `command-api` pentru production trigger;
- comenzi distincte pentru preview/version.

Status risc: **controlat operational, dar sensibil la configuratie**.

### R3. Publicare concurenta in Git

Risc: un full-search putea publica peste schimbari concurente sau putea necesita force push.

Remediere:
- fara force push;
- retry max. 3 pentru modificari concurente non-data;
- conflict pe fisiere canonice de rezultate => fail explicit.

Status risc: **mitigat, nu eliminat**.

Riscul structural ramane deoarece Git este si storage operational.

### R4. Full-search declansat implicit / excesiv

Risc initial: combinarea `push`, `schedule` si save/config cu executia putea produce run-uri neintentionate, consum provider si comportament greu predictibil.

Remediere Package 1:
- `workflow_dispatch only`;
- `Save != Run`;
- un singur dispatch per comanda;
- duplicate run protection;
- CI guard impotriva reintroducerii triggerelor automate.

Status risc: **puternic redus**.

### R5. Polling UI cu timeout functional fix

Problema: UI putea opri urmarirea unei rulari dupa aproximativ 5 minute, desi backend-ul continua.

Remediere #83:
- polling pana la stare terminala reala;
- backoff controlat;
- recovery dupa refresh.

Status risc: **rezolvat pentru modelul curent**.

### R6. Divergenta semanticii geografice intre straturi

Problema: geography/domain values erau reprezentate in mai multe locuri, inclusiv divergenta legacy ASIA/PK.

Remediere Package 2A8:
- nomenclatoare canonice;
- parity React/Command API/Python;
- fail-safe pentru target gol si include/exclude conflict.

Status risc: **tehnic remediat, dar final E2E PROD inca deschis**.

### R7. Source catalog confundat cu operational coverage

Problema: o sursa putea exista in catalog sau avea metadata optimista fara ca ruta executabila sa fie realmente valida.

Remediere:
- separare `catalog != operational connector`;
- validation/approval/active distincte;
- routare numai pentru ATS-urile validate;
- surse nevalidate mentinute inactive/deferred.

Status risc: **redus conceptual; necesita disciplina continua in Source Registry**.

### R8. Fragilitatea providerilor externi

Probleme:
- LinkedIn si Indeed nu ofera un API public generic de job-search potrivit nevoii curente;
- anumite ATS-uri folosesc endpoint-uri publice, dar nu toate au acelasi nivel contractual/stabilitate;
- scraping/browser fallback poate fi fragil si nu trebuie sa devina bypass pentru login/CAPTCHA/robots.

Status risc: **deschis**.

Impact: coverage-ul real nu poate fi echivalat cu numarul de surse din catalog.

### R9. Vendor cost / quota risk - JobsPipe

JobsPipe a fost folosit ca sursa agregata, dar este in prezent dezactivat.

Analiza #142 documenteaza schimbarea de pricing JobsPipe Actor/Apify cu data efectiva:

```text
2026-09-24
```

Impact posibil:
- trecere la cost per job returnat;
- bulk discovery devine mai scump;
- DEV/test poate consuma inutil quota daca nu foloseste preview, incremental queries si limite stricte.

Status risc: **sub analiza; nicio decizie arhitecturala luata**.

### R10. AI bridge - self-call intern defect

Incident live: Remote MCP Claude putea citi fisiere, dar issue tools produceau `Unexpected bridge error`.

Cauza: self-call MCP -> REST in acelasi bridge.

Remediere #140:
- issue tools apeleaza direct GitHub API folosind acelasi GitHub App installation token path.

Validarea live ulterioara a trecut pentru read/create/update/close.

Status risc: **rezolvat pentru tool surface curent**.

### R11. Operatii accidentale direct pe main

Incident de proces: un fisier temporar `noop.txt` a ajuns accidental pe `main`.

Remediere #141:
- Branch Target Safety Rule;
- branch explicit si verificat pentru write;
- fara fallback implicit la default branch;
- post-write verification.

Status risc: **guvernat, necesita respectarea regulii de catre toate agent-urile**.

### R12. Versioning / release ambiguity

Repository-ul declara `0.06-dev`, in timp ce o parte importanta din schimbari este in `[Unreleased]`.

Riscul este ca termenii:
- merged in main;
- preview deployed;
- production deployed;
- smoke tested;
- E2E validated;

sa fie confundati intre ei.

Status risc: **deschis**.

Acest assessment foloseste explicit aceste stari separat si nu considera un feature `finalizat complet` daca lipseste validarea ceruta de ticket.

### R13. Izolarea mediilor

Exista production si mecanisme de Cloudflare preview/version, dar separarea completa DEV/TEST/PROD nu este inca o proprietate arhitecturala suficient de puternica pentru toate componentele si datele.

Impact:
- consum de provider quota in development;
- risc de test pe date canonice;
- dificultate in trasabilitatea exacta `commit -> environment -> validation`.

Status risc: **deschis / de maturizat**.

## 5. Raport dezvoltari la zi

### 5.1 Regula de status folosita

Un element este marcat `FINALIZAT COMPLET` numai daca exista evidenta pentru toate cele patru stari relevante:

```text
Development complete
+ deployed
+ tested
+ validated in target environment
```

Merge-ul in `main` sau CI green singure nu sunt suficiente.

### 5.2 Status consolidat

| Dezvoltare | Development | Deploy | Testare | Validare | Versiune / evidenta | Status assessment |
|---|---|---|---|---|---|---|
| Package 1 - manual-only execution, geo fail-safe, concurrency publishing | Finalizat si merged (#80) | Cloudflare build/version confirmat | CI green; 108 Python + Node/build/dry-run | validare production completa nu este documentata ca gate inchis in materialul revizuit | baseline `0.06-dev`; Cloudflare Version ID `14f53a58-1053-4036-9e16-50649d6316c4` pentru build verificat | **IMPLEMENTAT, NU MARCAT FINALIZAT COMPLET** |
| 2A0 - polling robust pana la status terminal | Finalizat si merged (#84) | inclus ulterior in main/deploy-urile Package 2A | teste Node si regresii | functionalitatea este inclusa in production baseline, dar nu exista gate standalone de validare inchis | `0.06-dev` | **IMPLEMENTAT** |
| Package 2A core - Administrare, contracts, source governance | Integrat in main (#112) | production UI reconfirmat functional dupa hotfix | CI/teste pure frontend/backend | validarea production de baza este documentata ca functionala, dar umbrella #85 ramane open | `0.06-dev` | **PARTIAL FINAL - PACKAGE INCA DESCHIS** |
| Hotfix protected data `source-categories.json` (#114/#115) | Finalizat | Production | teste de regresie protected assets | production green documentat | `0.06-dev` | **FINALIZAT COMPLET** |
| Package 2A8 - nomenclatoare canonice (#116/#117-#122) | Implementat si merged prin PR #124 | Cloudflare preview/version PASS; production final neconfirmat | CI SUCCESS + migration/regression/security/frontend/Python | smoke autentificat PROD este inca gate deschis in #122/#96 | `0.06-dev`; preview Version ID `4695568c-f94e-46b7-9ab6-5a55915ae712` | **NU ESTE INCA FINALIZAT COMPLET** |
| Greenhouse connector | Implementat/merged (#63) | cod in main | mock/CI PASS; endpoint smoke live inclus in #70 | endpoint public validat live; activarea operationala este separata | `0.06-dev` baseline | **CONNECTOR VALIDAT, ACTIVAREA SURSEI ESTE SEPARATA** |
| Workday connector | Implementat/merged (#71) | cod in main | CI + live validation | validat live si rutare dedicata integrata | `0.06-dev` baseline | **TEHNIC FINALIZAT PENTRU RUTA VALIDATA** |
| Ashby / Lever / Recruitee connectors | Implementate/merged (#65) | cod in main | CI mock + live public ATS smoke | endpoint-urile publice validate live in #70; routing/activation source-specific | `0.06-dev` baseline | **CONNECTORI VALIDATI, ACTIVAREA ESTE SEPARATA** |
| Workable / BambooHR connectors | Implementate/merged (#67) | cod in main | CI mock + live smoke | validate live in #70; operationalizare source-specific | `0.06-dev` baseline | **CONNECTORI VALIDATI, ACTIVAREA ESTE SEPARATA** |
| SuccessFactors connector | Implementat/merged (#69) | cod in main | CI + live smoke public | validat live in #70 | `0.06-dev` baseline | **CONNECTOR VALIDAT** |
| Phenom / Eightfold connectors | Implementate in cod (#69) | cod in main | mock/CI | live validation necesita credentiale oficiale | `0.06-dev` baseline | **NU SUNT VALIDATE LIVE** |
| SmartRecruiters public connector (#58) | Implementat | cod in main | teste izolate | conform changelog, nu se considera operational pana la validare/rutare explicita; existenta smoke ATS nu trebuie confundata cu activarea registry | `0.06-dev` baseline | **IMPLEMENTAT; OPERATIONAL STATUS DE CONFIRMAT PER SOURCE** |
| AI GitHub Bridge REST (#132) | Finalizat pentru MVP | Worker separat | CI Node + Wrangler dry-run | infrastructura utilizata ulterior de Remote MCP; secrets/identity boundary documentate | lifecycle separat de versiunea aplicatiei | **FINALIZAT PENTRU SCOPE MVP** |
| Remote MCP Claude (#136/#137/#140/#143) | Finalizat | **deployat live** pe `ai-github-bridge` | unit tests + check + live tests | OAuth, read_file, get_issue, create_issue, update_issue/close PASS | Worker separat; nu foloseste versiunea aplicatiei `0.06-dev` | **FINALIZAT COMPLET SI VALIDAT LIVE** |
| Scheduler controlled 2B | Neimplementat | Nu | Nu | Nu | planificat | **PLANIFICAT** |
| Connector activation/validation automation 2C | Partial infrastructura; package nefinalizat | Nu ca package complet | Partial | Partial | planificat dupa 2A8 | **PLANIFICAT / PARTIAL** |
| Data quality / FIT v2 2D | Neimplementat | Nu | Nu | Nu | planificat | **PLANIFICAT** |
| ATS Match v1 2E | Neimplementat | Nu | Nu | Nu | dependency gate parser in analiza | **PLANIFICAT** |

## 6. Dezvoltari care pot fi declarate fara rezerva `finalizate complet`

Pe baza evidentei documentate revizuite, formularea completa:

> dezvoltare finalizata complet, deployata, testata si validata

poate fi folosita fara rezerva pentru:

### 6.1 Hotfix protected runtime assets #114/#115

Status:
- dezvoltare: finalizata;
- merge: finalizat;
- deploy: production;
- testare: regression tests;
- validare: production green;
- versiune aplicatie curenta care contine fix-ul: `0.06-dev`.

### 6.2 Remote MCP Claude - scope curent

Status:
- dezvoltare: finalizata;
- deploy: live pe Worker-ul separat `ai-github-bridge`;
- testare: unit/check + live;
- validare: OAuth, read, issue get/create/update/close PASS prin #143;
- versiune: lifecycle separat de aplicatia `0.06-dev`; nu trebuie atribuita artificial unei versiuni functionale a Job Search Command Center.

Pentru restul componentelor trebuie pastrata nuanta dintre `implemented`, `deployed`, `preview green`, `production base functional` si `final E2E validated`.

## 7. Evaluare pe atribute arhitecturale

| Atribut | Evaluare | Observatie |
|---|---|---|
| Cost operational | Bun | static/serverless/GitHub JSON se potrivesc proiectului personal; providerii externi raman principalul risc de cost |
| Securitate | Buna | secrete server-side, protected data, auth boundary, GitHub Apps allowlisted |
| Separarea responsabilitatilor | Buna | UI / Command API / Actions / Python / connectors sunt distincte |
| Maintainability | Mediu-buna | imbunatatita de contracte si nomenclatoare; numarul de connectori poate creste costul de mentenanta |
| Testabilitate | Buna | CI izolat si mock-first; lipseste inca inchiderea unor E2E PROD |
| Observabilitate | Medie | run-status/history exista, dar correlation/telemetry raman limitate comparativ cu un backend complet |
| Persistenta | Suficienta pentru MVP | Git/JSON este economic si auditabil, dar este limita structurala pentru scalare/multi-user |
| Scalabilitate | Limitata intentionat | acceptabila pentru single-user; nu este arhitectura de volum enterprise |
| Provider resilience | Medie-scazuta | multe surse externe, endpoint-uri heterogene si gaps LinkedIn/Indeed |
| Release maturity | Medie-scazuta | `0.06-dev`, `[Unreleased]` si gates E2E deschise |
| Governance tehnica | Buna si in maturizare | reguli noi de branch safety, deploy immutability si docs sync reduc drift-ul intre agenti |

## 8. Riscuri prioritare AS-IS

### High

1. **Release/E2E gap pentru Package 2A8** - implementarea este in main, dar gate-ul final production este deschis.
2. **Provider coverage / vendor dependency** - LinkedIn/Indeed si sursele dificil accesibile nu au inca strategie finala.
3. **JobsPipe/Apify pricing change la 24 septembrie 2026** - poate modifica raportul cost/coverage; subiectul este documentat in #142 si nu are inca decizie.
4. **Git + JSON ca storage operational** - bun pentru cost si single-user, dar ramane punct de cuplare intre date, publicare si source-control.

### Medium

5. **DEV/TEST/PROD isolation** - necesita maturizare pentru a controla quota, costul si trasabilitatea deploy-urilor.
6. **Operational connector state vs catalog state** - trebuie verificata permanent diferenta intre `connector code exists` si `source operational`.
7. **Endpoint stability** - anumite ATS routes/public pages pot evolua fara contract de stabilitate.
8. **AI integration governance** - bridge-ul este sigur pentru scope-ul actual, dar orice extindere la files/branches/PR trebuie sa pastreze branch safety si allowlisting strict.

### Low / controlat

9. accidental full-search triggers - controlat prin manual-only + CI guard;
10. protected asset drift - redus prin manifest comun/parity guard;
11. accidental direct write pe main - controlat prin Branch Target Safety Rule;
12. fixed UI polling timeout - rezolvat.

## 9. Concluzie AS-IS

Aplicatia are o arhitectura rezonabila si bine directionata pentru obiectivul sau actual: produs personal, single-user, cost minim, cu proces de cautare relativ greu separat de UI si executat controlat.

Arhitectura nu este supra-dimensionata: folosirea Cloudflare Worker + GitHub Actions + Python + JSON evita introducerea prematura a unei baze de date si a unui backend permanent. Aceasta alegere ramane potrivita atata timp cat volumul, numarul de utilizatori si necesarul de concurenta raman reduse.

Maturizarea din ultimele zile este vizibila in special prin eliminarea unor riscuri reale, nu doar prin adaugare de functionalitati: manual-only execution, canonical nomenclatures, protected asset manifest, source governance, branch safety, immutable deploy rules si separarea AI GitHub bridge.

Totusi, la 10 septembrie 2026, proiectul nu trebuie prezentat tehnic ca un release complet stabil. Starea corecta este:

```text
Application baseline: 0.06-dev
Architecture: v1.9
Core runtime: functional
Package 2A: substantially implemented
Package 2A8: implemented + CI/preview validated, final PROD E2E pending
JobsPipe: disabled, strategy under analysis
Remote MCP Claude: deployed and validated live
Next packages 2B/2C/2D/2E: not complete
```

Nu se ia prin acest assessment nicio decizie noua de arhitectura si nu se autorizeaza implementare.