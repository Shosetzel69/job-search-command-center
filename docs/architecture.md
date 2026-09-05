# Arhitectura

Actualizare: 2026-09-05
Versiune aplicatie: 0.04

## 1. Principiu

MVP-ul este `static-first + serverless command/access-control`.

```text
Browser
  -> Cloudflare Worker
      -> React Static Assets
      -> Google auth
      -> protected /data/*
      -> Command API
          -> GitHub Actions
              -> job_search_runner.py
                  -> disabled / apify / direct
                  -> normalize / filter / score
              -> data/*.json
              -> commit main
                  -> Cloudflare deploy
```

Nu exista baza de date activa.

## 2. Frontend

- React 18.3.1;
- Tailwind CSS 3.4.17;
- Vite 5.4.14;
- token Google numai in memoria React;
- datele protejate se incarca numai dupa validarea sesiunii;
- erorile de date nu produc logout automat.

## 3. Cloudflare Worker

Entry point: `command-api/src/secure-entry.js`.

Endpoint-uri:

- `GET /health`;
- `GET /auth/config`;
- `POST /auth/session`;
- `POST /commands/run`;
- `PUT /config`;
- `GET /data/*` pentru fisierele protejate.

Worker-ul valideaza Google JWT, issuer, audience si `ALLOWED_GOOGLE_SUB`.

## 4. GitHub Actions

Workflow principal: `.github/workflows/job-search-full.yml`.

Trigger-uri:

- schimbari in configuratie/cod motor;
- `workflow_dispatch`;
- schedule `0 6,15 * * *` UTC.

Workflow-ul primeste `APIFY_TOKEN` si `JOBSPIPE_API_KEY` numai din GitHub Actions Secrets.

## 5. Motor cautare

- `scripts/job_search.py` - model intern, normalizare, filtrare, scoring;
- `scripts/job_search_optimized.py` - JobsPipe Direct;
- `scripts/job_search_apify.py` - JobsPipe prin Actorul oficial Apify;
- `scripts/job_search_runner.py` - selector `disabled/apify/direct` si orchestrare.

Pipeline:

`Collect -> Normalize -> Validate -> Geo Eligibility -> Deduplicate/Repost -> Filter -> Score -> Publish`

## 6. JobsPipe

Stare curenta canonica:

- `jobspipe_mode=apify`;
- `jobspipe_apify_max_items_per_run=100`.

### Apify

- Actor: `jobspipe~jobspipe-job-search`;
- autentificare: `APIFY_TOKEN`;
- doua cautari fara suprapunere: geografiile prioritare si restul Europei remote eligibile;
- Actorul gestioneaza paginarea;
- plafon configurabil 100-20.000 joburi brute/rulare;
- rezultatele intra in pipeline-ul comun.

### Direct

- autentificare: `JOBSPIPE_API_KEY`;
- preview gratuit;
- polling incremental cu `discovered_at_gte`;
- cursor backlog;
- buget implicit 14 credite/rulare;
- guard lunar 950;
- overlap 2 minute;
- circuit breaker la quota exhausted.

`data/search-state.json` este folosit pentru starea incrementala Direct.

## 7. Persistenta

Canonica in repository:

- `data/jobs.json`;
- `data/run-status.json`;
- `data/search-config.json`;
- `data/sources.json`;
- `data/applications.json`;
- `data/search-state.json` intern.

## 8. Surse

`data/sources.json` este catalog UI, nu lista connectorilor operationali.

Toggle-urile individuale sunt locale. Campul legacy `priority` nu controleaza colectarea. Strategia tinta ramane `all active sources equally`.

## 9. Build si securitate

Cloudflare publica bundle-ul React si numai fisierele JSON protejate necesare. `search-state.json` nu este publicat.

Repository-ul ramane privat. GitHub Pages nu este folosit.
