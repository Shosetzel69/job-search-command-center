# Job Search Command Center

Aplicatie pentru monitorizarea si evaluarea rolurilor de Project Management.

Versiune curenta: `0.05`

## Obiectiv

- roluri PM / IT PM / Delivery / Service / Scrum / Program;
- Remote prioritar, apoi Hybrid;
- selectie geografica pe regiuni si tari;
- B2B tinta 250-650 EUR/zi;
- FIT, riscuri, descriere, tara/tari si link de job;
- repostari marcate;
- rulare programata si manuala;
- istoric pentru ultimele 10 rulari;
- registru de surse administrabil din UI.

## Flux de lucru

Fluxul de guvernanta este:

`Ideas / Requirements -> Analiza -> cerinta/decizie aprobata explicit -> Development -> implementare`

Nu exista implementare directa din `Ideas / Requirements` sau `Analiza`.

Regulile complete sunt definite in `GOVERNANCE.md`.

## Arhitectura MVP

`React + Tailwind + Vite -> Cloudflare Worker -> GitHub Actions -> motor cautare -> data/*.json -> main -> Cloudflare deploy`

Repository privat. Fara GitHub Pages si fara baza de date activa.

Documentul canonic de arhitectura este `ARCHITECTURE.md` din radacina repository-ului.

## Search engine

Entry point: `scripts/job_search_runner.py`.

Pipeline:

`Collect -> Normalize -> Geo Eligibility -> Dedup/Repost -> Filter -> Score -> Publish`

Componente principale:

- `job_search.py` - normalizare, geografie, filtrare, scoring;
- `job_search_optimized.py` - JobsPipe Direct;
- `job_search_apify.py` - JobsPipe prin Apify;
- `job_search_runner.py` - selector transport, orchestrare si run history;
- `test_search_logic.py` - teste de regresie.

## JobsPipe

Transporturi: `disabled`, `apify`, `direct`.

Stare curenta:

- `jobspipe_mode=apify`;
- `jobspipe_apify_max_items_per_run=100`;
- Apify foloseste Actorul oficial `jobspipe~jobspipe-job-search`;
- Direct ramane fallback;
- JobsPipe este o singura sursa operationala, indiferent de transport.

## Functionalitati 0.05

- KPI-uri interactive ca filtre rapide;
- tara in liste si toate tarile in detalii;
- criterii `EU`, `US`, `Asia` + tari individuale;
- excluderi teritoriale;
- numar surse procesate in status;
- pagina `Loguri`, maximum 10 rulari;
- CRUD persistent pentru Surse;
- publicare cu retry daca `main` se modifica concurent.

## Date si securitate

Protejate prin Cloudflare Worker:

- `jobs.json`;
- `run-status.json`;
- `run-history.json`;
- `search-config.json`;
- `sources.json`;
- `applications.json`.

`search-state.json` ramane intern.

Secrete:

- `APIFY_TOKEN` si `JOBSPIPE_API_KEY` -> GitHub Actions Secrets;
- `GITHUB_TOKEN` -> Cloudflare Secret;
- `ALLOWED_GOOGLE_SUB` -> Cloudflare Secret;
- Google ID token -> numai memoria paginii.

## Documentatie

- `ARCHITECTURE.md` - arhitectura canonica;
- `GOVERNANCE.md` - reguli de guvernanta si flux de maturizare a cerintelor;
- `.ai-instructions.md` - guardrails si reguli de lucru pentru AI;
- `CONTRIBUTING.md` - mod de lucru;
- `CHANGELOG.md` - istoric schimbari relevante;
- `docs/requirements.md` - cerinte;
- `docs/functionalitati.md` - comportament curent;
- `docs/command-api.md` - API si autentificare;
- `docs/data-contract.md` - contracte JSON;
- `docs/source-strategy.md` - surse si transporturi.

`docs/architecture.md` exista doar ca redirect documentar catre `ARCHITECTURE.md`.

## Rulare

Workflow-ul `Full job search` ruleaza la 06:00 si 15:00 UTC si poate fi pornit manual din UI.

CI valideaza Python, teste search logic, JSON, React/Vite si Cloudflare Worker dry-run.
