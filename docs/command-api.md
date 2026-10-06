# Command API

Versiune aplicatie: `0.8.0`
Ultima actualizare: `2026-10-06`

## Scop

Command API este boundary-ul server-side pentru autentificare/autorizare, date personale tenant-aware, administrare si controlul Retrieve-ului shared.

Responsabilitati:
- sesiuni JSCC opace peste autentificarea Google;
- derivarea server-side a `AuthContext(user_id, profile_id, role, status)`;
- `GET/PUT /me/preferences`, `GET /me/jobs` si profile-job state;
- Applications profile-owned;
- USER/ADMIN Refresh peste acelasi shared corpus si acelasi heavy-run lock;
- Source Registry + categorii;
- Nomenclatoare canonice + integritate referentiala;
- date operationale ADMIN-only si reconcilierea candidate-managed strict allowlisted.

Command API nu este motorul de cautare. Provider Retrieve ramane shared/system-owned si ruleaza prin runtime-ul canonic GCP.

## Regula Save != Retrieve

```text
PUT /me/preferences
-> valideaza Selection Criteria
-> persista profile-owned preferences
-> profile_version numai la schimbare semantica
-> STOP (zero provider Retrieve)

POST /me/refresh
-> reuse / join / start shared Retrieve conform policy

POST /admin/refresh
-> aggregate scope fara identitati personale
-> reuse / join / start shared Retrieve conform policy
```

Nu exista Retrieve implicit la schimbarea profilului, Surse/Categorii/Nomenclatoare sau GUI filters. Echivalentele legacy `PUT /config` si `POST /commands/run` sunt retrase de ATC-489-07.

## Autentificare

Google Identity Services este Stage-1 IdP numai la stabilirea sesiunii. Command API valideaza server-side Google JWKS, issuer si `GOOGLE_CLIENT_ID`, apoi rezolva/provisioneaza identitatea interna:

```text
Google ID token
 -> server-side verify
 -> user_identity(provider=GOOGLE, provider_subject=sub)
 -> app_user.user_id
 -> profile.profile_id / Nile tenant
 -> opaque JSCC session
```

Reguli curente:
- Google `sub` este external subject, nu PK/FK pentru date personale;
- exact un profil/user in MVP;
- rolurile sunt `USER` si `ADMIN`;
- browser-supplied user/profile identifiers nu confera authority;
- sesiunea aplicatiei foloseste cookie `__Host-jscc_session; Secure; HttpOnly; SameSite=Strict; Path=/`;
- numai hash-ul tokenului opac este persistat server-side;
- Stage-1 absolute maximum lifetime este 60 minute;
- logout/deactivation/deletion invalideaza server-side sesiunile;
- Google ID token nu autorizeaza direct endpoint-uri normale dupa stabilirea sesiunii;
- frontend poate pastra numai login hint non-secret pentru UX; tokenurile nu intra in Web Storage;
- CI/CD GitHub Actions OIDC ramane identitate separata, strict allowlisted pentru reconciliere/read-only, nu sesiune end-user.

Business/repository code consuma numai `AuthContext(user_id, profile_id, role, status)`.

## Endpoint-uri publice

- `GET /health`
- `GET /auth/config`

## Endpoint autentificare

### `POST /auth/session`

Behavior:
- with a Google bearer credential: verify Google token, resolve/provision account, create a fresh JSCC session and set the session cookie;
- with only a valid JSCC session cookie: validate the existing session and return the current account/profile summary without extending the absolute expiry;
- DEACTIVATED account -> denied;
- invalid/expired/revoked session -> denied;
- no silent fallback to `ALLOWED_GOOGLE_SUB` after multiuser cutover.

### `POST /auth/logout`

Behavior:
- same-origin;
- revoke current server-side session if present;
- clear cookie;
- idempotent.

### `GET /me`

Authenticated identity summary:
- own role/status;
- account email metadata when needed by UI;
- own profile identity.

No caller-selected user/profile authority.


## Auth/authorization error semantics

Current semantics:
- `401` — missing, invalid, expired or revoked JSCC session; invalid Google credential at session establishment;
- `403` — authenticated account is DEACTIVATED or authenticated role lacks the requested capability;
- `404` — tenant-scoped object is not visible in the caller's personal domain, including cross-tenant object-id probing;
- `409` — legitimate state/version/concurrency conflict that is not an authorization failure;
- `503` — required auth/security configuration or persistence dependency is unavailable; fail closed.

Mutating cookie-authenticated requests remain same-origin and validate the environment `FRONTEND_ORIGIN`.

## Date protejate si runtime artifacts

`shared/runtime-data.mjs` ramane manifestul comun pentru runtime artifacts. Existenta unui fisier in manifest nu il face automat API browser.

Browser/API canonic:
- personal: `GET/PUT /me/preferences`, `GET /me/jobs`, `/applications`;
- refresh: `POST /me/refresh`, `POST /admin/refresh`;
- ADMIN operational: `/data/run-status.json`, `/data/run-history.json`, `/data/promotion-status.json`, plus datele administrative necesare;
- candidate-managed reconciliation: numai fisierele explicit allowlisted pentru GitHub Actions OIDC.

Runtime seed/bootstrap poate pastra intern `jobs.json`, `search-config.json` si `applications.json`, dar ATC-489-07 retrage aliasurile browser:
- `GET /data/jobs.json`;
- `GET /data/search-config.json`;
- `GET /data/applications.json`;
- `PUT /config`;
- `POST /commands/run`.

Pentru o sesiune autentificata aceste rute retrase raspund fail-closed `404` in `secure-entry.js` si nu sunt forwardate catre implementarea legacy. Fara sesiune valida, auth ramane fail-closed inainte de aceasta rezolutie.

Toate raspunsurile protejate folosesc `cache-control: no-store` si `x-content-type-options: nosniff`. `search-state.json` ramane intern.

## Personal / refresh API boundary

Personal operations deriva tenantul exclusiv din sesiunea JSCC autentificata.

Suprafata canonica:
- `GET /me`;
- `GET/PUT /me/preferences`;
- `GET /me/jobs` cu paginare bounded/cursor;
- `PUT /me/jobs/:job_id/state`;
- `GET/POST /applications`;
- `PUT/DELETE /applications/:application_id`;
- `POST /me/refresh`;
- `POST /admin/refresh` pentru ADMIN.

ADMIN lifecycle poate lista/dezactiva/reactiva/sterge accounts fara a expune continut personal cross-tenant. ADMIN nu primeste acces la preferintele, FIT/evaluation, applications, notes sau workspace-ul personal al altui utilizator.

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

ADR-008 is authoritative.

Defense in depth:
- server-side account/profile resolution;
- `profile.profile_id == tenants.id` is the canonical logical/physical tenant mapping;
- `profile` is global account/tenant metadata; tenant-aware personal tables use physical `tenant_id`;
- all normal personal persistence passes through the fail-closed Tenant Data Gateway / profile-scoped repository transaction boundary;
- `SET LOCAL nile.tenant_id` is established transaction-locally before personal SQL;
- missing tenant context is rejected by the gateway before personal SQL; Nile global mode itself remains cross-tenant capable;
- CI/static guard rejects personal-table SQL/raw-query escape outside allowlisted gateway/migration/test modules;
- shared/system repositories and collection jobs have no dependency path to personal repositories;
- persistent pooled-connection tenant state is prohibited;
- browser-supplied profile/tenant identifiers confer no authority;
- ADMIN has no cross-user personal tenant bypass.

### Connectivity

Target runtime per ADR-006:

`Cloud Run Service/Job -> repository/data-access -> pg -> Nile PostgreSQL`

- PostgreSQL pooling/concurrency is owned by the Cloud Run runtime/client configuration;
- environment-specific DB credentials are obtained from Secret Manager;
- DEV/TEST/PROD bind independently to `jobsearch_dev`, `jobsearch_test`, `jobsearch_prod`;
- no runtime-selected DB;
- no cross-environment fallback;
- Cloudflare Hyperdrive is legacy/superseded and is not part of the target GCP path.

### Runtime privileges

Inainte de personal-data/multiuser PROD, runtime CRUD authority trebuie separata demonstrabil de migration/DDL authority.

### Account deletion

DELETE este un account-domain hard delete through the narrow Account Lifecycle Gateway. After caller authorization, it resolves only target `user_id/profile_id`, deletes `tenants.id = profile_id` to remove tenant-aware personal rows + profile mapping through verified cascade behavior, then deletes `app_user` to remove identity/session metadata. Shared jobs/sources/runs/nomenclatures are not owned by the user and are not cascaded.

ADMIN does not assume the target user's Nile tenant context for personal-content access, and the delete operation does not return target personal content. It must remove the Nile tenant row and leave zero tenant/profile/personal/account residue.

Se poate pastra maximum 90 zile numai un audit event neidentificabil, fara user/profile identifiers sau date care permit relinkarea.

### Cost guardrail

Pilot variable infrastructure cost: EUR 0.

Paid capacity nu se activeaza automat. 70% din included Nile capacity este warning/gate operational. Daca fail-closed cost control nu poate fi demonstrat, multiuser PROD ramane blocat.


## ADMIN Refresh

### `POST /admin/refresh`

Requires an authenticated ACTIVE `ADMIN` session and same-origin mutation request.

The endpoint aggregates/deduplicates refresh scopes across active Search Profiles without exposing personal identity fields, then reuses/coalesces/starts the existing shared global Retrieve path.

Canonical outcomes:
- `REUSED_CORPUS`;
- `JOINED_EXISTING_RUN`;
- `STARTED_RUN`;
- `BLOCKED_BY_POLICY`.

A newly started ADMIN run is tagged `admin-ui`. PROD enablement is not part of ATC-489-05.
