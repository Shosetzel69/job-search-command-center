# Command API

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-09`

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
-> workflow_dispatch(run_trigger=manual-ui)
```

Modificarile de config, surse, categorii sau nomenclatoare nu pornesc full search.

## Autentificare

Browser:

```text
Authorization: Bearer <GOOGLE_ID_TOKEN>
```

Worker verifica Google JWKS, issuer, `GOOGLE_CLIENT_ID` si `ALLOWED_GOOGLE_SUB`.

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

Porneste exact un full search manual dupa validarea configuratiei. Run activ -> 409.

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
- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`, `GITHUB_WORKFLOW`;
- `SEARCH_CONFIG_PATH`;
- `SOURCES_PATH`;
- `SOURCE_CATEGORIES_PATH`;
- `NOMENCLATURES_PATH`;
- `APPLICATIONS_PATH`.

Provider secrets raman in GitHub Actions Secrets.

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
