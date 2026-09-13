# Command API

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-13`

## Scop

Command API executa actiunile privilegiate ale frontend-ului fara a expune credentiale GitHub in browser.

Responsabilitati:
- autentificare/autorizare Google;
- protectie `/data/*`;
- persistenta `search-config.json`;
- comanda manuala de full search;
- Source Registry + categorii;
- Nomenclatoare canonice + integritate referentiala;
- acces server-side la GitHub Actions/Contents API.

Command API nu este motorul de cautare si nu este baza de date.

## Regula Save != Run

```text
PUT /config
-> valideaza
-> persista
-> STOP

POST /commands/run
-> valideaza configuratia
-> blocheaza daca exista run activ
-> workflow_dispatch(run_trigger=manual-ui, source_sha=SOURCE_SHA)
```

Modificarile de config, surse, categorii sau nomenclatoare nu pornesc full search.

## Autentificare

Browser:

```text
Authorization: Bearer <GOOGLE_ID_TOKEN>
```

Worker verifica Google JWKS, issuer, `GOOGLE_CLIENT_ID` si `ALLOWED_GOOGLE_SUB`.

La autentificare reusita, frontend-ul poate retine local numai adresa de email autorizata ca `login_hint` non-secret pentru Google Identity Services. Google ID token nu este persistat: ramane exclusiv in memoria paginii. La reload, frontend-ul poate cere Google Identity Services sa emita un credential nou pentru contul cunoscut; credentialul este revalidat integral prin `POST /auth/session`. Logout explicit dezactiveaza auto-select pentru a evita reautentificarea imediata.

## Endpoint-uri publice

- `GET /health`
- `GET /auth/config`

## Endpoint autentificare

- `POST /auth/session`

## Date protejate

Manifestul canonic este `shared/runtime-data.mjs`.

Protected assets includ:
- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `nomenclatures.json`;
- `applications.json`.

Reguli:
- numai GET;
- token lipsa/invalid -> 401/403;
- path necunoscut -> 404;
- `cache-control: no-store`;
- `x-content-type-options: nosniff`.

`search-state.json` ramane intern.

## Configuratie

### `PUT /config`

Campuri UI principale:
- role groups;
- `workRemote`, `workHybrid`, `workOnsite`;
- `contractTypes`;
- freshness/FIT/reposts/rate/immediate start;
- excluderi;
- `targetRegions`, `targetCountries`;
- `excludedRegions`, `excludedCountries`;
- JobsPipe settings existente, cu JobsPipe ramas disabled in Package 2.

Validarea pentru regions/countries/contract types foloseste `data/nomenclatures.json`, nu liste independente in Worker.

Reguli geografice:
- target complet gol -> 400;
- cod/regiune inexistenta sau inactiva -> 400;
- include/exclude conflict -> 400;
- suprapunere regiune/tara -> 400.

### `POST /commands/run`

Porneste exact un full search manual dupa validarea configuratiei. Run activ -> 409. Dispatch-ul transporta obligatoriu `source_sha` exact al Worker-ului; workflow-ul valideaza SHA-ul si face checkout la acel commit inainte de executie.

## Source Registry

Endpoint-uri principale:
- `POST /sources`;
- `PUT /sources/:id`;
- `DELETE /sources/:id`;
- `POST /sources/:id/actions`;
- `GET/POST /source-categories`;
- `PUT/DELETE /source-categories/:id`.

Sursa noua porneste `pending`, neaprobata si inactiva. Aprobare != activare.

## Nomenclatoare canonice

Toate endpoint-urile necesita autentificare.

### `GET /nomenclatures`

Returneaza catalogul `data/nomenclatures.json`.

### `POST /nomenclatures/:domain`

Adauga valoare numai daca domeniul este `extensible=true`.

Domeniile system/semantic resping Add cu 409.

### `PUT /nomenclatures/:domain/:code`

Operatii permise:
- label;
- `sort_order`;
- active/inactive daca integritatea referentiala permite.

Codul tehnic este immutable.

### `DELETE /nomenclatures/:domain/:code`

Disponibil numai pentru domenii extensibile si numai daca valoarea nu este referentiata.

### Integritate referentiala

Deactivate/Delete pe valoare folosita -> `409 Conflict`:

```json
{
  "error": "Valoarea este folosita si nu poate fi dezactivata.",
  "references": [
    "search-config.target_regions"
  ]
}
```

Referinte verificate:
- regions -> target/excluded regions;
- countries -> target/search/excluded countries + membership in regiuni active;
- work modes -> `search-config.work_modes.<code>` cand este activ;
- contract types -> `search-config.contract_types`;
- application statuses -> `applications.status`;
- seniority -> fara referinte functionale in 2A8.

API nu modifica automat configuratia pentru a rezolva conflictul.

## Origin / CORS

`FRONTEND_ORIGIN` este verificat pentru cereri privilegiate.
Metode: GET, POST, PUT, DELETE, OPTIONS.
Origin strain -> 403.

## Variabile / secrets

Cloudflare secrets:
- `GITHUB_TOKEN`;
- `ALLOWED_GOOGLE_SUB`.

Variabile:
- `GOOGLE_CLIENT_ID`;
- `FRONTEND_ORIGIN`;
- `APP_ENV`;
- `GITHUB_RUNTIME_OWNER`, `GITHUB_RUNTIME_REPO`, `GITHUB_RUNTIME_REF`;
- `GITHUB_WORKFLOW`;
- `SEARCH_MODE`;
- `SEARCH_CONFIG_PATH`;
- `SOURCES_PATH`;
- `SOURCE_CATEGORIES_PATH`;
- `NOMENCLATURES_PATH`;
- `APPLICATIONS_PATH`.

Provider secrets raman in GitHub Actions Secrets.

`SOURCE_SHA` si `RUNTIME_DATA_SHA` nu sunt hard-codate in `wrangler.jsonc`. In Phase 2 ele sunt generate la build din commit-ul real al checkout-ului; in mapping-ul tranzitoriu PROD, runtime data sunt inca in acelasi repository/ref, deci snapshot-ul servit este identificat de acelasi commit. Daca Phase 3 separa runtime repository-ul, `RUNTIME_DATA_SHA` devine input explicit al build-ului.

## Environment identity - Phase 2 / #161

Configuratia este fail-closed. Lipsa sau invaliditatea oricarui element de identitate opreste request-ul; nu exista fallback implicit la PROD sau `main`.

Contract:

```text
APP_ENV = dev | test | prod
GITHUB_RUNTIME_OWNER
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_SHA (40-char immutable commit SHA)
RUNTIME_DATA_SHA (40-char immutable commit SHA)
SEARCH_MODE = disabled | smoke | live
FRONTEND_ORIGIN
```

Command API si Nomenclature API folosesc acelasi modul `runtime-github.js` pentru GitHub Contents read/write. `GITHUB_REF` legacy nu mai este folosit functional.

`GET /health` expune numai metadata non-secret:

```json
{
  "status": "ok",
  "environment": "prod",
  "source_sha": "<sha>",
  "runtime_repo": "Shosetzel69/job-search-command-center",
  "runtime_ref": "main",
  "runtime_data_sha": "<sha>",
  "search_mode": "live"
}
```

DEV/TEST nu pot folosi `SEARCH_MODE=live`; PROD necesita `live`. Full Search este blocat de Command API daca search mode nu este `live`.

## Testare

CI verifica minimum:
- Python config/search regressions;
- geografie canonica/parity;
- full search manual-only;
- frontend unit tests;
- Command API config/nomenclature governance tests;
- 409 references;
- toate protected assets fara bearer -> 401;
- nomenclature admin API fara bearer -> 401;
- frontend build;
- Worker dry-run.

E2E final Package 2A8 este #122.
