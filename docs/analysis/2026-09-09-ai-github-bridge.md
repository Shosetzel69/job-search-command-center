# Analiza - GitHub App bridge pentru identitati AI

Data: 2026-09-09
Actualizare: 2026-09-10
Issues: #132 #136
Status: APPROVED / REMOTE MCP IN IMPLEMENTATION

## Problema

GitHub Apps distincte pentru ChatGPT si Claude au fost validate prin #128 si #131, dar integrarile standard din chat nu folosesc direct credentialele acestor Apps.

## Decizie aprobata

Owner GO: 2026-09-09 pentru bridge si 2026-09-10 pentru extinderea Remote MCP.

Se foloseste un singur Cloudflare Worker dedicat `ai-github-bridge`, separat de `command-api`.

ADR: `docs/adr/ADR-002-ai-github-bridge.md`.

## Evolutie fata de MVP #132

MVP-ul #132 a redus suprafata initiala la issues:

- get issue;
- create issue;
- update issue.

Actorul REST este derivat din bearer credentialul bridge; clientul nu poate selecta arbitrar identitatea.

Issue #136 adauga peste acelasi Worker o interfata standard Remote MCP pentru conectarea Claude Web si, ulterior, ChatGPT. Boundary-ul arhitectural nu se schimba:

`AI client -> ai-github-bridge -> GitHub App dedicat -> GitHub API -> repository allowlisted`

Nu se introduce un Worker nou, proxy generic sau runtime local.

## Contract Remote MCP #136

Transport:

- Streamable HTTP;
- endpoint `/mcp`;
- stateless;
- OAuth 2.1 pentru client -> MCP;
- GitHub App authentication separata pentru MCP -> GitHub.

Faza 1 este Claude-only si expune:

- `read_file` - read-only, UTF-8, repository fix;
- `get_issue`;
- `create_issue`;
- `update_issue`.

Identitatea downstream este hard-bound server-side la `jobsearch-claude-agent[bot]`.

Write pe files, branches si pull requests nu intra in Faza 1.

## Autentificare owner

OAuth MCP foloseste `@cloudflare/workers-oauth-provider` cu storage `OAUTH_KV`.

Autorizarea este single-owner: pagina `/authorize` cere un secret separat `MCP_OWNER_ACCESS_CODE`, stocat exclusiv ca Cloudflare Worker secret. Dupa validare, grantul OAuth primeste server-side `props.actor = claude`.

Secretul owner nu este trimis modelului si nu este returnat in raspunsuri/loguri.

## Contract de securitate rezultat

- repository fix `Shosetzel69/job-search-command-center`;
- GitHub App private keys numai ca Worker secrets;
- JWT si installation tokens generate server-side;
- OAuth access/refresh tokens gestionate de provider si KV;
- fara generic GitHub proxy;
- operatii MCP allowlisted;
- `ai-generated` impus pentru create/update labels prin contractul bridge existent;
- actor Claude determinat server-side;
- fara code write in Faza 1;
- audit fara request body si fara credentials.

## Dependinte

MVP #132 nu avea dependinte runtime noi. Extinderea #136 adauga dependinte oficiale pentru Remote MCP:

- `agents` 0.22.0;
- `@modelcontextprotocol/server` 2.0.0;
- `zod` 4.5.4;
- `@cloudflare/workers-oauth-provider` 0.10.0.

Wrangler ramane 4.129.0.

## Testare

Testele existente raman izolate si folosesc mock HTTP pentru GitHub.

#136 adauga teste pentru:

- owner access code absent/invalid;
- secretul owner nu apare in pagina de autorizare;
- grantul OAuth valid este legat server-side de actorul Claude;
- build/dry-run al Worker-ului cu MCP SDK.

Validarea live finala necesita:

1. configurare `OAUTH_KV`;
2. configurare `MCP_OWNER_ACCESS_CODE`;
3. deploy Worker;
4. conectare Claude Web la `/mcp`;
5. `read_file` real;
6. create issue real cu autor exact `jobsearch-claude-agent[bot]`.

## Relatia cu #125

#136 nu implementeaza DEV/TEST/PROD pentru aplicatie. Bridge-ul ramane infrastructura separata, iar deploy-ul lui respecta governance-ul propriu si Deploy Immutability Rule.
