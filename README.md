# Job Search Command Center

Aplicatie personala pentru monitorizarea, filtrarea si evaluarea rolurilor relevante de Project Management.

## Obiectiv

- roluri publicate in ultimele 24 de ore;
- verificare de doua ori pe zi;
- remote in Europa si Romania, apoi hibrid, apoi onsite in Bucuresti;
- prioritate pentru contracte B2B de 250-650 EUR/zi;
- fit, riscuri, descriere si link direct la pagina de aplicare;
- repostarile sunt marcate, nu ascunse.

## Arhitectura MVP

```text
GitHub Actions -> data/*.json -> GitHub Pages -> browser
```

GitHub Actions executa cautarea programata, filtreaza si genereaza datele publicabile. Frontend-ul static consuma aceste fisiere JSON.

Nu exista in MVP un backend public permanent sau o baza de date server activa.

## Structura

- `frontend/` - interfata web statica;
- `data/` - rezultate, stare rulare, surse si aplicari;
- `docs/` - cerinte, arhitectura, contracte si strategia surselor;
- `.github/workflows/` - cautare programata si deploy GitHub Pages;
- `backend/` - rezervat pentru o etapa ulterioara daca apare o nevoie reala de backend persistent.

## Persistenta

- rezultate cautare: `data/jobs.json`;
- stare rulare: `data/run-status.json`;
- aplicari: `data/applications.json`;
- registru surse: `data/sources.json`;
- secrete: GitHub Actions Secrets.

## Evolutie

SQLite si backend-ul modular monolith raman optiunea preferata daca apar cerinte precum configuratie multi-device, rulare interactiva securizata, autentificare, documente private, istoric extins sau MCP.
