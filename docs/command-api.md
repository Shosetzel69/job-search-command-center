# Command API

Versiune aplicatie: `0.05`
Ultima actualizare: `2026-09-08`

## 1. Scop

Command API permite frontend-ului React sa execute actiuni privilegiate si sa acceseze date protejate fara a expune credentiale GitHub in browser.

Responsabilitati:

- validare/autorizare Google;
- protectie `/data/*`;
- rulare manuala `Ruleaza verificarea`;
- persistare configuratie in `data/search-config.json`;
- CRUD persistent pentru `data/sources.json`;
- acces server-side la GitHub Actions si GitHub Contents API.

Nu este motorul de cautare si nu este o baza de date.

## 2. Regula de executie - Package 1

Salvarea configuratiei si executia cautarii sunt operatii separate.

```text
Salveaza preferintele
-> PUT /config
-> validare
-> persistare
-> STOP

Ruleaza verificarea
-> POST /commands/run
-> validare criterii curente
-> persistare daca exista modificari
-> verificare run activ
-> workflow_dispatch(run_trigger=manual-ui)
-> 202 Accepted
```

Reguli:

- `PUT /config` nu lanseaza full search;
- commit/push de configuratie, surse, cod sau documentatie nu lanseaza full search;
- scheduler-ul este OFF in Package 1;
- full search se lanseaza numai prin `workflow_dispatch`;
- o singura rulare poate fi `queued`/`in_progress`;
- o a doua comanda returneaza 409;
- configuratia invalida returneaza 400 si nu face dispatch;
- targetul geografic nu poate fi complet gol;
- `Worldwide` nu este dedus din lipsa targetului de cautare.

## 3. Componente

- `command-api/src/index.js` - auth, Command API, GitHub API, configuratie si Surse;
- `command-api/src/secure-entry.js` - protectia `/data/*` + delegare;
- `command-api/wrangler.jsonc` - configuratie Worker/Static Assets;
- `command-api/scripts/build-static.mjs` - asamblarea bundle-ului public.

## 4. Autentificare Google

Browserul trimite:

```text
Authorization: Bearer <GOOGLE_ID_TOKEN>
```

Worker-ul verifica:

- semnatura prin Google JWKS;
- issuer Google;
- audience = `GOOGLE_CLIENT_ID`;
- `payload.sub = ALLOWED_GOOGLE_SUB`.

Tokenul ramane numai in memoria frontend-ului.

## 5. Endpoint-uri publice

### `GET /health`

Returneaza starea minima a Worker-ului si daca auth/GitHub sunt configurate.

### `GET /auth/config`

Returneaza `GOOGLE_CLIENT_ID` si starea necesara Google Sign-In.

## 6. Endpoint autentificare

### `POST /auth/session`

Necesita bearer Google valid si confirma utilizatorul autorizat.

## 7. Date protejate

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
- token lipsa/invalid -> 401/403;
- `cache-control: no-store`;
- `x-content-type-options: nosniff`.

`search-state.json` nu este publicat.

## 8. Comenzi protejate

### `POST /commands/run`

Body-ul JSON este optional. Frontend-ul curent trimite criteriile curente din UI.

Flux:

1. verifica daca exista run `queued` sau `in_progress`;
2. valideaza criteriile primite sau configuratia canonica existenta;
3. daca criteriile primite difera, le persista in `data/search-config.json`;
4. lanseaza exact un `workflow_dispatch` cu `run_trigger=manual-ui`;
5. returneaza 202.

Raspuns exemplu:

```json
{
  "status": "accepted",
  "trigger": "manual-ui",
  "config_commit": "<sha-or-null>"
}
```

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
- `jobspipeMode` si limitele asociate;
- `targetRegions`;
- `targetCountries`;
- `excludedRegions`;
- `excludedCountries`.

Reguli geografice server-side:

- regiuni permise: `EU`, `US`, `ASIA`;
- codurile de tara trebuie sa fie ISO alpha-2;
- trebuie sa existe cel putin o tara sau regiune tinta;
- aceeasi tara/regiune nu poate fi simultan inclusa si exclusa;
- suprapunerea regiune inclusa/tara exclusa sau invers este respinsa cu 400.

Configuratia este scrisa prin GitHub Contents API numai daca s-a modificat. Salvarea nu face dispatch.

## 9. CRUD Surse

Toate endpoint-urile necesita utilizator autorizat.

### `POST /sources`

Creeaza o sursa cu:

- `id` stabil;
- `name`;
- `url`;
- `category`;
- `active`;
- `connector_available` derivat din ruta tehnica disponibila.

URL duplicat -> 409.

### `PUT /sources/:id`

Permite editarea numelui, URL-ului, categoriei si starii active/inactive. URL duplicat -> 409.

### `DELETE /sources/:id`

Sterge sursa din registrul curent. Istoricul ramane in Git.

Modificarile Source Registry nu lanseaza full search in Package 1.

## 10. Trigger si loguri

Trigger canonic pentru Package 1:

`manual-ui`

Runner-ul persista trigger-ul in:

- `data/run-status.json`;
- `data/run-history.json`.

`config` nu este trigger valid pentru full search.

`scheduled` este rezervat Package 2, cand automatizarea configurabila va fi implementata.

## 11. GitHub access

Worker-ul foloseste `GITHUB_TOKEN` din Cloudflare Secret.

Permisiuni necesare:

- Actions: write;
- Contents: write.

Tokenul nu este livrat browserului.

## 12. Origin si CORS

`FRONTEND_ORIGIN` este verificat pentru cererile privilegiate.

Metode permise: GET, POST, PUT, DELETE, OPTIONS.

Origin strain -> 403. CORS nu inlocuieste autentificarea.

## 13. Variabile si secrete

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
- `SEARCH_CONFIG_PATH`;
- optional `SOURCES_PATH`.

Provider secrets `APIFY_TOKEN` si `JOBSPIPE_API_KEY` raman numai in GitHub Actions Secrets.

## 14. Testare

CI valideaza minimum:

- Python syntax/config;
- target geografic valid;
- regression test pentru job Hybrid JP exclus din target RO/BE/LU;
- full search fara trigger `push` sau `schedule`;
- Command API config validation;
- protected data fara bearer -> 401;
- origin nepermis -> 403;
- React/Vite build;
- Worker dry-run.

Validarea E2E finala este definita in #24 si #79.
