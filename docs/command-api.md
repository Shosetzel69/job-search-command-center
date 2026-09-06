# Command API

Versiune aplicatie: `0.05`
Ultima actualizare: `2026-09-06`

## 1. Scop

Command API permite frontend-ului React sa execute actiuni privilegiate si sa acceseze date protejate fara a expune credentiale GitHub in browser.

Responsabilitati:

- validare/autorizare Google;
- protectie `/data/*`;
- `Ruleaza verificarea`;
- persistare configuratie in `data/search-config.json`;
- CRUD persistent pentru `data/sources.json`;
- acces la GitHub Actions si GitHub Contents API.

Nu este motorul de cautare si nu este o baza de date.

## 2. Componente

- `command-api/src/index.js` - auth, Command API, GitHub API, configuratie si Surse;
- `command-api/src/secure-entry.js` - protectia `/data/*` + delegare;
- `command-api/wrangler.jsonc` - configuratie Worker/Static Assets;
- `command-api/scripts/build-static.mjs` - asamblarea bundle-ului public.

## 3. Autentificare Google

Browserul trimite Google ID token:

```text
Authorization: Bearer <GOOGLE_ID_TOKEN>
```

Worker-ul verifica:

- semnatura prin Google JWKS;
- issuer Google;
- audience = `GOOGLE_CLIENT_ID`;
- `payload.sub = ALLOWED_GOOGLE_SUB`.

Tokenul ramane numai in memoria frontend-ului.

## 4. Endpoint-uri publice

### `GET /health`

Returneaza starea minima a Worker-ului si daca auth/GitHub sunt configurate.

### `GET /auth/config`

Returneaza `GOOGLE_CLIENT_ID` si starea de configurare necesara Google Sign-In.

## 5. Endpoint autentificare

### `POST /auth/session`

Necesita bearer Google valid si confirma utilizatorul autorizat.

## 6. Date protejate

Rutele protejate sunt:

- `GET /data/jobs.json`;
- `GET /data/run-status.json`;
- `GET /data/run-history.json`;
- `GET /data/search-config.json`;
- `GET /data/sources.json`;
- `GET /data/applications.json`.

Reguli:

- numai GET;
- cale necunoscuta -> 404;
- token lipsa/invalid -> auth error;
- `cache-control: no-store`;
- `x-content-type-options: nosniff`.

`search-state.json` nu este publicat.

## 7. Comenzi protejate

### `POST /commands/run`

1. verifica workflow runs recente;
2. daca exista `queued` sau `in_progress`, returneaza 409;
3. altfel executa `workflow_dispatch` pe `main`;
4. returneaza 202.

### `PUT /config`

Accepta campurile aprobate din UI:

- roluri urmarite;
- Remote/Hibrid;
- freshness;
- prag FIT;
- repostari;
- interval B2B;
- disponibilitate imediata;
- excluderi de business;
- `jobspipeMode`;
- limite Apify/Direct;
- `targetRegions`;
- `targetCountries`;
- `excludedRegions`;
- `excludedCountries`.

Reguli geografice server-side:

- regiuni permise: `EU`, `US`, `ASIA`;
- codurile de tara trebuie sa fie ISO alpha-2;
- aceeasi tara/regiune nu poate fi simultan inclusa si exclusa;
- suprapunerea regiune inclusa/tara exclusa sau invers este respinsa cu 400.

Configuratia este scrisa prin GitHub Contents API. Commit-ul `data/search-config.json` declanseaza workflow-ul de cautare.

## 8. CRUD Surse

Toate endpoint-urile necesita utilizator autorizat.

### `POST /sources`

Creeaza o sursa cu:

- `id` stabil;
- `name`;
- `url`;
- `category`;
- `active`;
- `connector_available=false` pentru o sursa noua manual.

URL duplicat -> 409.

### `PUT /sources/:id`

Permite editarea:

- nume;
- URL;
- categorie;
- activa/inactiva.

ID-ul si `connector_available` sunt pastrate. URL duplicat -> 409.

### `DELETE /sources/:id`

Sterge efectiv sursa din registrul curent. Istoricul ramane in Git.

### Normalizare catalog

La prima mutatie, catalogul legacy este normalizat la:

```json
{
  "schema_version": "1.0",
  "count": 129,
  "sources": [
    {
      "id": "src-...",
      "name": "...",
      "url": "https://...",
      "category": "...",
      "active": true,
      "connector_available": false
    }
  ]
}
```

Campul legacy `priority` nu este pastrat in modelul normalizat.

## 9. GitHub access

Worker-ul foloseste fine-grained PAT din Cloudflare Secret:

`GITHUB_TOKEN`

Permisiuni necesare:

- Actions: write;
- Contents: write.

PAT-ul nu este livrat browserului.

## 10. Origin si CORS

`FRONTEND_ORIGIN` este verificat pentru cererile privilegiate.

Metode CORS permise: GET, POST, PUT, DELETE, OPTIONS.

Origin strain -> 403. CORS nu inlocuieste autentificarea.

## 11. Variabile si secrete

### Cloudflare Secrets

- `GITHUB_TOKEN`;
- `ALLOWED_GOOGLE_SUB`.

### Variabile non-secret

- `GOOGLE_CLIENT_ID`;
- `FRONTEND_ORIGIN`;
- `GITHUB_OWNER`;
- `GITHUB_REPO`;
- `GITHUB_REF`;
- `GITHUB_WORKFLOW`;
- `SEARCH_CONFIG_PATH`.

`SOURCES_PATH` este optional; implicit `data/sources.json`.

Provider secrets `APIFY_TOKEN` si `JOBSPIPE_API_KEY` raman numai in GitHub Actions Secrets.

## 12. Frontend auth lifecycle

```text
GET /auth/config
  -> Google Sign-In
  -> POST /auth/session
  -> auth valid
  -> token in memorie
  -> incarca /data/*
```

Eroarea de date dupa login nu produce logout automat.

## 13. Build si deploy

`npm run build`:

1. construieste frontend React/Vite;
2. copiaza Static Assets;
3. copiaza cele 6 fisiere JSON protejate necesare, inclusiv `run-history.json`.

## 14. Limitari MVP

- mecanismul de autorizare curent permite un singur utilizator prin configuratia `ALLOWED_GOOGLE_SUB`;
- suportul multi-user este `UNDER ANALYSIS` conform `ARCHITECTURE.md`;
- fara sesiuni server-side;
- fara refresh token propriu;
- fara baza de date Worker;
- arhivarea joburilor ramane locala;
- sursa in catalog nu implica automat connector;
- fara MCP.

## 15. Status verificare

- Python/search logic: validat CI;
- React/Vite: validat CI;
- Worker dry-run: validat CI;
- test E2E complet pentru release 0.05: de confirmat pe deploy-ul live.
