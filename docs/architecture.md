# Arhitectura

## 1. Arhitectura MVP curenta

Fluxul de baza este static-first:

```text
Utilizator
  |
  v
Frontend static (GitHub Pages)
  |
  +--> data/jobs.json
  +--> data/run-status.json
  +--> data/search-config.json
  |
  +--> Google Sign-In -> Command API (Cloudflare Worker)
                         |
                         +--> GitHub workflow_dispatch
                         +--> GitHub Contents API

GitHub Actions
  |
  v
scripts/job_search.py
  |
  +--> connectors
  +--> normalizare
  +--> geo-eligibility
  +--> deduplicare / repost
  +--> filtrare
  +--> scoring
  |
  v
JSON versionat in repository
  |
  v
GitHub Pages
```

Nu exista in MVP un backend public permanent pentru datele de joburi si nici un server de baza de date activ.

Command API este o componenta serverless minima pentru actiuni privilegiate; nu devine backend-ul principal al aplicatiei.

## 2. Frontend

- frontend static in `frontend/`;
- publicare prin GitHub Pages;
- citeste rezultatele generate de workflow;
- citeste configuratia canonica din `data/search-config.json`;
- afiseaza descrierea jobului, linkul direct, fit, riscuri si sursa;
- nu contine secrete;
- modificarile locale din browser nu sunt configuratie efectiva pana cand nu sunt persistate prin Command API.

ChatGPT Sites ramane optional pentru prototipare, nu dependinta runtime a MVP-ului curent.

## 3. Motor de executie

GitHub Actions este schedulerul si orchestratorul infrastructural.

Logica de cautare nu mai este hard-codata in YAML. Ea ruleaza in `scripts/job_search.py`.

Responsabilitati GitHub Actions:

- schedule de doua ori pe zi;
- `workflow_dispatch` pentru rulare manuala autorizata;
- injectarea secretelor;
- timeout si concurrency control;
- executia motorului;
- validarea output-ului;
- commit-ul rezultatelor.

Responsabilitati motor cautare:

- citirea configuratiei canonice;
- executarea connectorilor;
- izolarea erorilor de colectare;
- normalizare si validare;
- geo-eligibility;
- deduplicare si detectare repostari;
- filtrare si scoring;
- generarea `jobs.json` si `run-status.json`.

## 4. Connectors si surse

Exista contractul `JobConnector`.

Primul adapter implementat este `JobsPipeConnector`.

Adaugarea unui provider nou trebuie sa se faca printr-un connector nou, fara modificarea logicii de scoring.

Fiecare connector trebuie sa produca date care pot fi transformate in acelasi model intern de job.

Campuri minime:

- id extern;
- source;
- title;
- company;
- location;
- work arrangement;
- description;
- date_posted;
- direct application URL;
- employment type;
- remote/hybrid;
- metadata necesara geo-eligibility.

Registrul `data/sources.json` ramane lista de surse vizibila in UI. Legarea active/inactive de executia reala a connectorilor este inca de implementat.

Toate sursele active trebuie tratate egal. Nu exista prioritate 1-5.

## 5. Procesare

Ordinea logica:

```text
Collect
  -> Normalize
  -> Validate
  -> Geo Eligibility
  -> Deduplicate / Detect Repost
  -> Filter
  -> Score
  -> Publish
```

Geo-eligibility ramane separat de matching/scoring.

Repostarile sunt marcate, nu eliminate automat, daca `keep_reposts=true`.

## 6. Persistenta

Pentru MVP curent:

- rezultate publicabile: `data/jobs.json`;
- stare rulare: `data/run-status.json`;
- configuratie canonica: `data/search-config.json`;
- registru surse: `data/sources.json`;
- aplicari: `data/applications.json`;
- secrete cautare: GitHub Actions Secrets;
- secrete Command API: Cloudflare Worker Secrets.

SQLite nu este necesar pentru fluxul static-first curent.

SQLite ramane optiunea preferata daca introducem un backend persistent, istoric complex, aplicari editabile server-side sau cerinte care depasesc modelul JSON/versionat.

PostgreSQL ramane rezervat pentru multi-user, concurenta ridicata sau replicare.

## 7. Configuratie

`data/search-config.json` este sursa de adevar pentru executia cautarii.

Contine:

- roluri;
- mod de lucru;
- vechime maxima;
- prag fit;
- regula repostari;
- interval B2B;
- disponibilitate;
- geografie;
- excluderi.

Frontend-ul o citeste. Motorul o foloseste efectiv.

Modificarile din UI sunt validate si persistate prin `PUT /config` al Command API. Pana la activarea live a Command API, modificarile UI raman locale.

## 8. Command API

Command API este implementat in `command-api/` ca Cloudflare Worker.

Roluri:

- autentifica utilizatorul prin Google ID token;
- autorizeaza un singur Google `sub` in MVP;
- protejeaza secretele GitHub;
- lanseaza manual `job-search-full.yml`;
- persista configuratia canonica.

Endpoint-uri:

```text
GET  /health
POST /commands/run
PUT  /config
```

Flux rulare manuala:

```text
Browser
  -> Google ID token
  -> Command API
  -> verifica user/origin
  -> verifica daca exista run activ
  -> GitHub workflow_dispatch
```

Flux salvare configuratie:

```text
Browser
  -> Google ID token
  -> Command API
  -> whitelist + validate
  -> GitHub Contents API
  -> data/search-config.json
  -> GitHub Actions
```

Fine-grained PAT-ul folosit de Worker este limitat la repository si necesita:

- `Actions: write`;
- `Contents: write`.

PAT-ul nu apare niciodata in frontend sau repository.

Detalii: `docs/command-api.md`.

## 9. Publicare

Tinta MVP:

```text
GitHub Actions -> data/*.json -> GitHub Pages -> browser
```

Workflow-ul de deploy este implementat. Activarea initiala a GitHub Pages la nivelul repository-ului ramane un pas administrativ manual.

## 10. Securitate

- toate cheile API pentru cautare stau in GitHub Actions Secrets;
- PAT-ul Command API sta in Cloudflare Secret;
- niciun secret in frontend, JSON public sau repository;
- Google ID token este verificat server-side prin JWKS, issuer si audience;
- autorizarea MVP foloseste Google `sub`;
- CORS este limitat la origin exact al frontend-ului;
- configuratia editabila foloseste whitelist si validare;
- permisiunile workflow-urilor sunt minime;
- inputurile externe sunt tratate ca date nevalidate;
- descrierea jobului este afisata ca text sigur, fara executie HTML arbitrar;
- linkurile externe folosesc `noopener noreferrer`;
- workflow-urile au timeout si concurrency control;
- un esec total de colectare nu suprascrie lista de joburi cu un rezultat gol fals;
- erorile de colectare sunt raportate in `source_results`.

## 11. NAS Synology DS213j

DS213j nu este host principal pentru aplicatie.

Rol permis:

- backup;
- arhiva;
- storage offline/local.

Nu se foloseste pentru Docker/Container Manager sau backend Node modern.

## 12. Integrari Google

Google Identity Services este folosit pentru autentificarea Command API dupa activarea live.

Alte integrari planificate optional:

- Gmail pentru notificari;
- Google Sheets pentru export;
- Google Drive pentru backup;
- Google Calendar pentru follow-up-uri, etapa 2.

Google nu este sursa de agregare a joburilor.

## 13. MCP

MCP ramane in afara MVP-ului.

Poate fi introdus in etapa 2 daca este necesar acces AI direct la functiile sistemului.

## 14. Evolutie

Introducem backend + SQLite numai daca apar cerinte care nu pot fi rezolvate curat in modelul static-first + Command API, de exemplu:

- istoric extins si audit tranzactional;
- aplicari editabile complex server-side;
- multi-user;
- documente private;
- integrare MCP cu stare persistenta;
- operatii care necesita o baza de date tranzactionala.
