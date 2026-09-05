# Command API

## Scop

Command API este componenta server-side minima care permite frontend-ului static sa execute actiuni privilegiate fara a expune credentiale GitHub in browser.

Este necesar pentru:

- `Ruleaza verificarea`;
- persistarea criteriilor din UI in `data/search-config.json`.

Nu inlocuieste motorul de cautare si nu introduce un backend permanent pentru joburi.

## Flux

```text
Browser / GitHub Pages
       |
       | Sign in with Google
       v
Google ID token
       |
       v
Cloudflare Worker - Command API
       |
       +--> verifica JWT Google
       +--> verifica utilizatorul autorizat
       +--> verifica Origin
       |
       +--> GitHub Actions workflow_dispatch
       |
       +--> GitHub Contents API -> data/search-config.json
```

## De ce componenta separata

Frontend-ul static nu poate pastra in siguranta un PAT GitHub, client secret sau alta credentilala privilegiata. Orice secret livrat browserului trebuie considerat public.

Command API pastreaza secretele exclusiv server-side.

## Autentificare

Frontend-ul foloseste Google Identity Services.

Browser-ul primeste un Google ID token si il trimite in header:

```text
Authorization: Bearer <GOOGLE_ID_TOKEN>
```

Worker-ul verifica:

- semnatura JWT folosind Google JWKS;
- issuer Google;
- audience = `GOOGLE_CLIENT_ID`;
- `sub` = `ALLOWED_GOOGLE_SUB`.

Pentru autorizare se foloseste `sub`, nu adresa email, deoarece `sub` este identificatorul stabil al contului Google pentru clientul respectiv.

## GitHub

Worker-ul foloseste initial un fine-grained personal access token limitat la repository-ul:

`Shosetzel69/job-search-command-center`

Permisiuni minime necesare:

- `Actions: write` - pentru `workflow_dispatch`;
- `Contents: write` - pentru actualizarea `data/search-config.json`.

Tokenul este stocat ca secret Cloudflare `GITHUB_TOKEN` si nu este inclus in repository sau frontend.

Pentru o etapa multi-user, PAT-ul poate fi inlocuit cu GitHub App installation tokens fara modificarea contractului frontend.

## Endpoint-uri

### `GET /health`

Public. Verifica daca Worker-ul este disponibil.

Raspuns:

```json
{"status":"ok"}
```

### `POST /commands/run`

Necesita autentificare Google.

Comportament:

1. verifica daca exista deja o rulare `queued` sau `in_progress`;
2. daca exista, returneaza HTTP 409;
3. altfel executa `workflow_dispatch` pentru `job-search-full.yml` pe `main`;
4. returneaza HTTP 202.

Frontend-ul continua sa urmareasca starea prin `data/run-status.json`.

### `PUT /config`

Necesita autentificare Google.

Accepta numai campurile editabile din UI:

- roluri active;
- Remote/Hibrid;
- freshness 24/48h;
- fit threshold 50-100;
- repostari;
- rate min/max;
- immediate start;
- excluderi.

Worker-ul:

1. citeste configuratia canonica din GitHub;
2. valideaza patch-ul;
3. modifica numai campurile permise;
4. salveaza fisierul prin GitHub Contents API.

Commit-ul configuratiei declanseaza workflow-ul de cautare prin regula existenta pentru `data/search-config.json`.

## CORS

Worker-ul accepta cereri browser numai de la valoarea exacta `FRONTEND_ORIGIN`.

CORS nu este mecanism de autentificare. Autentificarea Google ramane obligatorie pentru endpoint-urile privilegiate.

## Secrete

Cloudflare secrets:

- `GITHUB_TOKEN`;
- `ALLOWED_GOOGLE_SUB`.

Configuratie publica/non-secret:

- `FRONTEND_ORIGIN`;
- `GOOGLE_CLIENT_ID`;
- `GITHUB_OWNER`;
- `GITHUB_REPO`;
- `GITHUB_REF`;
- `GITHUB_WORKFLOW`;
- `SEARCH_CONFIG_PATH`.

## Setup necesar o singura data

1. Creeaza/configureaza Google OAuth Web Client pentru frontend.
2. Obtine `GOOGLE_CLIENT_ID`.
3. Obtine `sub` pentru contul Google autorizat dupa primul login.
4. Creeaza fine-grained PAT GitHub limitat la repository, cu `Actions: write` si `Contents: write`.
5. Creeaza un Cloudflare Worker.
6. Seteaza `FRONTEND_ORIGIN` si `GOOGLE_CLIENT_ID`.
7. Seteaza secretele `GITHUB_TOKEN` si `ALLOWED_GOOGLE_SUB`.
8. Ruleaza deploy din directorul `command-api/`.
9. Testeaza `/health`.
10. Integreaza URL-ul Worker si Google Sign-In in frontend.

## Cost

Pentru volumul single-user al acestei aplicatii, Command API este proiectat sa intre in limitele Cloudflare Workers Free. Daca politica de pret sau limitele se schimba, componenta poate fi mutata pe alta platforma serverless deoarece contractul HTTP este independent de Cloudflare.

## Limite MVP

- un singur utilizator autorizat prin `ALLOWED_GOOGLE_SUB`;
- fara sesiuni server-side;
- fara baza de date in Worker;
- fara MCP;
- fara documente private;
- sursele active/inactive vor fi persistate separat dupa finalizarea connector registry.
