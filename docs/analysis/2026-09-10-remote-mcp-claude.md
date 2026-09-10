# Analiza - Remote MCP Claude

Data: 2026-09-10
Issue: #136
Status: COMPLETED / DEPLOYED / LIVE VALIDATED

## Problema

Claude Web trebuie sa acceseze repository-ul sub identitatea GitHub App `jobsearch-claude-agent[bot]`, fara runtime local si fara a expune credentialele GitHub App clientului.

## Solutie finala

Se foloseste `ai-github-bridge` existent cu Remote MCP stateless la `/mcp` si OAuth 2.1 prin `@cloudflare/workers-oauth-provider`.

Flux final:

`Claude Web -> OAuth 2.1 -> /mcp -> GitHub App Claude -> GitHub API -> repository canonic`

Nu se introduce Worker nou si nu se modifica `command-api`.

## Scope operational

Tools:

- `read_file`;
- `get_issue`;
- `create_issue`;
- `update_issue`.

Repository-ul ramane hard-allowlisted. Actorul MCP este Claude si este stabilit server-side. Nu exista write pe files/branches/PR prin MCP.

## Implementare finala

Implementarea initiala a operatiilor Issue apela intern interfata REST a aceluiasi Worker. In validarea live, `read_file` a functionat, dar `get_issue` si `create_issue` au returnat `Unexpected bridge error`.

Prin PR #140, `get_issue`, `create_issue` si `update_issue` au fost mutate pe acelasi mecanism direct GitHub App folosit de `read_file`:

`MCP tool -> GitHub App JWT -> installation token -> GitHub API`

Aceasta modificare elimina self-call-ul intern MCP -> REST fara sa schimbe boundary-ul arhitectural aprobat.

## Dependinte aprobate

- `@cloudflare/workers-oauth-provider`;
- `@modelcontextprotocol/server`;
- `agents`;
- `zod`.

## Runtime

- Cloudflare Worker existent `ai-github-bridge`;
- KV binding `OAUTH_KV` numai pentru OAuth;
- secret `MCP_OWNER_ACCESS_CODE` pentru autorizarea owner-ului;
- GitHub App credentials raman Worker secrets;
- Cloudflare Workers Builds foloseste production branch `main` si root `/ai-github-bridge/`.

## Validare finala

Validare live 2026-09-10:

- OAuth owner: PASS;
- `read_file` pe `GOVERNANCE.md`: PASS;
- `get_issue` pe #136: PASS;
- `create_issue`: PASS;
- issue de test: #143;
- autor #143: `jobsearch-claude-agent[bot]`: PASS;
- `update_issue` + close #143: PASS;
- titlul si label-urile #143 au ramas neschimbate: PASS;
- `ai-generated` prezent: PASS.

Testele Node izolate si Wrangler dry-run sunt acoperite de CI-ul bridge-ului.

## Regula de lucru rezultata

La actualizarea unui Issue existent, titlul si label-urile sunt pastrate implicit. Ele se modifica numai la solicitarea sau aprobarea explicita a owner-ului.

Pentru write pe fisiere/branches/PR nu exista tool MCP in scope-ul curent. Orice extindere ulterioara necesita change separat si Branch Target Safety Rule din `GOVERNANCE.md`.
