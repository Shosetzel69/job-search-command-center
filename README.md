# Job Search Command Center

Aplicatie pentru monitorizarea si evaluarea rolurilor de Project Management.

Versiune curenta: `0.06-dev`

## Obiectiv

- roluri PM / IT PM / Delivery / Service / Scrum / Program;
- Remote prioritar, apoi Hybrid/Onsite conform criteriilor;
- selectie geografica pe regiuni si tari canonice;
- B2B tinta 250-650 EUR/zi;
- FIT, riscuri, descriere, tara/tari si link de job;
- repostari marcate;
- full search manual controlat; scheduler separat planificat;
- istoric pentru ultimele rulari;
- registru de surse si nomenclatoare administrabile din UI.

## Flux de lucru

Fluxul de guvernanta este:

`Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> implementare`

Nu exista implementare directa din `Ideas / Requirements` sau `Analiza`.

Pentru modificari GitHub:

`Issue -> branch dedicat verificat -> modificare/teste -> PR -> merge -> deploy`

Nu se face write direct pe `main`. La actualizarea unui Issue existent, titlul si label-urile se pastreaza implicit daca owner-ul nu cere explicit altceva.

Regulile complete sunt definite in `GOVERNANCE.md`, `.ai-instructions.md` si `CONTRIBUTING.md`.

Pentru work `Process: AGENTFLOW`, contractul operational este `docs/agentflow.md`. AgentFlow controleaza analiza/ATC/executia/evidence/review si apoi preda rezultatul lifecycle-ului canonic DEV -> TEST -> PROD.

## Arhitectura MVP

Runtime functional:

`React + Tailwind + Vite -> Cloudflare Worker / Command API -> GitHub Actions -> motor cautare -> data/*.json -> main -> Cloudflare deploy`

Engineering/governance AI separat:

`AI client -> ai-github-bridge -> GitHub App dedicat -> GitHub API`

Repository privat. Fara GitHub Pages si fara baza de date activa pentru aplicatia functionala.

Documentul canonic de arhitectura este `ARCHITECTURE.md` din radacina repository-ului.

## AI GitHub Bridge

`ai-github-bridge` este un Cloudflare Worker separat de `command-api` si nu face parte din runtime-ul functional al aplicatiei.

Remote MCP Claude este operational si validat live:

`Claude Web -> OAuth 2.1 -> /mcp -> jobsearch-claude-agent[bot] -> GitHub API`

Tools curente:

- `read_file`;
- `get_issue`;
- `create_issue`;
- `update_issue`;
- `dispatch_environment_deploy` pentru workflow-ul canonic #198, numai DEV/TEST.

Issue #143 a validat live identitatea `jobsearch-claude-agent[bot]` pentru create/update/close. Remote MCP nu permite write pe files/branches/PR. #204 adauga numai dispatch-ul strict allowlisted al `deploy-environment.yml` pentru DEV/TEST; PROD ramane in afara acestui tool.

Detalii: `docs/ai-github-bridge.md`, `docs/adr/ADR-002-ai-github-bridge.md`.

## Search engine

Entry point: `scripts/job_search_runner.py`.

Pipeline:

`Collect -> Normalize -> Geo Eligibility -> Dedup/Repost -> Filter -> Score -> Publish`

Componente principale:

- `job_search.py` - model comun, geografie, filtrare, scoring;
- `source_orchestration.py` - plan/rutare/raportare surse;
- `job_identity.py` - identitate/deduplicare;
- connectorii dedicati `scripts/job_search_*.py`;
- `shared/source-connectors.json` - rutare comuna.

## JobsPipe

Transporturi suportate in cod: `disabled`, `apify`, `direct`.

Stare curenta canonica:

`jobspipe_mode = disabled`

JobsPipe nu este activat operational in Package 2.

## Functionalitati curente

- zona `Administrare` pentru surse, categorii, nomenclatoare si loguri;
- geografie canonica comuna React / Command API / Python;
- moduri de lucru `Remote/Hibrid/Onsite`;
- tipuri de contract canonice;
- Source Registry cu validare, aprobare si activare separate;
- polling robust pentru rularea manuala;
- publicare cu protectie la modificari concurente.

## Date si securitate

Protejate prin Cloudflare Worker:

- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `search-config.json`;
- `sources.json`;
- `source-categories.json`;
- `applications.json`;
- `nomenclatures.json`.

`search-state.json` ramane intern.

Secretele runtime si GitHub App nu se introduc in frontend, JSON publicabil sau documentatie.

## Documentatie

- `ARCHITECTURE.md` - arhitectura canonica;
- `GOVERNANCE.md` - reguli de guvernanta, branching si control;
- `docs/agentflow.md` - contract operational AgentFlow, gate-uri si handoff;
- `.ai-instructions.md` - guardrails si reguli de lucru pentru AI;
- `CONTRIBUTING.md` - mod de lucru;
- `docs/documentation-policy.md` - context minim, structura si limite pentru Issues/runbook-uri;
- `CHANGELOG.md` - istoric schimbari relevante;
- `docs/requirements.md` - cerinte;
- `docs/functionalitati.md` - comportament curent;
- `docs/command-api.md` - API si autentificare;
- `docs/data-contract.md` - contracte JSON;
- `docs/source-strategy.md` - surse si transporturi;
- `docs/ai-github-bridge.md` - bridge-ul AI GitHub si Remote MCP.

`docs/architecture.md` exista doar ca redirect documentar catre `ARCHITECTURE.md`.

## Rulare si CI

Workflow-ul greu `Full job search` este `workflow_dispatch` only. Nu are trigger `push` sau `schedule`.

CI valideaza Python, search logic, JSON, React/Vite, Command API si Cloudflare Worker dry-run. `ai-github-bridge` are workflow CI separat cu teste Node izolate si Wrangler dry-run.
