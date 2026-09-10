# AI GitHub Bridge

Status: MVP REST implementat; Remote MCP Claude integrat in `main`, pending deploy live si validare operationala.
Refs: #127 #132 #136 ADR-002

## Rol

`ai-github-bridge` este un Cloudflare Worker separat de `command-api`. El permite operatii GitHub strict allowlisted sub identitati GitHub App distincte pentru ChatGPT si Claude.

Nu face parte din runtime-ul functional al aplicatiei Job Search Command Center.

## Interfete

### REST existent

- `GET /health` - public;
- `GET /v1/issues/{number}` - autentificat;
- `POST /v1/issues` - autentificat;
- `PATCH /v1/issues/{number}` - autentificat.

### Remote MCP #136

- endpoint: `/mcp`;
- transport: Streamable HTTP;
- model: stateless;
- auth client -> MCP: OAuth 2.1;
- actor Faza 1: Claude;
- downstream GitHub identity: `jobsearch-claude-agent[bot]`.

Tools Faza 1:

- `read_file`;
- `get_issue`;
- `create_issue`;
- `update_issue`.

Nu exista write pe files/branches/PR in Faza 1.

## Repository

V1 este hard-restrictionat la:

`Shosetzel69/job-search-command-center`

Clientul nu poate furniza un repository arbitrar.

## Identitate

REST:

- `CHATGPT_BRIDGE_TOKEN` -> `jobsearch-chatgpt-agent[bot]`;
- `CLAUDE_BRIDGE_TOKEN` -> `jobsearch-claude-agent[bot]`.

Remote MCP Claude este autorizat separat prin OAuth, dar operatiile GitHub sunt hard-bound server-side la GitHub App Claude. Actorul nu este selectat din payload-ul MCP.

Bridge-ul genereaza server-side JWT-ul GitHub App si installation token-ul short-lived.

## Config non-secret

`wrangler.jsonc` contine numai identificatori publici/config:

- `GITHUB_REPOSITORY`;
- `CHATGPT_GITHUB_APP_ID`;
- `CHATGPT_GITHUB_INSTALLATION_ID`;
- `CLAUDE_GITHUB_APP_ID`;
- `CLAUDE_GITHUB_INSTALLATION_ID`;
- binding-ul KV `OAUTH_KV`.

## Secrets obligatorii

Existente:

- `CHATGPT_BRIDGE_TOKEN`;
- `CLAUDE_BRIDGE_TOKEN`;
- `CHATGPT_GITHUB_PRIVATE_KEY`;
- `CLAUDE_GITHUB_PRIVATE_KEY`.

Remote MCP adauga:

- `MCP_OWNER_ACCESS_CODE` - secret lung folosit numai de owner in pagina `/authorize`.

Private keys, bridge tokens si owner access code nu se copiaza in repo, issue, log sau prompt.

## Securitate MCP

- OAuth provider: `@cloudflare/workers-oauth-provider`;
- storage OAuth: Cloudflare KV `OAUTH_KV`;
- S256 PKCE obligatoriu;
- access token TTL: 1 ora;
- refresh token TTL: 30 zile;
- grantul owner este legat server-side de `props.actor = claude`;
- `read_file` este read-only si limiteaza output-ul la maximum 400 linii per apel;
- `create_issue` si `update_issue` reutilizeaza validarea REST existenta;
- `ai-generated` este impus de bridge pentru labels;
- fara generic GitHub proxy.

## Audit

Worker-ul nu logheaza request body, bearer token, OAuth token, GitHub JWT, installation token, private key sau owner access code.

## Testare

```bash
cd ai-github-bridge
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

Testele nu fac request real la GitHub.

## Configurare Remote MCP

Configuratia operationala pregatita la 2026-09-10:

1. Cloudflare KV namespace creat si legat ca `OAUTH_KV` in `wrangler.jsonc`;
2. Worker secret `MCP_OWNER_ACCESS_CODE` configurat de owner;
3. Cloudflare Workers Builds conectat la repository, production branch `main`, root directory `/ai-github-bridge/`;
4. deploy command `npx wrangler deploy`;
5. non-production version command `npx wrangler versions upload`.

Dupa deploy, Claude Web se conecteaza la:

`https://ai-github-bridge.myeboda.workers.dev/mcp`

Validarea finala:

1. OAuth owner reusit;
2. `read_file` pe `GOVERNANCE.md`;
3. `create_issue` de test;
4. autor issue exact `jobsearch-claude-agent[bot]`;
5. niciun secret expus.

Issue #136 ramane deschis pana cand validarea live este completa.

## Extinderi ulterioare

ChatGPT va folosi aceeasi arhitectura cu actor separat dupa validarea Claude. Orice write pe files/branches/PR necesita change separat si respectarea branch + PR governance.
