# Arhitectura

Actualizare: 2026-09-06
Versiune aplicatie: 0.05

## 1. Principiu

MVP-ul este `static-first + serverless command/access-control`.

```text
Browser
  -> Cloudflare Worker
      -> React Static Assets
      -> Google auth
      -> protected /data/*
      -> Command API
          -> GitHub Contents API pentru configuratie si Surse
          -> GitHub Actions
              -> job_search_runner.py
                  -> disabled / apify / direct
                  -> normalize / geo / filter / score
                  -> run history
              -> data/*.json
              -> commit main cu retry la conflict concurent
                  -> Cloudflare deploy
```

Nu exista baza de date activa.

## 2. Frontend

- React 18.3.1;
- Tailwind CSS 3.4.17;
- Vite 5.4.14;
- versiune aplicatie 0.05;
- token Google numai in memoria React;
- datele protejate se incarca numai dupa validarea sesiunii;
- erorile de date nu produc logout automat;
- pagini: Joburi noi, De evaluat, Aplicari, Criterii de selectie, Surse, Loguri;
- KPI-urile din Joburi noi sunt filtre locale single-select;
- modelul UI consuma explicit `countries`, `country_codes` si `remote_scope`.

## 3. Cloudflare Worker

Entry point: `command-api/src/secure-entry.js`.

Endpoint-uri:

- `GET /health`;
- `GET /auth/config`;
- `POST /auth/session`;
- `POST /commands/run`;
- `PUT /config`;
- `POST /sources`;
- `PUT /sources/:id`;
- `DELETE /sources/:id`;
- `GET /data/*` pentru fisierele protejate.

Worker-ul valideaza Google JWT, issuer, audience si `ALLOWED_GOOGLE_SUB`.

`run-history.json` este in allowlist-ul datelor protejate.

## 4. GitHub Actions

Workflow principal: `.github/workflows/job-search-full.yml`.

Trigger-uri:

- schimbari in configuratie/cod motor;
- `workflow_dispatch`;
- schedule `0 6,15 * * *` UTC.

Workflow-ul primeste `APIFY_TOKEN` si `JOBSPIPE_API_KEY` numai din GitHub Actions Secrets.

Publicarea datelor:

1. runner-ul genereaza joburi, status, run history si stare interna;
2. fisierele generate sunt salvate temporar;
3. workflow-ul reincarca ultimul `main`;
4. reaplica numai fisierele generate;
5. incearca push;
6. daca `main` s-a modificat intre timp, repeta de maximum 3 ori.

Acest mecanism evita conflictul de rebase pentru fisierele runtime.

## 5. Motor cautare

- `scripts/job_search.py` - normalizare canonica, geografie, filtrare si scoring;
- `scripts/job_search_optimized.py` - JobsPipe Direct incremental/credit-aware;
- `scripts/job_search_apify.py` - JobsPipe prin Actorul oficial Apify;
- `scripts/job_search_runner.py` - selector transport, status si istoric ultimele 10 rulari;
- `scripts/test_search_logic.py` - teste de regresie pentru geografie si surse.

Pipeline:

`Collect -> Normalize -> Geo Eligibility -> Deduplicate/Repost -> Filter -> Score -> Publish`

Geografia este normalizata separat de FIT.

## 6. Geografie

Configuratia canonica foloseste:

- `target_regions`;
- `target_country_codes`;
- `excluded_regions`;
- `excluded_country_codes`.

Regiuni initiale disponibile: `EU`, `US`, `ASIA`.

Modelul unui job poate contine:

- `countries`;
- `country_codes`;
- `remote_scope` = `Worldwide`, `EU`, `EMEA`, `Country` sau `Unknown`;
- `romania_eligible` pentru Remote.

Reguli principale:

- Remote fara teritoriu explicit = Worldwide;
- Remote cu tari explicite necesita Romania;
- Worldwide nu este eliminat de o excludere regionala;
- includerile si excluderile conflictuale sunt respinse atat in UI/Command API, cat si la incarcarea configuratiei.

## 7. JobsPipe

Stare curenta canonica:

- `jobspipe_mode=apify`;
- `jobspipe_apify_max_items_per_run=100`.

### Apify

- Actor: `jobspipe~jobspipe-job-search`;
- autentificare: `APIFY_TOKEN`;
- colectare pentru geografia tinta + colectare Remote larga;
- Actorul gestioneaza paginarea;
- plafon configurabil 100-20.000 joburi brute/rulare;
- filtrarea geografica finala este facuta in pipeline-ul comun;
- Apify este transport, nu sursa separata: sursa este JobsPipe.

### Direct

- autentificare: `JOBSPIPE_API_KEY`;
- preview gratuit;
- polling incremental cu `discovered_at_gte`;
- cursor backlog pastrat pana la epuizare;
- query geografie tinta + Remote scope larg;
- buget implicit 14 credite/rulare;
- guard lunar 950;
- overlap 2 minute;
- circuit breaker la quota exhausted.

`data/search-state.json` este folosit pentru starea incrementala Direct.

## 8. Persistenta

Canonica in repository:

- `data/jobs.json`;
- `data/run-status.json`;
- `data/run-history.json` - maximum 10 rulari;
- `data/search-config.json`;
- `data/sources.json`;
- `data/applications.json`;
- `data/search-state.json` intern.

## 9. Surse

`data/sources.json` este catalogul UI, distinct de connectorii operationali.

Administrarea se face prin Command API autentificat:

- create;
- edit;
- activate/deactivate;
- hard delete.

La prima modificare persistenta, catalogul legacy este normalizat la schema 1.0 cu ID stabil si `connector_available`. Campul legacy `priority` nu este pastrat in modelul normalizat.

O sursa adaugata in catalog nu devine operationala daca nu exista connector.

## 10. Build, CI si securitate

Cloudflare publica bundle-ul React si fisierele JSON protejate necesare. `search-state.json` nu este publicat.

CI valideaza:

- sintaxa Python;
- configuratia geografica;
- teste de regresie search logic;
- JSON;
- React/Vite production build;
- Cloudflare Worker dry-run.

Repository-ul ramane privat. GitHub Pages nu este folosit.

## 11. Status verificare

- CI pentru implementarea 0.05: validat;
- test E2E complet pe deploy-ul live 0.05: de confirmat;
- issue-urile #34-#40 raman deschise pana la validarea live.
