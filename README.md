# Job Search Command Center

Aplicatie personala pentru monitorizarea, filtrarea si evaluarea rolurilor relevante de Project Management.

Versiune curenta UI: `0.03`

## Obiectiv

- monitorizare Project Manager / IT PM / Delivery / Service / Scrum / Program roles;
- Remote prioritar, apoi Hybrid;
- geografie prioritara RO / BE / LU si remote eligibil in Europa;
- B2B tinta 250-650 EUR/zi;
- FIT, riscuri, descriere si link direct la job;
- repostarile sunt marcate, nu ascunse;
- rulare programata de doua ori pe zi si rulare manuala din UI.

## Arhitectura MVP

```text
React + Tailwind + Vite
        |
        v
Cloudflare Worker + Static Assets
        |
        +--> Google auth
        +--> protected /data/*
        +--> Command API
                |
                +--> GitHub Actions
                +--> GitHub Contents API

GitHub Actions -> job search engine -> data/*.json -> commit main -> Cloudflare deploy
```

Repository-ul este privat. GitHub Pages nu este folosit.

Nu exista baza de date activa in MVP.

## Frontend

- React 18;
- Tailwind CSS;
- Vite;
- Google Identity Services;
- profil discret + logout;
- KPI-uri numai in `Joburi noi`;
- filtre 24h / 36h / 48h / 5 zile;
- Remote / Hibrid / Onsite / N/A;
- FIT crescator / descrescator;
- reset filtre;
- tabel compact cu actiuni la hover;
- criterii in grid responsive.

## Date protejate

Fisiere protejate de Cloudflare Worker:

- `data/jobs.json`;
- `data/run-status.json`;
- `data/search-config.json`;
- `data/sources.json`;
- `data/applications.json`.

Accesul necesita Google bearer token autorizat.

`data/search-state.json` este intern si nu este publicat.

## Search engine

Entry point:

`scripts/job_search_runner.py`

Componente:

- `job_search.py`;
- `job_search_optimized.py`;
- `job_search_runner.py`.

Pipeline:

`Collect -> Normalize -> Validate -> Geo Eligibility -> Dedup/Repost -> Filter -> Score -> Publish`

## JobsPipe

JobsPipe este connectorul operational implementat, dar este momentan oprit:

`jobspipe_enabled=false`

Cand va fi reactivat, foloseste:

- preview gratuit;
- polling incremental;
- cursor backlog;
- 14 credite maximum/rulare;
- guard lunar 950;
- circuit breaker quota.

## Structura repository

- `frontend/` - React/Tailwind/Vite;
- `command-api/` - Cloudflare Worker si build Static Assets;
- `scripts/` - motorul de cautare;
- `data/` - rezultate, configuratie si stare;
- `docs/` - cerinte, functionalitati, arhitectura, API, contracte si surse;
- `.github/workflows/` - search automation si validare build;
- `backend/` - rezervat pentru etapa ulterioara.

## Documentatie

- `docs/requirements.md` - cerinte functionale/non-functionale;
- `docs/functionalitati.md` - inventar functional curent;
- `docs/architecture.md` - arhitectura tehnica;
- `docs/command-api.md` - API, auth si securitate;
- `docs/data-contract.md` - contracte JSON;
- `docs/source-strategy.md` - strategia surselor.

## Rulare programata

Workflow-ul `Full job search` ruleaza la:

- 06:00 UTC;
- 15:00 UTC.

Poate fi pornit si manual din UI prin Command API.

## Persistenta

Canonica:

- rezultate: `data/jobs.json`;
- stare: `data/run-status.json`;
- configuratie: `data/search-config.json`;
- aplicari: `data/applications.json`;
- surse: `data/sources.json`;
- stare JobsPipe: `data/search-state.json`.

Locale in browser:

- arhivare rapida;
- toggle-uri individuale surse.

## Securitate

- JobsPipe key -> GitHub Actions Secret;
- GitHub PAT -> Cloudflare Secret;
- Google allowed user -> `ALLOWED_GOOGLE_SUB`;
- Google ID token -> numai memoria paginii;
- fara secrete in frontend sau repository.

## Status curent

- React/Vite build: validat CI;
- Worker build: validat CI;
- protected `/data/*`: implementat;
- auth/data retry flow: implementat in cod;
- E2E browser dupa refactorul React: de confirmat pe deploy-ul live.

## Evolutie

SQLite ramane optiunea preferata pentru istoric tranzactional, arhivare persistenta, aplicari editabile, documente private si MCP cu stare.

PostgreSQL este rezervat pentru multi-user si concurenta mai mare.
