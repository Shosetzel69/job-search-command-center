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

GitHub Actions
  |
  +--> rulare programata de doua ori pe zi
  +--> rulare manuala prin workflow_dispatch
  +--> colectare surse
  +--> normalizare
  +--> geo-eligibility
  +--> filtrare si scoring
  +--> deduplicare
  +--> generare JSON
  |
  v
Repository GitHub
  |
  v
GitHub Pages
```

Nu exista in MVP un backend public permanent si nici un server de baza de date activ.

## 2. Frontend

- frontend static in `frontend/`;
- publicare prin GitHub Pages;
- citeste rezultatele generate de workflow;
- afiseaza descrierea jobului, linkul direct, fit, riscuri si sursa;
- nu contine secrete;
- configuratia locala din browser nu este considerata sursa unica de adevar pentru executia workflow-ului.

ChatGPT Sites ramane optional pentru prototipare, nu dependinta runtime a MVP-ului curent.

## 3. Motor de executie

Motorul MVP este GitHub Actions.

Responsabilitati:

- schedule de doua ori pe zi;
- rulare manuala;
- orchestrare surse active;
- toate sursele active sunt tratate egal, fara limita de 5 prioritare;
- eroarea unei surse nu opreste procesarea celorlalte;
- progres si rezultat persistate in `data/run-status.json`;
- rezultatele persistate in `data/jobs.json`.

## 4. Connectors si surse

Se pastreaza principiul de connector separat per tip de sursa/API.

Fiecare connector trebuie sa produca acelasi model intern de job.

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

Registrul surselor si starea active/inactive trebuie sa devina o configuratie persistenta comuna pentru UI si workflow.

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

Repostarile sunt marcate, nu eliminate automat.

## 6. Persistenta

Pentru MVP curent:

- rezultate publicabile: JSON versionat in repository;
- stare rulare: JSON versionat in repository;
- configuratie persistenta: de definit si separata de `localStorage`;
- secrete: GitHub Actions Secrets.

SQLite nu este necesar pentru fluxul static-first curent.

SQLite ramane optiunea preferata daca introducem un backend persistent, istoric complex, aplicari editabile server-side sau configuratie multi-device.

PostgreSQL ramane rezervat pentru multi-user, concurenta ridicata sau replicare.

## 7. Rulare din interfata

Frontend-ul static nu va contine GitHub PAT, API keys sau alte secrete.

Butonul `Ruleaza verificarea` nu poate apela direct GitHub Actions folosind un secret expus in browser.

Pentru rulare initiata de utilizator este necesar un mecanism securizat intermediar sau o capabilitate autorizata care executa `workflow_dispatch` fara expunerea credentialelor.

Pana la implementarea acestui mecanism, schedule-ul GitHub Actions ramane metoda principala de executie.

## 8. Publicare

Tinta MVP:

```text
GitHub Actions -> data/*.json -> GitHub Pages -> browser
```

Publicarea paginii statice trebuie automatizata dupa actualizarea datelor sau a frontend-ului.

## 9. Securitate

- toate cheile API stau in GitHub Actions Secrets;
- niciun secret in frontend, JSON public sau repository;
- permisiunile workflow-urilor sunt minime;
- inputurile externe sunt tratate ca date nevalidate;
- descrierea jobului este afisata ca text sigur, fara executie HTML arbitrar;
- linkurile externe se deschid separat si folosesc protectiile browserului;
- workflow-urile au timeout si concurrency control.

## 10. NAS Synology DS213j

DS213j nu este host principal pentru aplicatie.

Rol permis:

- backup;
- arhiva;
- storage offline/local.

Nu se foloseste pentru Docker/Container Manager sau backend Node modern.

## 11. Integrari Google

Nu sunt necesare pentru fluxul MVP de cautare.

Planificate optional:

- Sign in with Google daca apare autentificare reala;
- Gmail pentru notificari;
- Google Sheets pentru export;
- Google Drive pentru backup;
- Google Calendar pentru follow-up-uri, etapa 2.

Google nu este sursa de agregare a joburilor.

## 12. MCP

MCP ramane in afara MVP-ului.

Poate fi introdus in etapa 2 daca este necesar acces AI direct la functiile sistemului.

## 13. Evolutie

Introducem backend + SQLite numai daca apar cerinte care nu pot fi rezolvate curat in modelul static-first, de exemplu:

- configuratie persistenta multi-device;
- rulare interactiva securizata;
- istoric extins si audit;
- aplicari editabile server-side;
- autentificare;
- documente private;
- integrare MCP.
