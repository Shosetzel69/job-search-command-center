# AI GitHub Bridge

Status: operational. MVP REST implementat; Remote MCP Claude deployat si validat live la 2026-09-10.
Refs: #127 #132 #136 #140 #143 #204 ADR-002

## Rol

`ai-github-bridge` este un Cloudflare Worker separat de `command-api`. El permite operatii GitHub strict allowlisted sub identitati GitHub App distincte pentru ChatGPT si Claude.

Nu face parte din runtime-ul functional al aplicatiei Job Search Command Center.

## Boundary

```text
AI client
  -> ai-github-bridge
  -> GitHub App dedicat
  -> GitHub API
  -> Shosetzel69/job-search-command-center
```

Nu exista runtime local obligatoriu, PAT personal sau proxy GitHub generic.

## Interfete

### REST

- `GET /health` - public;
- `GET /v1/issues/{number}` - autentificat;
- `POST /v1/issues` - autentificat;
- `PATCH /v1/issues/{number}` - autentificat;
- `POST /v1/actions/environment-deploy` - dispatch strict allowlisted pentru DEV/TEST.

REST foloseste bearer credentials separate pentru ChatGPT si Claude.

### Remote MCP Claude

- endpoint: `https://ai-github-bridge.myeboda.workers.dev/mcp`;
- transport: Streamable HTTP;
- model: stateless;
- auth client -> MCP: OAuth 2.1;
- actor: Claude;
- downstream GitHub identity: `jobsearch-claude-agent[bot]`.

Tools operationale:

- `read_file`;
- `get_issue`;
- `create_issue`;
- `update_issue`;
- `dispatch_environment_deploy`.

Nu exista write pe files/branches/PR prin MCP in scope-ul curent. `dispatch_environment_deploy` nu este proxy Actions generic: repository-ul, workflow-ul `deploy-environment.yml`, ref-ul `main`, actiunea `deploy` si `dry_run=false` sunt fixate server-side. Sunt acceptate numai mediile `dev|test`; PROD este respins de bridge.

## Repository

V1 este hard-restrictionat la:

`Shosetzel69/job-search-command-center`

Clientul nu poate furniza un repository arbitrar.

## Identitate

REST:

- `CHATGPT_BRIDGE_TOKEN` -> `jobsearch-chatgpt-agent[bot]`;
- `CLAUDE_BRIDGE_TOKEN` -> `jobsearch-claude-agent[bot]`.

Remote MCP Claude este autorizat prin OAuth, iar operatiile GitHub sunt hard-bound server-side la GitHub App Claude. Actorul nu este selectat din payload-ul MCP.

Bridge-ul genereaza server-side JWT-ul GitHub App si installation token-ul short-lived.

Pentru #204, GitHub Apps care folosesc dispatch-ul trebuie sa aiba permisiunea repository **Actions: Read and write**. Fara aceasta permisiune GitHub raspunde 403; bridge-ul nu incearca fallback cu alt credential.

## Implementare MCP -> GitHub

`read_file` si operatiile Issue folosesc direct GitHub App Claude pentru a obtine installation token si pentru a apela GitHub API.

Dupa validarea live initiala, `get_issue`, `create_issue` si `update_issue` au fost mutate prin #140 de la un self-call MCP -> REST intern la acelasi flux direct GitHub App folosit de `read_file`. Boundary-ul arhitectural nu s-a schimbat; a fost eliminat doar hop-ul intern care genera `Unexpected bridge error`.

La `create_issue`, label-ul `ai-generated` este impus server-side. La `update_issue`, daca labels sunt trimise explicit, `ai-generated` este pastrat/adaugat server-side.

## Config non-secret

`wrangler.jsonc` contine numai identificatori publici/config:

- `GITHUB_REPOSITORY`;
- `CHATGPT_GITHUB_APP_ID`;
- `CHATGPT_GITHUB_INSTALLATION_ID`;
- `CLAUDE_GITHUB_APP_ID`;
- `CLAUDE_GITHUB_INSTALLATION_ID`;
- binding-ul KV `OAUTH_KV`.

## Secrets obligatorii

- `CHATGPT_BRIDGE_TOKEN`;
- `CLAUDE_BRIDGE_TOKEN`;
- `CHATGPT_GITHUB_PRIVATE_KEY`;
- `CLAUDE_GITHUB_PRIVATE_KEY`;
- `MCP_OWNER_ACCESS_CODE`.

Private keys, bridge tokens si owner access code nu se copiaza in repo, issue, log sau prompt.

## OAuth si securitate MCP

- OAuth provider: `@cloudflare/workers-oauth-provider`;
- storage OAuth: Cloudflare KV `OAUTH_KV`;
- S256 PKCE obligatoriu;
- access token TTL: 1 ora;
- refresh token TTL: 30 zile;
- grantul owner este legat server-side de `props.actor = claude`;
- `read_file` este read-only si limiteaza output-ul la maximum 400 linii per apel;
- repository-ul si actorul sunt validate server-side;
- fara generic GitHub proxy.

## Configurare Cloudflare validata

- Worker: `ai-github-bridge`;
- production branch: `main`;
- root directory: `/ai-github-bridge/`;
- deploy command: `npx wrangler deploy`;
- non-production/version command: `npx wrangler versions upload`;
- KV binding: `OAUTH_KV`;
- secret owner OAuth: `MCP_OWNER_ACCESS_CODE`.

## Release workflow dispatch #204

Contractul este intentionat restrans:

```text
POST /v1/actions/environment-deploy
  environment = dev | test
  source_sha = full 40-char SHA
  issue_pr = required for DEV
  dev_evidence_run_id = required for TEST
```

Server-side:

```text
repository = Shosetzel69/job-search-command-center
workflow = deploy-environment.yml
ref = main
action = deploy
dry_run = false
```

Clientul nu poate selecta alt repository, workflow, ref, action sau input arbitrar. PROD, `prod-cutover.yml` si owner GO nu fac parte din #204.

## Audit

Worker-ul nu logheaza request body, bearer token, OAuth token, GitHub JWT, installation token, private key sau owner access code.

## Testare

```bash
cd ai-github-bridge
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

Testele automate nu fac request real la GitHub.

Validarea live finala a fost efectuata prin Claude Web:

1. OAuth owner - PASS;
2. `read_file` pe `GOVERNANCE.md` - PASS;
3. `get_issue` pe #136 - PASS;
4. `create_issue` - PASS, issue #143;
5. autor #143 = `jobsearch-claude-agent[bot]` - PASS;
6. `update_issue` + close #143 - PASS;
7. titlul si label-urile #143 au ramas neschimbate - PASS.

Validarea live pentru #204 necesita, separat:
1. confirmarea permisiunii GitHub App Actions: Read and write;
2. un dispatch DEV non-PROD pe un candidate SHA aprobat;
3. verificarea ca run-ul rezultat este `Environment automation` din `main` si foloseste exact inputurile asteptate.

## Reguli de lucru

- titlul si label-urile unui Issue existent se pastreaza implicit;
- se modifica numai la cerere/aprobare explicita a owner-ului;
- operatiile de continut GitHub nu se fac direct pe `main`;
- orice extindere spre files/branches/PR necesita change separat, branch dedicat, teste de branch/main safety si PR.

## Extinderi ulterioare

Remote MCP ChatGPT nu este activ in configuratia curenta. Poate folosi acelasi boundary cu actor separat `jobsearch-chatgpt-agent[bot]` dupa un change aprobat si validare dedicata.
