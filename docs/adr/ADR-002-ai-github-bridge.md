# ADR-002 - GitHub App bridge dedicat pentru identitati AI

Status: Accepted
Data: 2026-09-09
Refs: #127 #132 #128 #131 #136 #140 #143 #204

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
- operatiile administrative, secrets, collaborators, branch protection si deploy generic sunt excluse;
- exceptia de deployment dispatch introdusa prin #204 este retrasa prin #501; bridge-ul nu are authority de deployment;
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

## Addendum operational - 2026-09-10

Issue #136 a extins acelasi Worker cu Remote MCP stateless la `/mcp` pentru Claude Web, cu OAuth 2.1 si storage tehnic OAuth in Cloudflare KV `OAUTH_KV`.

Fluxul operational validat este:

`Claude Web -> OAuth 2.1 -> /mcp -> GitHub App Claude -> installation token -> GitHub API`

Tools MCP validate live:

- `read_file`;
- `get_issue`;
- `create_issue`;
- `update_issue`.

Identitatea downstream este hard-bound server-side la `jobsearch-claude-agent[bot]`.

Implementarea initiala a issue tools folosea un self-call intern MCP -> REST in acelasi Worker. Dupa eroarea live `Unexpected bridge error`, PR #140 a eliminat acel hop si a mutat issue tools pe apel direct GitHub App -> GitHub API, acelasi model de autentificare folosit de `read_file`.

Aceasta corectie nu schimba decizia ADR: boundary-ul ramane `AI client -> ai-github-bridge -> GitHub App -> GitHub API`.

Validarea live a fost finalizata cu issue #143, creat de `jobsearch-claude-agent[bot]`, apoi actualizat si inchis prin MCP. Titlul si label-urile au ramas neschimbate.

## Addendum release dispatch - 2026-09-18

Issue #204 extinde acelasi boundary cu o singura capabilitate Actions mutabila, strict allowlisted:

- REST: `POST /v1/actions/environment-deploy`;
- MCP Claude: `dispatch_environment_deploy`;
- workflow fix: `deploy-environment.yml`;
- ref fix: `main`;
- action fixa: `deploy`;
- medii permise: `dev|test`;
- PROD este respins inainte de GitHub API;
- DEV necesita `issue_pr`;
- TEST necesita `dev_evidence_run_id`;
- GitHub App necesita `Actions: Read and write`.

Aceasta extensie automatizeaza etapa DEV/TEST din #198 fara a autoriza PROD, owner GO sau workflow-uri arbitrare.

Remote MCP ChatGPT nu este activ in configuratia curenta. REST/OpenAPI poate expune aceeasi operatie actorului ChatGPT dupa configurarea integrarii bridge existente. Orice extindere a MCP spre ChatGPT sau spre files/branches/PR necesita change separat si actualizare de contract/documentatie.


## Addendum public-repository hardening - 2026-10-05

Issue #501 retrage capabilitatea Actions mutabila introdusa prin #204.

Decizia curenta este:

- `POST /v1/actions/environment-deploy` ramane numai ca raspuns fail-closed de compatibilitate si nu dispatch-uieste GitHub;
- tool-ul MCP `dispatch_environment_deploy` este eliminat;
- workflow-ul AI owner-comment nu mai accepta `/jscc-deploy`;
- bridge-ul pastreaza numai operatiile GitHub engineering/governance allowlisted;
- deployment-ul DEV/TEST/PROD nu este autorizat prin bridge si urmeaza control-plane-ul GCP aprobat.

Acest addendum supersedeaza operational sectiunea "Addendum release dispatch - 2026-09-18" fara a sterge istoricul deciziei #204.
