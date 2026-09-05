# Arhitectura

Actualizare: 2026-09-05
Versiune aplicatie: 0.04

## 1. Principiu general

MVP-ul foloseste arhitectura `static-first + serverless command/access-control`.

Nu exista baza de date activa si nici backend persistent pentru datele de joburi.

```text
Utilizator / Browser
        |
        v
Cloudflare Worker
        |
        +--> Static Assets
        |      +--> React bundle
        |      +--> Tailwind CSS
        |      +--> Vite build
        |
        +--> Protected Data
        |      +--> /data/jobs.json
        |      +--> /data/run-status.json
        |      +--> /data/search-config.json
        |      +--> /data/sources.json
        |      +--> /data/applications.json
        |      +--> Google bearer auth
        |
        +--> Command API
               +--> GET  /health
               +--> GET  /auth/config
               +--> POST /auth/session
               +--> POST /commands/run
               +--> PUT  /config

GitHub Actions
        |
        v
scripts/job_search_runner.py
        |
        +--> job_search.py
        +--> job_search_optimized.py
        +--> job_search_apify.py
        +--> transport: disabled / apify / direct
        +--> connectors
        +--> normalize / validate
        +--> geo eligibility
        +--> dedup / repost
        +--> filter / score
        |
        v
data/*.json in repository privat
        |
        v
commit main
        |
        v
Cloudflare automatic build/deploy
```

## 2. Frontend

Frontend-ul este o aplicatie React statica.

### Tehnologii

- React 18.3.1;
- React DOM 18.3.1;
- Tailwind CSS 3.4.17;
- Vite 5.4.14;
- PostCSS + Autoprefixer.

### Structura

- `frontend/index.html` - shell Vite;
- `frontend/src/main.jsx` - componente si logica UI;
- `frontend/src/index.css` - Tailwind entry + reguli globale;
- `frontend/tailwind.config.js` - configuratie design system;
- `frontend/vite.config.js` - configuratie build.

Frontend-ul nu contine secrete.

## 3. Lifecycle autentificare si date

Fluxul este explicit si separa autentificarea de accesul la date.

```text
Pagina porneste
  -> GET /auth/config
  -> incarca Google Identity Services
  -> Google Sign-In
  -> POST /auth/session
      -> invalid: ramane signed-out
      -> valid: seteaza sesiunea in memoria React
  -> UI autentificat + stare Loading
  -> GET /data/*.json cu Authorization: Bearer
      -> succes: data state = ready
      -> eroare: data state = error, sesiunea ramane valida, Retry disponibil
```

Reguli:

- tokenul Google ramane doar in memoria paginii;
- nu se foloseste `localStorage` pentru token;
- o eroare de date nu produce logout automat;
- logout-ul goleste tokenul si datele din memoria React;
- nu se foloseste interceptare globala `window.fetch`;
- nu se foloseste monkey-patching intre scripturi.

## 4. State management frontend

React gestioneaza local:

- `auth`: signed-out / authenticating / authenticated;
- `data`: idle / loading / ready / error;
- jobs;
- applications;
- sources;
- run status;
- config canonica;
- criterii draft/saved;
- filtre locale;
- selected work modes;
- sortare FIT;
- drawer de detalii;
- profile dropdown;
- arhivare locala;
- toast-uri.

Nu exista state manager extern in MVP.

## 5. Design system si layout

Reguli curente:

- fundal general `slate-50`;
- carduri `white + border-slate-200 + shadow-sm`;
- albastru pentru actiunea primara si focus states;
- emerald/verde pentru stari active sau succes;
- profil neutru/outline;
- sidebar `slate-950`;
- continut principal centrat, maximum 1400 px;
- KPI-uri numai in `Joburi noi`;
- filtre in doua randuri;
- tabel compact cu actiuni la hover;
- criterii in grid responsive 1/2 coloane.

## 6. Cloudflare Worker

Worker-ul are doua responsabilitati:

1. serveste bundle-ul static;
2. executa access control si comenzile privilegiate.

Entry point:

`command-api/src/secure-entry.js`

Configuratia Wrangler foloseste:

- `assets.directory = ./public`;
- binding `ASSETS`;
- `run_worker_first` pentru `/health`, `/auth/*`, `/commands/*`, `/config`, `/data/*`.

## 7. Protectia datelor publicate

Fisierele copiate in bundle exista fizic in `command-api/public/data`, dar accesul HTTP este interceptat de Worker.

Allowlist protejata:

- `/data/jobs.json`;
- `/data/run-status.json`;
- `/data/search-config.json`;
- `/data/sources.json`;
- `/data/applications.json`.

Pentru `/data/*`:

- numai `GET` este permis;
- fisier necunoscut -> 404;
- fara bearer valid -> eroare auth;
- bearer valid -> asset servit prin `env.ASSETS.fetch`;
- raspunsurile folosesc `cache-control: no-store` si `x-content-type-options: nosniff`.

`data/search-state.json` nu este copiat in bundle.

## 8. Command API

Implementare:

`command-api/src/index.js`

Endpoint-uri:

```text
GET  /health
GET  /auth/config
POST /auth/session
POST /commands/run
PUT  /config
```

Responsabilitati:

- validare Google JWT prin JWKS;
- verificare issuer;
- verificare audience = `GOOGLE_CLIENT_ID`;
- autorizare `sub = ALLOWED_GOOGLE_SUB`;
- verificare origin pentru cererile privilegiate;
- workflow dispatch GitHub;
- persistenta configuratie prin GitHub Contents API.

Nu exista sesiuni server-side.

## 9. GitHub Actions

### Full job search

Workflow:

`.github/workflows/job-search-full.yml`

Trigger-uri:

- push pe configuratie/codul motorului;
- `workflow_dispatch`;
- schedule `0 6,15 * * *` UTC.

Responsabilitati:

- validare Python;
- executie `job_search_runner.py`;
- validare JSON;
- commit `jobs.json`, `run-status.json`, `search-state.json`;
- concurrency control;
- timeout 15 minute.

### Validate Command API

Workflow:

`.github/workflows/command-api-check.yml`

Valideaza:

- instalare dependinte Worker;
- build React/Vite;
- asamblare Static Assets;
- `wrangler deploy --dry-run`.

## 10. Motorul de cautare

Componente:

- `scripts/job_search.py` - model intern, normalizare, filtrare, scoring, contract output;
- `scripts/job_search_optimized.py` - transport JobsPipe Direct: preview, incremental, cursor si quota guards;
- `scripts/job_search_apify.py` - transport JobsPipe prin Actorul oficial Apify;
- `scripts/job_search_runner.py` - selector `disabled/apify/direct`, circuit breaker Direct si entry point workflow.

Pipeline:

```text
Collect
  -> Normalize
  -> Validate
  -> Geo Eligibility
  -> Deduplicate / Repost
  -> Filter
  -> Score
  -> Publish
```

## 11. Connectors si surse

Contractul `JobConnector` separa providerii de logica de scoring.

Connector logic implementat operational:

- JobsPipe, cu doua transporturi alternative: Apify si Direct.

Stare curenta:

- `jobspipe_mode=disabled` pentru stabilizare;
- cand este dezactivat, workflow-ul nu apeleaza JobsPipe/Apify si pastreaza lista existenta;
- dupa stabilizare, `apify` este transportul recomandat pentru volum;
- `direct` ramane fallback/diagnostic;
- `data/sources.json` este catalog UI, nu lista connectorilor implementati;
- toggle-urile individuale din pagina `Surse` sunt locale;
- campul legacy `priority` din catalog nu controleaza ordinea de colectare;
- strategia canonica este `all active sources equally` pentru momentul in care connectorii suplimentari sunt implementati.

## 12. JobsPipe transport strategy

### Apify

- Actor: `jobspipe~jobspipe-job-search`;
- autentificare prin `APIFY_TOKEN` din GitHub Actions Secrets;
- doua cautari fara suprapunere: geografiile prioritare si remote in restul Europei eligibile;
- Actorul pagineaza automat;
- plafon implicit 5.000 joburi brute/rulare, configurabil 100-20.000;
- rezultatele intra in acelasi pipeline de normalizare, dedup, filtrare si scoring.

### Direct

- `JOBSPIPE_API_KEY` din GitHub Actions Secrets;
- preview gratuit;
- `discovered_at_gte` pentru polling incremental;
- cursor pentru backlog;
- 14 credite/rulare implicit;
- guard local lunar 950;
- overlap incremental 2 minute;
- circuit breaker dupa quota exhausted.

Starea incrementala Direct este in `data/search-state.json`. Markerul vechi de quota a fost resetat deoarece exista quota noua, dar modul ramane dezactivat pana la stabilizare.

## 13. Persistenta

### Canonica in repository

- `data/jobs.json` - rezultate;
- `data/run-status.json` - stare ultima rulare;
- `data/search-config.json` - configuratie cautare;
- `data/sources.json` - catalog surse;
- `data/applications.json` - istoric aplicari;
- `data/search-state.json` - stare interna JobsPipe.

### Browser local

- preferinte temporare/UI;
- stare locala surse;
- arhivare rapida.

Tokenul Google nu este persistat.

## 14. Build si deploy

Build Cloudflare ruleaza din `command-api/`.

```text
npm run build
  -> npm --prefix ../frontend install
  -> npm --prefix ../frontend run build
  -> frontend/dist
  -> node scripts/build-static.mjs
  -> command-api/public
  -> Wrangler deploy
```

`build-static.mjs` copiaza numai:

- bundle-ul Vite;
- jobs.json;
- run-status.json;
- applications.json;
- sources.json;
- search-config.json.

Repository-ul ramane privat. GitHub Pages nu este folosit.

## 15. Securitate

- `APIFY_TOKEN` -> GitHub Actions Secret pentru modul Apify;
- `JOBSPIPE_API_KEY` -> GitHub Actions Secret pentru modul Direct;
- GitHub PAT -> Cloudflare Secret `GITHUB_TOKEN`;
- user authorization -> Cloudflare Secret `ALLOWED_GOOGLE_SUB`;
- `GOOGLE_CLIENT_ID` -> variabila publica Cloudflare;
- `keep_vars=true` protejeaza variabilele Dashboard la deploy;
- descrierile sunt randate prin React ca text;
- linkurile externe folosesc `noopener noreferrer`;
- credentialele GitHub nu ajung in browser;
- configuratia editabila este whitelist + validated patch.

## 16. Infrastructura locala

Synology DS213j nu este runtime principal.

Rol permis:

- backup;
- arhiva;
- storage local/offline.

## 17. Evolutie planificata

SQLite devine justificat cand apar:

- istoric tranzactional;
- arhivare persistenta;
- aplicari editabile server-side;
- documente private;
- multi-device state real;
- MCP cu stare persistenta.

PostgreSQL ramane pentru multi-user/concurenta/replicare.

MCP ramane Phase 2.

## 18. Status de verificare

- build React: validat CI;
- build Worker: validat CI;
- protectia `/data/*`: implementata in Worker;
- login/data lifecycle React: implementat in cod;
- E2E complet in browser pe release-ul React: necesita confirmare dupa deploy Cloudflare.
