# Command API

Versiune aplicatie: `0.06-dev`
Ultima actualizare: `2026-09-30`

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

Command API nu este motorul de cautare. In target-ul ADR-005 devine boundary-ul server-side pentru identity/authorization si repository/data-access catre PostgreSQL, fara SQL direct in frontend/business logic.

## Regula Save != Run

AS-IS single-user:

```text
PUT /config
-> valideaza
-> persista
-> STOP

POST /commands/run
-> valideaza configuratia
-> blocheaza daca exista run activ
-> DEV/TEST: workflow_dispatch(run_trigger=manual-ui, source_sha=SOURCE_SHA, execution_mode=manual-full)
-> PROD: workflow_dispatch(run_trigger=manual-ui, source_sha=SOURCE_SHA, execution_mode=policy)
```

Target ADR-005:

```text
USER profile change
-> persist personal profile
-> optional personal re-evaluation
-> NO provider retrieval

global scheduler due OR ADMIN manual collection
-> global run admission
-> maximum one heavy collection run
-> shared corpus refresh
```

USER nu are manual Run/Search in target. Manual collection este ADMIN-only. Modificarile de profil, surse, categorii sau nomenclatoare nu pornesc implicit full search.

## Autentificare

### AS-IS single-user

Browserul obtine un Google ID token prin Google Identity Services. Command API valideaza server-side Google JWKS, issuer si `GOOGLE_CLIENT_ID`, iar autorizarea curenta este limitata prin `ALLOWED_GOOGLE_SUB`.

Current compatibility behavior may still place the verified Google ID token in the current `__Host-jscc_session` cookie until the multiuser cutover.

### Target ADR-005 + ADR-007

Identity resolution:

```text
Google ID token
 -> server-side verify
 -> user_identity(provider=GOOGLE, provider_subject=sub)
 -> app_user.user_id
 -> profile.profile_id
```

Rules:
- Google remains Stage-1 IdP;
- Google `sub` is an external subject, not an internal FK;
- account/profile resolution is server-side;
- exactly one profile per user in MVP;
- roles are `USER` and `ADMIN`;
- browser-supplied user/profile identifiers do not confer authority;
- ADMIN cannot read another user's personal content.

On successful Google authentication, JSCC creates a fresh application-owned opaque session:
- cookie `__Host-jscc_session`;
- `Secure; HttpOnly; SameSite=Strict; Path=/`;
- no Domain attribute;
- raw token only in browser cookie;
- only token hash persisted server-side;
- Stage-1 absolute maximum lifetime 60 minutes;
- logout/deactivation/deletion invalidate server-side sessions.

After the multiuser cutover, Google ID tokens are accepted at the session-establishment boundary, not as direct authorization bypass for normal protected application endpoints.

Business/repository code receives server-derived `AuthContext(user_id, profile_id, role, status)` and does not consume Google claims directly.

Frontend may retain only non-secret Google login hint metadata for UX. Authentication/session tokens are not persisted in browser Web Storage.

CI/CD keeps its separate GitHub Actions OIDC identity. It remains limited to the already-approved read-only functional-verification surface and cannot establish an end-user session or authorize mutations.

## Endpoint-uri publice

- `GET /health`
- `GET /auth/config`

## Endpoint autentificare

### `POST /auth/session`

Target behavior:
- with a Google bearer credential: verify Google token, resolve/provision account, create a fresh JSCC session and set the session cookie;
- with only a valid JSCC session cookie: validate the existing session and return the current account/profile summary without extending the absolute expiry;
- DEACTIVATED account -> denied;
- invalid/expired/revoked session -> denied;
- no silent fallback to `ALLOWED_GOOGLE_SUB` after multiuser cutover.

### `POST /auth/logout`

Target:
- same-origin;
- revoke current server-side session if present;
- clear cookie;
- idempotent.

### `GET /me`

Target authenticated identity summary:
- own role/status;
- account email metadata when needed by UI;
- own profile identity.

No caller-selected user/profile authority.


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

**AS-IS:** porneste exact un Full Search manual dupa validarea configuratiei. DEV si TEST folosesc explicit `execution_mode=manual-full` peste rolurile canonice `disabled` / `smoke`; PROD pastreaza `policy/live`. Run activ -> 409.

**Target ADR-005:** endpoint-ul de manual collection este ADMIN-only si global, nu profile-owned. Run admission garanteaza maximum o executie grea globala. USER nu primeste acest drept.

Dispatch-ul continua sa transporte obligatoriu `source_sha` exact al Worker-ului; workflow-ul valideaza SHA-ul si face checkout la acel commit inainte de executie.

## Target personal/admin API boundary

Personal operations derive the tenant from the authenticated JSCC session.

Preferred target surface:
- `GET/PUT /me/preferences`;
- personal job-state operations by shared `job_id`;
- `GET/POST /applications`;
- `PUT/DELETE /applications/:application_id`.

Compatibility endpoints such as current `PUT /config` may remain temporarily during migration, but the effective `profile_id` is always server-derived.

ADMIN account lifecycle surface may expose:
- account list/metadata required for administration;
- deactivate;
- reactivate;
- delete.

ADMIN endpoints do not expose another user's profile preferences, FIT/evaluation, applications, notes or personal workspace.

Current `POST /commands/run` may remain the manual collection endpoint, but the ADR-005 target authorizes it only for ADMIN/system global collection.

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

## Environment automation - Phase 3 / #161

Phase 3 nu modifica endpoint-urile Command API. Automatizarea foloseste contractul identity introdus in Phase 2 si il trateaza ca input obligatoriu pentru viitoarele deploy-uri environment-specific.

Manifest: `config/environments.json`.

CLI: `scripts/environment.mjs`.

Reguli relevante pentru Command API:
- `APP_ENV`, runtime repo/ref, `SOURCE_SHA`, `RUNTIME_DATA_SHA`, `SEARCH_MODE` si `FRONTEND_ORIGIN` raman fail-closed;
- Phase 3 nu schimba mapping-ul operational PROD curent;
- niciun live bootstrap/deploy nu este permis in Phase 3;
- viitoarele Phase 4+ trebuie sa configureze Worker-ul exclusiv cu valorile environment-ului selectat si sa confirme identity prin `/health`.


## Target persistence / authorization boundary — ADR-005

### Repository boundary

Command API nu expune generic SQL client catre business/UI.

Personal repositories primesc profile context derivat server-side din principalul autentificat. Niciun endpoint personal nu acorda acces pe baza unui `profile_id` primit de la browser.

### Tenant isolation

Defense in depth:
- server-side account/profile resolution;
- repository scoping;
- PostgreSQL RLS pe personal tables;
- `FORCE ROW LEVEL SECURITY` unde se aplica;
- ADMIN fara personal-content bypass.

### Connectivity

`Worker -> repository/data-access -> pg -> Hyperdrive -> Nile PostgreSQL`

- Hyperdrive pooling;
- query caching initial OFF;
- bindings distincte DEV/TEST/PROD;
- fara runtime-selected DB;
- fara cross-environment fallback.

### Runtime privileges

Inainte de personal-data/multiuser PROD, runtime CRUD authority trebuie separata demonstrabil de migration/DDL authority.

### Account deletion

DELETE personal account/profile este hard delete al personal domain. Shared jobs/sources/runs/nomenclatures nu sunt sterse.

Se poate pastra maximum 90 zile numai un audit event neidentificabil, fara user/profile identifiers sau date care permit relinkarea.

### Cost guardrail

Pilot variable infrastructure cost: EUR 0.

Paid capacity nu se activeaza automat. 70% din included Nile capacity este warning/gate operational. Daca fail-closed cost control nu poate fi demonstrat, multiuser PROD ramane blocat.
