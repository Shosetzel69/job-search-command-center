# Analiza - Remote MCP Claude

Data: 2026-09-10
Issue: #136
Status: APPROVED / IMPLEMENTAT IN BRANCH

## Problema

Claude Web trebuie sa acceseze repository-ul sub identitatea GitHub App `jobsearch-claude-agent[bot]`, fara runtime local si fara a expune credentialele GitHub App clientului.

## Solutie

Se extinde `ai-github-bridge` existent cu Remote MCP stateless la `/mcp` si OAuth 2.1 prin `@cloudflare/workers-oauth-provider`.

Flux:

`Claude Web -> OAuth 2.1 -> /mcp -> GitHub App Claude -> GitHub API -> repository canonic`

Nu se introduce Worker nou si nu se modifica `command-api`.

## Scope Faza 1

Tools:
- `read_file`;
- `get_issue`;
- `create_issue`;
- `update_issue`.

Repository-ul ramane hard-allowlisted. Actorul MCP este Claude si este stabilit server-side. Nu exista write pe files/branches/PR.

## Dependinte aprobate

- `@cloudflare/workers-oauth-provider`;
- `@modelcontextprotocol/server`;
- `agents`;
- `zod`.

## Runtime

- Cloudflare Worker existent `ai-github-bridge`;
- KV binding `OAUTH_KV` numai pentru OAuth;
- secret `MCP_OWNER_ACCESS_CODE` pentru autorizarea owner-ului;
- GitHub App credentials raman Worker secrets.

## Validare

- teste Node izolate;
- Wrangler dry-run;
- dupa merge/deploy: conectare Claude Web la URL-ul `/mcp` si creare Issue de test;
- autorul trebuie sa fie exact `jobsearch-claude-agent[bot]`.
