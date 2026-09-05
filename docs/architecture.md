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

Nu exista in MVP un backend public permanent si nici un server de baza de date activ.

## 2. Frontend

- frontend static in `frontend/`;
- publicare prin GitHub Pages;
- citeste rezultatele generate de workflow;
- citeste configuratia canonica din `data/search-config.json`;
- afiseaza descrierea jobului, linkul direct, fit, riscuri si sursa;
- nu contine secrete;
- modificarile locale din browser nu sunt configuratie efectiva pana cand nu sunt persistate securizat.

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
- secrete: GitHub Actions Secrets.

SQLite nu este necesar pentru fluxul static-first curent.

SQLite ramane optiunea preferata daca introducem un backend persistent, istoric complex, aplicari editabile server-side sau configuratie multi-device.

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

Frontend-ul o citeste. Workflow-ul o foloseste efectiv.

Scrierea configuratiei din frontend necesita un mecanism securizat si este urmarita separat.

## 8. Rulare din interfata

Frontend-ul static nu va contine GitHub PAT, API keys sau alte secrete.

Butonul `Ruleaza verificarea` nu poate apela direct GitHub Actions folosind un secret expus in browser.

Pentru rulare initiata de utilizator este necesar un mecanism securizat intermediar sau o capabilitate autorizata care executa `workflow_dispatch` fara expunerea credentialelor.

Pana la implementarea acestui mecanism, schedule-ul GitHub Actions ramane metoda principala de executie.

## 9. Publicare

Tinta MVP:

```text
GitHub Actions -> data/*.json -> GitHub Pages -> browser
```

Workflow-ul de deploy este implementat. Activarea initiala a GitHub Pages la nivelul repository-ului ramane un pas administrativ manual.

## 10. Securitate

- toate cheile API stau in GitHub Actions Secrets;
- niciun secret in frontend, JSON public sau repository;
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

Nu sunt necesare pentru fluxul MVP de cautare.

Planificate optional:

- Sign in with Google daca apare autentificare reala;
- Gmail pentru notificari;
- Google Sheets pentru export;
- Google Drive pentru backup;
- Google Calendar pentru follow-up-uri, etapa 2.

Google nu este sursa de agregare a joburilor.

## 13. MCP

MCP ramane in afara MVP-ului.

Poate fi introdus in etapa 2 daca este necesar acces AI direct la functiile sistemului.

## 14. Evolutie

Introducem backend + SQLite numai daca apar cerinte care nu pot fi rezolvate curat in modelul static-first, de exemplu:

- configuratie persistenta multi-device;
- rulare interactiva securizata;
- istoric extins si audit;
- aplicari editabile server-side;
- autentificare;
- documente private;
- integrare MCP.
