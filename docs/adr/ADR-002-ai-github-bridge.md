# ADR-002 - GitHub App bridge dedicat pentru identitati AI

Status: Accepted
Data: 2026-09-09
Refs: #127 #132 #128 #131

## Context

Proiectul foloseste agenti AI pentru analiza, development si QA. GitHub Apps dedicate au fost create si validate pentru doua identitati distincte:

- `jobsearch-chatgpt-agent[bot]`;
- `jobsearch-claude-agent[bot]`.

Testele #128 si #131 au demonstrat ca fiecare GitHub App poate genera installation tokens si poate crea issues sub identitatea bot corespunzatoare.

Integrarea GitHub standard folosita din ChatGPT nu poate fi reconfigurata direct cu private key-ul GitHub App-ului proiectului. Este necesar un mecanism intermediar controlat.

## Problema

Trebuie permis un set limitat de operatii GitHub executate de agentii AI sub identitati distincte, fara:

- expunerea private keys, JWT-urilor sau installation tokens catre model;
- proxy GitHub generic;
- write direct in `main`;
- extinderea blast radius-ului Command API-ului functional al aplicatiei.

## Optiuni analizate

### A. Cloudflare Worker dedicat

`AI integration -> ai-github-bridge -> GitHub App -> GitHub API`

Avantaje:
- separare clara de runtime-ul functional;
- secrets izolate;
- allowlist explicita pentru repo, actor si operatie;
- audit separat;
- blast radius redus.

Dezavantaje:
- componenta serverless suplimentara;
- necesita autentificare separata agent -> bridge.

### B. Extinderea Command API existent

Avantaje:
- reutilizeaza Worker-ul existent;
- mai putine componente.

Dezavantaje:
- amesteca responsabilitati de business si engineering governance;
- mareste suprafata de atac si blast radius-ul secretelor;
- coupling nedorit intre aplicatie si procesele AI.

### C. GitHub Actions ca proxy

Avantaje:
- audit nativ in Actions;
- potrivit pentru batch.

Dezavantaje:
- latenta si ergonomie slabe pentru operatii iterative;
- contract fin de tool dificil.

## Decizie

Se introduce un Cloudflare Worker dedicat, `ai-github-bridge`, separat de `command-api`.

MVP-ul expune numai operatii allowlisted pentru issues:

- `GET /health` - public, fara secrete;
- `GET /v1/issues/:number` - autentificat;
- `POST /v1/issues` - autentificat;
- `PATCH /v1/issues/:number` - autentificat.

Identitatea este aleasa prin credentialul bridge folosit:

- credential ChatGPT -> GitHub App ChatGPT;
- credential Claude -> GitHub App Claude.

Clientul nu trimite `actor` arbitrar ca sursa de autoritate. Actorul este derivat server-side din credentialul validat.

Repository-ul este fix in v1: `Shosetzel69/job-search-command-center`.

## Autentificare

MVP-ul foloseste bearer secrets separate:

- `CHATGPT_BRIDGE_TOKEN`;
- `CLAUDE_BRIDGE_TOKEN`.

GitHub App credentials sunt Worker secrets/config server-side:

- `CHATGPT_GITHUB_APP_ID`;
- `CHATGPT_GITHUB_INSTALLATION_ID`;
- `CHATGPT_GITHUB_PRIVATE_KEY`;
- `CLAUDE_GITHUB_APP_ID`;
- `CLAUDE_GITHUB_INSTALLATION_ID`;
- `CLAUDE_GITHUB_PRIVATE_KEY`.

Private keys, JWT-urile si installation tokens nu sunt returnate clientului si nu sunt logate.

## Politici

- niciun endpoint generic de proxy;
- repository fix, neparametrizabil in v1;
- operatiile administrative, secrets, collaborators, branch protection si deploy sunt excluse;
- write direct in `main` nu este relevant pentru MVP issues si ramane interzis la extinderea viitoare pe fisiere;
- merge/deploy PROD ramane in governance-ul existent si necesita owner GO;
- orice extindere spre files/branches/PR necesita contract explicit si teste dedicate.

## Consecinte

Pozitive:
- audit GitHub distinct pentru fiecare agent;
- credentials GitHub App raman server-side;
- componenta poate fi revocata independent de aplicatia principala;
- se poate extinde incremental fara a transforma Command API intr-un gateway de engineering.

Trade-off-uri:
- Worker si secrets suplimentare de administrat;
- bridge-ul are propriul lifecycle de deploy si monitoring;
- integrarea ChatGPT/Claude necesita configurarea unui plugin/tool care apeleaza bridge-ul.

## Riscuri

- compromiterea bearer token-ului unui agent permite operatiile allowlisted ale acelui actor pana la rotire;
- configurarea gresita a permisiunilor GitHub App poate genera 403 sau drepturi excesive;
- extinderea necontrolata a endpoint-urilor poate transforma bridge-ul intr-un proxy generic.

Mitigari:
- tokens separate si rotabile;
- allowlist hard-coded pentru repo si operatii;
- least-privilege GitHub App permissions;
- teste negative pentru auth si secret disclosure;
- fara logging de credentials.

## Impact asupra componentelor existente

- `command-api`: fara modificari functionale;
- frontend: fara modificari;
- search engine: fara modificari;
- GitHub Apps validate in #127: reutilizate ca identitati;
- `ARCHITECTURE.md`: adauga bridge-ul ca infrastructura de engineering/governance, nu ca runtime functional al aplicatiei.
