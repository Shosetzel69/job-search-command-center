# ARCHITECTURE.md — Job Search Command Center

Versiune document: `v1.4`
Versiune aplicatie de referinta: `0.05`
Ultima actualizare: `2026-09-06`

## Preambul

Acest document este **sursa unica de adevar pentru structura tehnica a proiectului**.

Se foloseste ca referinta la inceputul fiecarei sesiuni noi de lucru cu AI, astfel incat contextul tehnic existent sa nu fie pierdut si componentele functionale sa nu fie rescrise sau alterate din lipsa de informatie.

Documentul acopera:

- scopul aplicatiei;
- principiile arhitecturale;
- componentele si responsabilitatile lor;
- fluxurile principale de date;
- sursele si connectorii;
- stack-ul tehnic;
- persistenta;
- regulile de baza de securitate;
- schimbarile care necesita ADR;
- limitarile si componentele planificate;
- statusul implementarii.

Este complementar cu:

- `GOVERNANCE.md` — reguli de proces, aprobare si control;
- `.ai-instructions.md` — reguli de comportament pentru AI.

Daca acest document intra in contradictie cu implementarea din repository, contradictia trebuie semnalata si clarificata inainte de modificarea codului.

AI-ul nu presupune existenta unei componente care nu este documentata ca implementata si nu modifica limitele arhitecturale fara aprobarea prevazuta in `GOVERNANCE.md`.

---

## 1. Scop

Aplicatia agrega, filtreaza si prioritizeaza joburi din surse multiple, pe baza regulilor definite de utilizator.

Nu este un motor de cautare generic. Este un sistem de:

- colectare;
- normalizare;
- filtrare;
- verificare eligibilitate;
- deduplicare;
- scoring;
- selectie si prioritizare.

Interfata permite si administrarea criteriilor de selectie, surselor, aplicarilor si rularilor sistemului.

---

## 2. Principii arhitecturale

Arhitectura MVP este:

**`static-first + serverless command/access-control`**

Principii:

- frontend static;
- operatiile privilegiate trec prin Cloudflare Worker;
- procesarea joburilor este separata de frontend;
- executia cautarilor este orchestrata prin GitHub Actions;
- motorul de cautare este independent de UI;
- sursele sunt normalizate intr-un model comun;
- geo-eligibility este separata de FIT/scoring;
- catalogul surselor este separat de rutele si connectorii operationali;
- secretele nu ajung in browser;
- costul operational este mentinut redus;
- componentele planificate nu sunt tratate ca implementate.

---

## 3. Componente

| Componenta | Responsabilitate | Nu face |
|---|---|---|
| `frontend` | UI, filtre locale, autentificare Google, vizualizare si configurare | Nu acceseaza GitHub direct si nu ruleaza motorul de cautare |
| `Cloudflare Worker / Command API` | autentificare, autorizare, protectie date, comenzi, configuratie, CRUD Surse | Nu executa matching/scoring |
| `GitHub Actions` | scheduling, orchestration, secrets provider, executie search engine, publicare rezultate | Nu implementeaza logica UI |
| `search engine` | normalizare, geografie, dedupe/repost, filtrare si scoring | Nu gestioneaza autentificarea |
| `connectors` | colecteaza date de la providerii externi | Nu decid FIT sau prioritatea finala |
| `runtime data` | persistenta starii si rezultatelor in fisiere JSON versionate | Nu reprezinta o baza de date relationala |

---

## 4. Frontend

Stack:

- React 18.3.1;
- Tailwind CSS 3.4.17;
- Vite 5.4.14.

Responsabilitati principale:

- autentificare;
- afisare joburi;
- filtre locale;
- afisare FIT si detalii;
- configurare criterii;
- administrare Surse;
- Aplicari;
- Loguri;
- lansare manuala cautare.

Pagini curente:

- Joburi noi;
- De evaluat;
- Aplicari;
- Criterii de selectie;
- Surse;
- Loguri.

Frontend-ul nu foloseste credentiale GitHub si nu acceseaza direct repository-ul.

---

## 5. Cloudflare Worker / Command API

Entry point:

`command-api/src/secure-entry.js`

Responsabilitati:

- validare Google Identity;
- autorizare acces;
- protectie `/data/*`;
- lansare cautare;
- persistare configuratie;
- CRUD pentru Surse;
- acces la GitHub Actions API;
- acces la GitHub Contents API.

Endpoint-uri curente:

- `GET /health`;
- `GET /auth/config`;
- `POST /auth/session`;
- `POST /commands/run`;
- `PUT /config`;
- `POST /sources`;
- `PUT /sources/:id`;
- `DELETE /sources/:id`;
- `GET /data/*`.

Worker-ul nu executa motorul de cautare.

---

## 6. GitHub Actions

Workflow principal:

`.github/workflows/job-search-full.yml`

Trigger-uri:

- `workflow_dispatch`;
- schedule;
- modificari relevante in configuratie sau motor.

Schedule curent:

`0 6,15 * * * UTC`

Responsabilitati:

- executa motorul de cautare;
- furnizeaza secretele providerilor;
- instaleaza dependintele runtime necesare colectarii, inclusiv Chromium pentru fallback-ul web;
- genereaza fisierele runtime;
- publica rezultatele in repository;
- gestioneaza conflictele concurente la publicare.

Publicarea foloseste retry de maximum 3 ori daca `main` se modifica in timpul executiei.

---

## 7. Search Engine

Entry point:

`scripts/job_search_runner.py`

Componente:

- `job_search.py` — normalizare canonica, geografie, filtrare si scoring;
- `job_search_optimized.py` — JobsPipe Direct;
- `job_search_apify.py` — JobsPipe prin Apify;
- `job_search_runner.py` — orchestration, transport, status si run history;
- `source_orchestration.py` — plan din catalog, rutare operationala si raportare per sursa;
- `job_search_jobicy.py` — API public Jobicy;
- `job_search_public_api.py` — adaptoare publice Jobgether, Himalayas, Working Nomads, Remote OK, Remotive si board-uri SmartRecruiters/Greenhouse/Ashby;
- `job_search_web.py` — descoperire si extractie web generica;
- `web_transport.py` — transport HTTP public cu limite, robots si DNS verificat;
- `web_browser.py` — fallback Chromium/Playwright limitat pentru randare JavaScript dupa acces HTTP permis;
- `job_identity.py` — deduplicare intre surse;
- `shared/source-connectors.json` — detectia connectorilor dupa host;
- `shared/source-api-routes.json` — rute operationale separate de URL-ul uman din catalog;
- `test_search_logic.py`, `test_source_orchestration.py`, `test_public_api_connectors.py`, `test_web_collection.py` — teste de regresie.

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

Geo-eligibility este evaluata separat de FIT.

---

## 8. Surse si connectors

### 8.1 Principiu

Catalogul de surse, ruta operationala si connectorul sunt concepte diferite.

```text
Source catalog != Operational route != Connector
```

`data/sources.json` reprezinta catalogul gestionabil din UI si pastreaza URL-ul uman/canonic al sursei.

`shared/source-api-routes.json` poate indica un endpoint operational diferit pentru o sursa cunoscuta, fara a modifica URL-ul afisat si administrat in UI.

O sursa poate exista in catalog fara sa fie operationala.

Pentru colectare sunt necesare:

```text
active = true
+
strategie operationala permisa pentru sursa
```

`connector_available` descrie disponibilitatea unei metode de colectare deduse din URL; nu este o regula de scoring si nu este trimis de client ca autoritate.

### 8.2 Administrarea surselor

Din UI se poate:

- adauga;
- edita;
- activa/dezactiva;
- sterge.

Modificarile sunt persistate prin:

```text
Frontend
  -> Command API
  -> GitHub Contents API
  -> data/sources.json
```

URL-urile duplicate sunt respinse.

Secretele connectorilor nu sunt stocate in catalog sau in rutele operationale.

### 8.3 Connectori operationali curenti

Connectori dedicati implementati:

- JobsPipe;
- Jobicy;
- Jobgether;
- Himalayas;
- Working Nomads;
- Remote OK;
- Remotive;
- SmartRecruiters Public Posting API pentru board-uri concrete;
- Greenhouse Job Board API pentru board-uri concrete;
- Ashby Public Job Posting API pentru board-uri concrete.

API-urile publice noi nu necesita credentiale. Toate livreaza acelasi `CollectionResult`; filtrarea, geografia, deduplicarea si scoring-ul raman in motorul comun.

Politici de polling explicite:

- Jobicy: maximum o incercare/ora;
- Himalayas: maximum o incercare/24h;
- Remotive: maximum o incercare/6h.

Pentru API-urile ATS, data de publicare folosita pentru freshness este:

- SmartRecruiters: `releasedDate`, cu filtrare upstream prin `releasedAfter`;
- Greenhouse: `first_published` din detaliul jobului; `updated_at` este doar prefiltru;
- Ashby: `publishedAt`.

Un rezultat API fara data de publicare obligatorie este respins de adapter, pentru a nu ocoli implicit filtrul de freshness.

JobsPipe poate folosi doua transporturi:

```text
JobsPipe
  -> Apify
  -> Direct
```

Apify si Direct nu sunt surse distincte.

Stare runtime curenta:

```text
jobspipe_mode = disabled
jobspipe_apify_max_items_per_run = 100
```

Codul Apify si Direct ramane implementat, dar nu este apelat cat timp modul este `disabled`.

Runner-ul selecteaza toate sursele active cu strategie operationala. Daca exista o ruta in `shared/source-api-routes.json`, aceasta este folosita pentru colectare, iar URL-ul original ramane in diagnostic. URL-urile HTTP(S) fara adapter dedicat sunt incercate prin collectorul web, cu exceptia provider roots amanate explicit.

Provider roots generice amanate din collectorul generic:

- LinkedIn;
- Indeed;
- Workday;
- Greenhouse;
- Workable;
- SmartRecruiters;
- Ashby;
- Lever.

Radacina generica a unui ATS nu este tratata drept feed global. Un job board concret de companie SmartRecruiters, Greenhouse sau Ashby este eligibil pentru adapterul dedicat numai cand exista un identificator concret derivabil din ruta operationala.

Lever ramane fara adapter dedicat deoarece schema publica documentata nu ofera o data de publicare suficient de clara pentru regula de freshness. Un board Lever concret poate ramane pe colectare web daca accesul este permis.

### 8.4 Connectori noi

Un connector nou trebuie sa livreze date in modelul intern comun.

Logica de:

- geografie;
- deduplicare;
- filtrare;
- scoring;

nu trebuie duplicata in connector.

Adaugarea unui connector nou care respecta contractul existent nu necesita ADR.

Schimbarea contractului comun al connectorilor necesita ADR.

### 8.5 Surse URL generice

Connector generic pentru URL-uri simple / scraping:

**IMPLEMENTED - HTTP JobPosting JSON-LD + bounded browser fallback**

Collectorul foloseste HTTP ca prima metoda. Urmeaza linkuri de cariere, anunturi si paginare, cu 12 pagini si 45 secunde per sursa, maximum 12 surse concurente. Aplica robots.txt, restrictii de retea publica, limite de dimensiune si filtre pentru linkuri non-job.

Daca prima pagina este accesibila, pare dinamica si nu contine `JobPosting`, poate fi randata o singura data cu Chromium/Playwright. Browserul este limitat la domeniul sursei, maximum 2 sesiuni simultan si 8 secunde de randare. Nu ocoleste robots, autentificare, HTTP 401/403/429 sau CAPTCHA. HTML-ul rezultat reintra in parserul comun; nu exista extractor DOM generic separat.

Rezultatele intra in contractul comun existent. Pagina HTTP 200 sau pagina randata fara anunturi nu inseamna succes. Acoperirea exhaustiva a site-ului nu este garantata. ADR-001 documenteaza decizia initiala de colectare web; fallback-ul respecta acelasi contract si aceleasi limite de responsabilitate.

---

## 9. Fluxuri de date

### 9.1 Cautare joburi

```text
External Sources
      |
      v
Operational Route
      |
      v
Connector / Provider
      |
      v
job_search_runner.py
      |
      v
Normalize
      |
      v
Geo Eligibility
      |
      v
Deduplicate / Repost
      |
      v
Filter
      |
      v
Score
      |
      v
data/*.json
      |
      v
GitHub main
      |
      v
Cloudflare deploy
      |
      v
Frontend
```

### 9.2 Configuratie

```text
Frontend
   |
   v
Cloudflare Worker
   |
   v
GitHub Contents API
   |
   +--> data/search-config.json
   |
   +--> data/sources.json
```

Rutele operationale validate in Development sunt versionate separat in `shared/source-api-routes.json`; ele nu sunt editate din UI in MVP.

### 9.3 Lansare manuala

```text
Frontend
   |
   v
POST /commands/run
   |
   v
Cloudflare Worker
   |
   v
GitHub Actions
   |
   v
Search Engine
```

---

## 10. Persistenta

Nu exista baza de date activa.

Persistenta curenta foloseste fisiere JSON versionate in repository.

Fisiere canonice:

- `data/jobs.json`;
- `data/run-status.json`;
- `data/run-history.json`;
- `data/search-config.json`;
- `data/sources.json`;
- `data/applications.json`;
- `data/search-state.json`.

Configuratie statica de rutare:

- `shared/source-connectors.json`;
- `shared/source-api-routes.json`.

### Roluri

`jobs.json`
- rezultate publicate.

`run-status.json`
- statusul ultimei rulari.

`run-history.json`
- istoricul ultimelor 10 rulari.

`search-config.json`
- configuratia de cautare.

`sources.json`
- catalogul surselor.

`applications.json`
- istoricul aplicarilor.

`search-state.json`
- stare interna pentru polling/cooldown si JobsPipe Direct;
- nu este publicat frontend-ului.

Trecerea la alta forma de persistenta este schimbare arhitecturala si necesita ADR.

---

## 11. Autentificare si securitate

Autentificarea curenta foloseste Google Identity Services.

Browser-ul obtine Google ID token si il trimite catre Cloudflare Worker.

Worker-ul valideaza:

- semnatura Google JWT;
- issuer;
- audience;
- identitatea autorizata conform configuratiei curente.

Google ID token:

- ramane numai in memoria frontend-ului;
- nu este stocat in `localStorage`.

### Secrete Cloudflare

- `GITHUB_TOKEN`;
- configuratia de autorizare privata.

### Secrete GitHub Actions

- `APIFY_TOKEN`;
- `JOBSPIPE_API_KEY`.

API-urile publice implementate prin `job_search_public_api.py` nu necesita secrete.

Reguli:

- secretele nu se introduc in cod;
- secretele nu se introduc in documentatie;
- credentialele GitHub nu ajung in browser;
- `/data/*` protejat necesita autentificare;
- `search-state.json` nu este publicat;
- repository-ul ramane privat;
- HTTPS este obligatoriu.

Modelul viitor de utilizatori si autorizare nu este stabilit in acest document.

---

## 12. Build si deploy

Flux:

```text
React/Vite build
    |
    v
Cloudflare Static Assets
    |
    v
Cloudflare Worker
```

GitHub Actions genereaza datele runtime si le publica in `main`.

Modificarile publicate in `main` sunt preluate de procesul de deploy Cloudflare.

GitHub Pages nu este utilizat.

---

## 13. CI si verificare

CI valideaza cel putin:

- sintaxa Python, inclusiv adaptoarele publice;
- configuratia geografica;
- testele de regresie search logic;
- testele de connectori publici si rutare ATS;
- fisierele JSON de date si rutare;
- React/Vite production build;
- Cloudflare Worker dry-run.

Pentru logica critica trebuie mentinute teste pentru:

- geografie;
- deduplicare;
- filtrare;
- scoring;
- connectori;
- rutare surse si fallback web.

Testele connectorilor sunt izolate si nu efectueaza apeluri HTTP reale.

---

## 14. Schimbari care necesita ADR

Necesita ADR inainte de implementare:

- schimbarea stilului `static-first + serverless command/access-control`;
- introducerea sau inlocuirea mecanismului principal de persistenta;
- introducerea unei baze de date;
- schimbarea boundary-ului Cloudflare Worker / Command API;
- schimbarea majora a mecanismului de autentificare;
- schimbarea contractului comun al connectorilor;
- introducerea MCP;
- schimbarea majora a modului de executie/orchestrare;
- schimbarea arhitecturii pentru suport multi-user.

Nu necesita ADR:

- connector nou care respecta contractul existent;
- ruta operationala noua pentru o sursa existenta;
- sursa noua in catalog;
- modificare UI fara impact arhitectural;
- regula noua de filtrare/scoring aprobata ca requirement;
- bugfix;
- refactor local fara schimbarea responsabilitatilor componentelor.

---

## 15. Componente planificate / neimplementate

### Multi-user

Status:

**UNDER ANALYSIS**

Modelul de utilizatori, autorizare si persistenta asociata nu este inca aprobat.

### MCP

Status:

**NOT IMPLEMENTED**

Introducerea MCP necesita ADR.

### Notifications / email

Status:

**NOT IMPLEMENTED**

Nu exista momentan flux automat de notificari email.

### Connector generic URL / scraping

Status:

**IMPLEMENTED - JSON-LD + fallback JavaScript limitat**

HTTP ramane metoda principala pentru sursele fara adapter. Chromium este folosit o singura data pentru prima pagina dinamica eligibila. Site-urile care raman fara `JobPosting` pot necesita extractori specifici; rezultatul incercarii este vizibil in Loguri.

### Additional providers

Status:

**PARTIAL IMPLEMENTATION**

Pe langa JobsPipe si Jobicy sunt implementate adaptoare fara credentiale pentru Jobgether, Himalayas, Working Nomads, Remote OK, Remotive, SmartRecruiters, Greenhouse si Ashby. Radacinile generice LinkedIn, Indeed, Workday, Workable si Lever raman amanate sau necesita alta strategie autorizata. JobsPipe este momentan dezactivat.

---

## 16. Status implementare

### Core platform

- [x] React frontend
- [x] Tailwind CSS
- [x] Vite build
- [x] Cloudflare Worker
- [x] Google authentication
- [x] Protected data access
- [x] Command API
- [x] GitHub Actions orchestration
- [x] Manual search trigger
- [x] Scheduled search

### Search engine

- [x] Normalize
- [x] Geo eligibility
- [x] Deduplicate / repost
- [x] Filter
- [x] Score
- [x] Publish
- [x] Regression tests

### Sources

- [x] Source catalog
- [x] CRUD Surse
- [x] JobsPipe connector
- [x] JobsPipe via Apify
- [x] JobsPipe Direct fallback
- [x] Jobicy public API
- [x] Jobgether public API
- [x] Himalayas public API
- [x] Working Nomads public feed
- [x] Remote OK public API
- [x] Remotive public API
- [x] SmartRecruiters company-board adapter
- [x] Greenhouse company-board adapter
- [x] Ashby company-board adapter
- [x] Operational route registry separate from source catalog
- [x] Generic URL collector (HTTP/JSON-LD)
- [x] Bounded Chromium/Playwright fallback
- [x] Deferred generic provider-root routing

### Runtime

- [x] Search configuration
- [x] Jobs persistence
- [x] Run status
- [x] Run history
- [x] Applications data
- [x] Polling / Direct search state

### Future

- [ ] Multi-user architecture
- [ ] Notifications
- [ ] MCP

---

## 17. Versionarea documentului

Schema de versionare:

- `v1.0`, `v2.0`, `v3.0` etc. pentru schimbari majore de structura sau arhitectura;
- `v1.1`, `v1.2`, `v1.3` etc. pentru actualizari obisnuite care nu schimba fundamental arhitectura.

Orice schimbare tehnica propusa care ar necesita cresterea versiunii majore trebuie semnalata explicit utilizatorului **inainte de implementare**, impreuna cu motivul si impactul estimat.

Politica de pastrare:

- se pastreaza ultimele 3 versiuni majore anterioare;
- pentru versiunea majora curenta se pastreaza ultimele 10 versiuni minore;
- versiunea curenta ramane `ARCHITECTURE.md` in radacina repository-ului;
- versiunile istorice se pastreaza in `docs/archive/architecture/` folosind formatul `ARCHITECTURE-vX.Y.md`;
- la fiecare modificare a documentului, versiunea se actualizeaza in header inainte de merge.

---

## 18. Status document

Versiune document:

**v1.4**

Versiune aplicatie de referinta:

**0.05**

Ultima actualizare:

**2026-09-06**

Acest document trebuie actualizat atunci cand o schimbare aprobata modifica structura tehnica, responsabilitatea componentelor, fluxurile principale sau limitele arhitecturale.
