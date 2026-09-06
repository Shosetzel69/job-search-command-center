# ARCHITECTURE.md — Job Search Command Center

Versiune document: `v1.2`
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
- catalogul surselor este separat de connectorii operationali;
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
- `source_orchestration.py` — plan din catalog, rutare si raportare per sursa;
- `job_search_jobicy.py` — API public Jobicy;
- `job_search_web.py`, `web_transport.py` — colectare pagini web si transport public cu limite/robots/DNS verificat;
- `job_identity.py` — deduplicare intre surse;
- `shared/source-connectors.json` — rutare comuna pentru Python, Worker si UI;
- `test_search_logic.py`, `test_source_orchestration.py` — teste de regresie.

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

Catalogul de surse si connectorii operationali sunt concepte diferite.

```text
Source catalog != Operational connectors
```

`data/sources.json` reprezinta catalogul gestionabil din UI.

O sursa poate exista in catalog fara sa fie operationala.

Pentru colectare sunt necesare:

```text
active = true
+
connector_available = true
```

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

Secretele connectorilor nu sunt stocate in catalog.

### 8.3 Connector operational curent

Connector operational:

**JobsPipe si Jobicy** (integrarea E2E Jobicy: de confirmat).

Runner-ul selecteaza toate sursele active suportate din catalog. Sursele HTTP(S) fara adapter dedicat sunt incercate prin collectorul web. URL-urile invalide sunt `unsupported`; paginile care nu produc anunturi extrase sunt raportate separat. Flag-ul `connector_available` este derivat din registrul implementat, nu din input-ul utilizatorului. JobsPipe are intrare explicita in catalog; eliminarea sau dezactivarea ei opreste colectarea providerului.

Jobicy foloseste API-ul public, maximum 200 listari recente, timeout 30 secunde si cel mult o incercare pe ora. Nu foloseste credentiale JobsPipe.

JobsPipe poate folosi doua transporturi:

```text
JobsPipe
  -> Apify
  -> Direct
```

Apify si Direct nu sunt surse distincte.

Stare curenta:

```text
jobspipe_mode = apify
jobspipe_apify_max_items_per_run = 100
```

Direct ramane fallback.

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

**IMPLEMENTED - JobPosting JSON-LD**

Collectorul urmeaza linkuri de cariere, anunturi si paginare, cu 12 pagini si 45 secunde per sursa, maximum 12 surse concurente. Aplica robots.txt, restrictii de retea publica si limite de dimensiune. Rezultatele intra in contractul comun existent. Pagina HTTP 200 fara anunturi nu inseamna succes. Acoperirea exhaustiva a site-ului nu este garantata. ADR-001 documenteaza decizia aprobata.

---

## 9. Fluxuri de date

### 9.1 Cautare joburi

```text
External Sources
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
- stare interna pentru JobsPipe Direct;
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

- sintaxa Python;
- configuratia geografica;
- testele de regresie search logic;
- fisierele JSON;
- React/Vite production build;
- Cloudflare Worker dry-run.

Pentru logica critica trebuie mentinute teste pentru:

- geografie;
- deduplicare;
- filtrare;
- scoring;
- connectori.

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

**IMPLEMENTED - JSON-LD, fara executie JavaScript**

Site-urile dinamice/fara JobPosting necesita extractori suplimentari; rezultatul incercarii este vizibil in Loguri.

### Additional providers

Status:

**PLANNED**

JobsPipe si Jobicy au connectori implementati. Celelalte surse HTTP(S) active sunt incercate prin colectare web, cu status explicit pe pagini si sursa.

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
- [x] Additional connector: Jobicy (E2E de confirmat)
- [x] Generic URL collector (JSON-LD, E2E de confirmat)

### Runtime

- [x] Search configuration
- [x] Jobs persistence
- [x] Run status
- [x] Run history
- [x] Applications data
- [x] Direct search state

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

**v1.2**

Versiune aplicatie de referinta:

**0.05**

Ultima actualizare:

**2026-09-06**

Acest document trebuie actualizat atunci cand o schimbare aprobata modifica structura tehnica, responsabilitatea componentelor, fluxurile principale sau limitele arhitecturale.

