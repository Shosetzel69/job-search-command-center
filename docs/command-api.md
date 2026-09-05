# Command API

Actualizare: 2026-09-05

## 1. Scop

Command API este componenta server-side minima care permite frontend-ului React sa execute actiuni privilegiate si sa acceseze date protejate fara a expune credentiale GitHub in browser.

Responsabilitati:

- validare/autorizare Google;
- protectie `/data/*`;
- `Ruleaza verificarea`;
- persistare configuratie in `data/search-config.json`;
- acces la GitHub Actions si GitHub Contents API.

Nu este motorul de cautare si nu este un backend persistent pentru joburi.

## 2. Componente

- `command-api/src/index.js` - auth, Command API, GitHub API;
- `command-api/src/secure-entry.js` - protectia `/data/*` + delegare catre Command API;
- `command-api/wrangler.jsonc` - configuratie Worker/Static Assets;
- `command-api/scripts/build-static.mjs` - asamblarea bundle-ului public.

## 3. Autentificare Google

Frontend-ul foloseste Google Identity Services.

Browserul primeste Google ID token si il trimite:

```text
Authorization: Bearer <GOOGLE_ID_TOKEN>
```

Worker-ul verifica:

- semnatura prin Google JWKS;
- issuer `accounts.google.com` / `https://accounts.google.com`;
- audience = `GOOGLE_CLIENT_ID`;
- `payload.sub = ALLOWED_GOOGLE_SUB`.

Autorizarea foloseste `sub`, nu emailul.

Tokenul ramane numai in memoria frontend-ului.

## 4. Endpoint-uri publice

### `GET /health`

Nu necesita login.

Raspunsul curent include:

```json
{
  "status": "ok",
  "auth_configured": true,
  "github_configured": true
}
```

Valorile boolean depind de configuratia mediului.

### `GET /auth/config`

Nu necesita login.

Returneaza configuratia minima necesara Google Sign-In:

```json
{
  "client_id": "...",
  "configured": true
}
```

`GOOGLE_CLIENT_ID` nu este secret.

## 5. Endpoint autentificare

### `POST /auth/session`

Necesita bearer Google valid.

Scop:

- valida tokenul;
- valida utilizatorul autorizat;
- confirma sesiunea frontend.

Raspuns de succes:

```json
{
  "status": "ok",
  "email": "user@example.com"
}
```

Emailul este folosit numai pentru afisarea profilului.

## 6. Date protejate

Rutele protejate sunt:

- `GET /data/jobs.json`;
- `GET /data/run-status.json`;
- `GET /data/search-config.json`;
- `GET /data/sources.json`;
- `GET /data/applications.json`.

Flux:

```text
Browser
  -> GET /data/...
  -> Authorization: Bearer token
  -> secure-entry.js
  -> verificare prin /auth/session logic
  -> env.ASSETS.fetch
  -> response no-store
```

Reguli:

- metoda diferita de GET -> 405;
- `/data/*` necunoscut -> 404;
- token lipsa/invalid -> auth error;
- raspuns protejat -> `cache-control: no-store`;
- raspuns protejat -> `x-content-type-options: nosniff`.

## 7. Comenzi protejate

### `POST /commands/run`

Necesita utilizator Google autorizat.

Comportament:

1. interogheaza ultimele workflow runs;
2. daca exista `queued` sau `in_progress`, returneaza 409;
3. altfel executa `workflow_dispatch` pentru `job-search-full.yml` pe `main`;
4. returneaza 202.

Frontend-ul urmareste ulterior `run-status.json` prin polling autentificat.

### `PUT /config`

Necesita utilizator Google autorizat.

Campuri acceptate din UI:

- `rolePm`;
- `roleDelivery`;
- `roleService`;
- `roleScrum`;
- `roleProgram`;
- `workRemote`;
- `workHybrid`;
- `keepReposts`;
- `immediateStart`;
- `jobspipeEnabled`;
- `freshness` = 24 / 36 / 48 / 120;
- `fitThreshold` = 50-100;
- `rateMin`;
- `rateMax`;
- `exclusions` - maximum 20 intrari scurte.

Worker-ul:

1. valideaza payload-ul;
2. citeste `data/search-config.json` din GitHub;
3. aplica numai campurile whitelist;
4. scrie configuratia prin Contents API;
5. commit message: `Update search config from command API`.

Commit-ul pe `data/search-config.json` declanseaza automat workflow-ul de cautare.

## 8. GitHub access

Worker-ul foloseste un fine-grained PAT stocat in Cloudflare Secret:

`GITHUB_TOKEN`

Repository tinta:

`Shosetzel69/job-search-command-center`

Permisiuni necesare:

- Actions: write;
- Contents: write.

PAT-ul nu este livrat browserului.

## 9. Origin si CORS

Frontend-ul si Worker-ul folosesc acelasi origin Cloudflare.

`FRONTEND_ORIGIN` este verificat pentru cererile privilegiate.

Reguli:

- Origin strain -> 403;
- CORS nu inlocuieste autentificarea;
- bearer Google ramane obligatoriu pentru endpoint-urile protejate.

## 10. Variabile si secrete Cloudflare

### Secrets

- `GITHUB_TOKEN`;
- `ALLOWED_GOOGLE_SUB`.

### Variabile non-secret

- `GOOGLE_CLIENT_ID` - configurata in Dashboard;
- `FRONTEND_ORIGIN`;
- `GITHUB_OWNER`;
- `GITHUB_REPO`;
- `GITHUB_REF`;
- `GITHUB_WORKFLOW`;
- `SEARCH_CONFIG_PATH`.

`keep_vars=true` este activ in Wrangler pentru a pastra variabilele configurate in Dashboard la deploy.

## 11. Frontend auth lifecycle

Implementarea React foloseste:

```text
GET /auth/config
  -> Google Sign-In
  -> POST /auth/session
  -> auth valid
  -> seteaza token in memorie
  -> incarca /data/*
```

Separare obligatorie:

- login valid != date incarcate;
- eroare `/data/*` nu produce logout automat;
- UI afiseaza eroarea si `Reincearca incarcarea`;
- logout-ul sterge tokenul si datele din memorie.

## 12. Build si deploy

`command-api/package.json`:

```text
npm run build
  -> build:frontend
  -> npm install frontend
  -> vite build
  -> build-static.mjs
```

`build-static.mjs` copiaza `frontend/dist` si cele 5 fisiere JSON protejate in `command-api/public`.

Wrangler publica Static Assets si Worker-ul ca acelasi serviciu.

## 13. Limitari MVP

- un singur utilizator autorizat;
- fara sesiuni server-side;
- fara refresh token propriu;
- fara baza de date Worker;
- fara persistenta server-side pentru arhivare;
- fara persistenta canonica a toggle-urilor individuale din `Surse`;
- fara multi-user;
- fara MCP.

## 14. Status verificare

- sintaxa/build Worker: validat CI;
- build React/Vite: validat CI;
- route protection `/data/*`: implementat;
- auth + data retry React: implementat;
- test E2E complet in browser dupa release-ul React: de confirmat pe deploy-ul live.

## JobsPipe transport

Command API persista numai configuratia, nu secretele providerilor. `APIFY_TOKEN` si `JOBSPIPE_API_KEY` exista numai in GitHub Actions Secrets. Alegerea `apify` din UI nu transmite tokenul prin browser sau Worker.
