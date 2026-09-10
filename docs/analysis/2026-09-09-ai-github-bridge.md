# Analiza - GitHub App bridge pentru identitati AI

Data: 2026-09-09
Actualizare: 2026-09-10
Issues: #132 #136 #140 #143
Status: APPROVED / MERGED / DEPLOYED / LIVE VALIDATED

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

Issue #136 adauga peste acelasi Worker o interfata standard Remote MCP pentru Claude Web. Boundary-ul arhitectural ramane:

`AI client -> ai-github-bridge -> GitHub App dedicat -> GitHub API -> repository allowlisted`

Nu se introduce un Worker nou, proxy generic sau runtime local.

## Contract Remote MCP #136

Transport:

- Streamable HTTP;
- endpoint `/mcp`;
- stateless;
- OAuth 2.1 pentru client -> MCP;
- GitHub App authentication separata pentru MCP -> GitHub.

Configuratia operationala curenta este Claude-only si expune:

- `read_file` - read-only, UTF-8, repository fix;
- `get_issue`;
- `create_issue`;
- `update_issue`.

Identitatea downstream este hard-bound server-side la `jobsearch-claude-agent[bot]`.

Write pe files, branches si pull requests nu intra in scope-ul curent.

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
- `ai-generated` impus server-side la creare si pastrat/adaugat daca labels sunt trimise explicit la update;
- actor Claude determinat server-side;
- fara code write prin MCP in scope-ul curent;
- audit fara request body si fara credentials.

## Implementare finala issue tools

Implementarea initiala a `get_issue`, `create_issue` si `update_issue` folosea un self-call intern din MCP catre interfata REST a aceluiasi Worker.

Validarea live a aratat:

- `read_file` functiona;
- issue tools returnau `Unexpected bridge error`.

PR #140 a eliminat self-call-ul intern. Toate cele patru tools folosesc acum autentificarea GitHub App Claude si apeleaza GitHub API direct.

Fluxul pentru issue tools este:

`MCP tool -> GitHub App JWT -> installation token -> GitHub Issues API`

Aceasta este o corectie de implementare in interiorul aceluiasi boundary, nu o schimbare arhitecturala.

## Dependinte

Extinderea #136 foloseste:

- `agents` 0.22.0;
- `@modelcontextprotocol/server` 2.0.0;
- `zod` 4.5.4;
- `@cloudflare/workers-oauth-provider` 0.10.3.

Wrangler ramane 4.129.0.

## Testare

Testele automate sunt izolate si folosesc mocks pentru GitHub.

Acoperire relevanta:

- owner access code absent/invalid;
- secretul owner nu apare in pagina de autorizare;
- grantul OAuth valid este legat server-side de actorul Claude;
- tool surface MCP;
- GET/POST/PATCH issue calls directe;
- erori GitHub API;
- Wrangler dry-run.

## Status operational 2026-09-10

- #136 integrat prin PR #137;
- `OAUTH_KV` creat si versionat in `wrangler.jsonc`;
- `MCP_OWNER_ACCESS_CODE` configurat ca Worker secret de owner;
- Cloudflare Workers Builds conectat la repository pentru `ai-github-bridge` cu production branch `main` si root `/ai-github-bridge/`;
- deploy live executat;
- Claude Web conectat prin OAuth la `/mcp`;
- `read_file`: PASS;
- `get_issue`: PASS dupa #140;
- `create_issue`: PASS, issue #143;
- autor #143: `jobsearch-claude-agent[bot]`: PASS;
- `update_issue` + close #143: PASS;
- titlul si label-urile #143 pastrate: PASS.

## Mod de lucru rezultat

- GitHub ramane baseline-ul tehnic;
- modificarile de continut se fac numai pe branch explicit verificat, niciodata direct pe `main`;
- Issues relevante urmaresc schimbarea;
- la update de Issue, titlul si label-urile se pastreaza implicit si se modifica numai la cerere/aprobare explicita;
- `main` se modifica exclusiv prin PR/merge conform `GOVERNANCE.md`.

## Relatia cu #125

#136 nu implementeaza DEV/TEST/PROD pentru aplicatie. Bridge-ul ramane infrastructura separata, iar deploy-ul lui respecta Deploy Immutability Rule.
