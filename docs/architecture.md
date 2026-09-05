# Arhitectura

## 1. Arhitectura MVP curenta

Fluxul ramane static-first:

```text
Utilizator / Browser
  |
  v
Cloudflare Worker
  |
  +--> Static Assets construite cu React + Tailwind + Vite
  |      +--> index.html
  |      +--> assets/*.js
  |      +--> assets/*.css
  |
  +--> Date protejate
  |      +--> /data/jobs.json
  |      +--> /data/run-status.json
  |      +--> /data/search-config.json
  |      +--> /data/sources.json
  |      +--> /data/applications.json
  |      +--> Google bearer auth obligatoriu
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
  +--> connectors
  +--> normalizare
  +--> geo-eligibility
  +--> deduplicare / repost
  +--> filtrare
  +--> scoring
  |
  v
data/*.json in repository privat
  |
  v
commit main
  |
  v
Cloudflare build/deploy
```

Nu exista baza de date activa in MVP.

## 2. Frontend

Frontend-ul este o aplicatie React compilata static:

- sursa in `frontend/`;
- React functional components;
- Tailwind CSS pentru layout si styling;
- Vite pentru build;
- output in `frontend/dist/`;
- `command-api/scripts/build-static.mjs` copiaza `frontend/dist/` in `command-api/public/` si adauga fisierele de date publicabile.

Frontend-ul nu contine secrete.

### Lifecycle autentificare si date

```text
Pagina porneste
  -> GET /auth/config
  -> Google Sign-In
  -> POST /auth/session
  -> sesiune Google valida
  -> UI autentificat + stare Loading
  -> GET /data/*.json cu Bearer token
      -> succes: afiseaza date
      -> eroare: pastreaza sesiunea, afiseaza Error + Retry
```

Un esec de incarcare a datelor nu este tratat ca esec de login.

Tokenul Google ramane numai in memoria React si nu este persistat in `localStorage`.

## 3. UI state

React gestioneaza explicit:

- auth state;
- data loading/error/ready;
- joburi, aplicari, surse si run status;
- criterii saved/draft;
- filtre locale;
- drawer de detalii;
- arhivare locala MVP;
- toast-uri.

Nu se folosesc monkey-patch-uri intre scripturi si nici interceptare globala `window.fetch`.

## 4. Design system

Reguli:

- fundal general `slate-50`;
- containere albe cu `border-slate-200` si `shadow-sm`;
- albastru exclusiv pentru actiunea primara `Ruleaza verificarea` si focus states;
- emerald/verde numai pentru stare activa/succes;
- widget profil neutru/outline;
- continut principal centrat, maxim 1400 px;
- KPI-uri numai in `Joburi noi`;
- tabela compacta cu hover actions;
- pagina criterii in grila responsive 1/2 coloane.

## 5. Motor de executie

GitHub Actions ramane schedulerul si orchestratorul infrastructural.

Responsabilitati:

- schedule de doua ori pe zi;
- `workflow_dispatch` pentru rulare manuala;
- injectarea secretelor;
- timeout si concurrency;
- executia motorului;
- validarea output-ului;
- commit rezultate.

Logica de cautare este in `scripts/job_search.py`, `scripts/job_search_optimized.py` si `scripts/job_search_runner.py`.

## 6. Connectors si surse

Exista contractul `JobConnector`.

`JobsPipeConnector` este implementat, dar `jobspipe_enabled=false` in perioada de stabilizare.

Cand JobsPipe este activ:

- preview gratuit;
- polling incremental cu `discovered_at_gte`;
- cursor pentru backlog;
- buget per run;
- guard lunar local.

Registrul `data/sources.json` ramane lista de surse afisata in UI. Toggle-urile individuale sunt inca locale pana la persistenta canonica a registrului.

## 7. Procesare

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

Repostarile sunt marcate, nu eliminate automat daca `keep_reposts=true`.

## 8. Persistenta

MVP:

- `data/jobs.json` - rezultate;
- `data/run-status.json` - stare rulare;
- `data/search-config.json` - configuratie canonica;
- `data/sources.json` - registru surse;
- `data/applications.json` - aplicari;
- `data/search-state.json` - stare interna JobsPipe, nepublicata;
- GitHub Actions Secrets - chei cautare;
- Cloudflare Secrets - PAT si autorizare Google.

Arhivarea rapida din UI este locala in `localStorage` in MVP.

SQLite ramane optiunea preferata pentru istoric tranzactional, aplicari editabile server-side, arhivare persistenta sau documente private.

PostgreSQL ramane rezervat pentru multi-user/concurenta.

## 9. Configuratie

`data/search-config.json` este sursa de adevar pentru executia cautarii.

Modificarile din UI sunt validate si persistate prin `PUT /config`.

`jobspipe_enabled` controleaza explicit accesul providerului JobsPipe.

## 10. Command API

Command API este Cloudflare Worker minimal pentru actiuni privilegiate si access control.

Endpoint-uri:

```text
GET  /health
GET  /auth/config
POST /auth/session
POST /commands/run
PUT  /config
```

Worker-ul verifica Google ID token prin JWKS, issuer, audience si `ALLOWED_GOOGLE_SUB`.

## 11. Build si publicare

Build-ul Cloudflare ruleaza din `command-api/`:

```text
npm run build
  -> instaleaza dependintele frontend
  -> vite build in frontend/dist
  -> build-static.mjs
  -> command-api/public
  -> Wrangler deploy
```

GitHub Actions `Validate Command API` executa dry-run Wrangler, care valideaza implicit build-ul React si Worker-ul.

Repository-ul ramane privat. GitHub Pages nu este utilizat.

## 12. Securitate

- cheile providerilor stau in GitHub Actions Secrets;
- PAT-ul GitHub sta in Cloudflare Secret;
- `ALLOWED_GOOGLE_SUB` sta in Cloudflare Secret;
- `GOOGLE_CLIENT_ID` este configuratie publica;
- tokenul Google este doar in memoria paginii;
- `/data/*` este Worker-first si necesita bearer valid;
- fisierele protejate folosesc `cache-control: no-store`;
- descrierile joburilor sunt randate ca text React, nu HTML arbitrar;
- linkurile externe folosesc `noopener noreferrer`;
- actiunile privilegiate nu expun credentiale GitHub in browser.

## 13. NAS Synology DS213j

DS213j ramane doar pentru backup/arhiva/storage, nu pentru runtime.

## 14. MCP si evolutie

MCP ramane in etapa 2.

Backend persistent + SQLite se introduce numai cand apar cerinte care depasesc modelul static-first + Command API, de exemplu:

- istoric extins;
- arhivare persistenta server-side;
- aplicari editabile complex;
- multi-user;
- documente private;
- integrare MCP cu stare persistenta.
