# AI GitHub Bridge

Status: MVP implementat in branch `feature/132-ai-github-bridge`, pending deploy/configurare operationala.
Refs: #127 #132 ADR-002

## Rol

`ai-github-bridge` este un Cloudflare Worker separat de `command-api`. El permite operatii GitHub strict allowlisted sub identitati GitHub App distincte pentru ChatGPT si Claude.

Nu face parte din runtime-ul functional al aplicatiei Job Search Command Center.

## Endpoint-uri MVP

- `GET /health` - public;
- `GET /v1/issues/{number}` - autentificat;
- `POST /v1/issues` - autentificat;
- `PATCH /v1/issues/{number}` - autentificat.

Orice alta operatie este respinsa cu `404 Operation is not allowlisted`.

## Repository

V1 este hard-restrictionat la:

`Shosetzel69/job-search-command-center`

Configurarea unui alt `GITHUB_REPOSITORY` produce eroare de configurare; clientul nu poate furniza un repository arbitrar.

## Identitate

Actorul nu este primit ca parametru de incredere.

- `CHATGPT_BRIDGE_TOKEN` -> `jobsearch-chatgpt-agent[bot]`;
- `CLAUDE_BRIDGE_TOKEN` -> `jobsearch-claude-agent[bot]`.

Bridge-ul genereaza server-side JWT-ul GitHub App si installation token-ul short-lived.

## Config non-secret

`wrangler.jsonc` contine numai identificatori publici/config:

- `GITHUB_REPOSITORY`;
- `CHATGPT_GITHUB_APP_ID`;
- `CHATGPT_GITHUB_INSTALLATION_ID`;
- `CLAUDE_GITHUB_APP_ID`;
- `CLAUDE_GITHUB_INSTALLATION_ID`.

## Secrets obligatorii

Setate exclusiv prin Cloudflare Worker secrets:

- `CHATGPT_BRIDGE_TOKEN`;
- `CLAUDE_BRIDGE_TOKEN`;
- `CHATGPT_GITHUB_PRIVATE_KEY`;
- `CLAUDE_GITHUB_PRIVATE_KEY`.

Exemplu CLI, fara a pune valorile in shell history daca se poate evita:

```bash
cd ai-github-bridge
npx wrangler secret put CHATGPT_BRIDGE_TOKEN
npx wrangler secret put CLAUDE_BRIDGE_TOKEN
npx wrangler secret put CHATGPT_GITHUB_PRIVATE_KEY
npx wrangler secret put CLAUDE_GITHUB_PRIVATE_KEY
```

Private keys nu se copiaza in repo, issue, log sau prompt.

## Contract create issue

`POST /v1/issues`

Body permis:

```json
{
  "title": "Titlu",
  "body": "Text optional",
  "labels": ["requirement"]
}
```

`ai-generated` este adaugat automat si nu trebuie omis.

Campuri precum `assignees`, `milestone`, `repository`, `owner` sau parametri GitHub generici sunt respinsi.

## Contract update issue

`PATCH /v1/issues/{number}`

Campuri permise:

- `title`;
- `body`;
- `state`: `open|closed`;
- `labels`.

Daca `labels` este furnizat, `ai-generated` este pastrat automat.

## Audit

Worker-ul logheaza structurat:

- correlation id;
- actor logic;
- operatie;
- tinta;
- HTTP status;
- error code, daca exista.

Nu logheaza request body, bearer token, GitHub JWT, installation token sau private key.

## Testare

```bash
cd ai-github-bridge
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

Testele folosesc mock pentru GitHub HTTP si chei RSA generate local; nu fac request real la GitHub.

## Deploy

Deploy-ul nu se executa pana cand cele patru secrets sunt configurate in Worker-ul tinta.

```bash
cd ai-github-bridge
npm run deploy
```

Dupa deploy:

1. `GET /health` -> 200;
2. test ChatGPT credential -> issue creat de `jobsearch-chatgpt-agent[bot]`;
3. test Claude credential -> issue creat de `jobsearch-claude-agent[bot]`;
4. endpoint neallowlisted -> 404;
5. credential invalid -> 401.

## Extinderi neimplementate

Files, branches, PR, checks si comments nu sunt incluse in MVP. Ele necesita extindere explicita a contractului si teste de branch/main safety conform #132.
