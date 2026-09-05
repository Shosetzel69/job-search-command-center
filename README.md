# Job Search Command Center

Aplicatie personala pentru monitorizarea si evaluarea rolurilor de Project Management.

Versiune curenta: `0.04`

## Obiectiv

- roluri PM / IT PM / Delivery / Service / Scrum / Program;
- Remote prioritar, apoi Hybrid;
- geografie prioritara RO / BE / LU si remote eligibil in Europa;
- B2B tinta 250-650 EUR/zi;
- FIT, riscuri, descriere si link de job;
- repostarile sunt marcate;
- rulare programata si manuala.

## Arhitectura MVP

`React + Tailwind + Vite -> Cloudflare Worker -> GitHub Actions -> motor cautare -> data/*.json -> main -> Cloudflare deploy`

Repository privat. Fara GitHub Pages si fara baza de date activa.

## Search engine

Entry point: `scripts/job_search_runner.py`.

Componente:

- `job_search.py` - normalizare, filtrare, scoring;
- `job_search_optimized.py` - JobsPipe Direct;
- `job_search_apify.py` - JobsPipe prin Apify;
- `job_search_runner.py` - selector transport si orchestrare.

Pipeline:

`Collect -> Normalize -> Validate -> Geo Eligibility -> Dedup/Repost -> Filter -> Score -> Publish`

## JobsPipe

Transporturi: `disabled`, `apify`, `direct`.

Stare curenta:

- `jobspipe_mode=apify`;
- `jobspipe_apify_max_items_per_run=100`;
- Apify foloseste Actorul oficial `jobspipe~jobspipe-job-search`;
- Direct ramane fallback cu preview, polling incremental, cursor, 14 credite/rulare si guard lunar 950.

## Date si securitate

Protejate prin Cloudflare Worker: `jobs.json`, `run-status.json`, `search-config.json`, `sources.json`, `applications.json`.

`search-state.json` ramane intern.

Secrete:

- `APIFY_TOKEN` si `JOBSPIPE_API_KEY` -> GitHub Actions Secrets;
- `GITHUB_TOKEN` -> Cloudflare Secret;
- `ALLOWED_GOOGLE_SUB` -> Cloudflare Secret;
- Google ID token -> numai memoria paginii.

## Documentatie

- `docs/requirements.md` - cerinte;
- `docs/functionalitati.md` - comportament curent;
- `docs/architecture.md` - arhitectura;
- `docs/command-api.md` - API si auth;
- `docs/data-contract.md` - contracte JSON;
- `docs/source-strategy.md` - surse si transporturi.

## Rulare

Workflow-ul `Full job search` ruleaza la 06:00 si 15:00 UTC si poate fi pornit manual din UI.
