# Phase 6 — PROD Preparation Inventory

Status: preparation only; no cutover authorized  
Parent: #161  
Implementation: #175  
Baseline source commit: `33f224956c4169612c53b8f388db71a856efa784`

## Safety boundary

Phase 6 may inspect, validate and prepare the PROD target model. It must not deploy to the live PROD Worker, mutate live PROD runtime data, switch runtime repositories, rotate live credentials, or execute Full Search as part of preparation.

Phase 7 requires a separate explicit owner GO.

## Current PROD — legacy/live model

Repository evidence from `command-api/wrangler.jsonc`:

- Worker name: `job-search-command-api`
- live origin: `https://job-search-command-api.myeboda.workers.dev`
- `APP_ENV=prod`
- runtime repository: `Shosetzel69/job-search-command-center`
- runtime ref: `main`
- runtime workflow: `job-search-full.yml`
- `SEARCH_MODE=live`

This means current PROD still uses the source repository as both source-code repository and mutable runtime-data repository.

Current mutable PROD data is stored under `data/` in the source repository, including the canonical runtime contract files:

- `applications.json`
- `jobs.json`
- `nomenclatures.json`
- `run-history.json`
- `run-status.json`
- `search-config.json`
- `search-state.json`
- `source-categories.json`
- `sources.json`

Historical/test-only files that may also exist under source `data/` must not be blindly promoted into the standardized runtime repository. Migration scope is the canonical runtime-data contract only.

## Standardized PROD target

Canonical target from `config/environments.json`:

- runtime repository: `Shosetzel69/job-search-runtime-prod`
- runtime ref: `main`
- runtime workflow: `runtime.yml`
- Worker name: `job-search-command-api`
- search mode: `live`
- PROD-specific Cloudflare account/token variables
- PROD-specific GitHub runtime/source-read credentials
- PROD-specific OAuth configuration
- PROD-specific frontend origin

The target runtime repository must be private and must be distinct from source, DEV and TEST runtime repositories.

## Required migration

Migration is required because the current PROD runtime repository/workflow identity differs from the standardized target.

Phase 6 prepares the migration contract only. The actual copy/snapshot of PROD runtime data and Worker reconfiguration happen only during Phase 7 after separate owner approval.

## Backup/recovery preparation

Immediately before Phase 7 cutover, capture and record all of the following immutable anchors:

1. live `/health` response: `source_sha`, `runtime_data_sha` or legacy runtime identity, environment, search mode;
2. exact source repository commit containing the current canonical `data/` snapshot;
3. blob/SHA inventory for every canonical runtime-data file;
4. current Worker configuration: runtime owner/repo/ref/workflow, origin, search mode and non-secret vars;
5. current deployment/source SHA known to serve successfully;
6. current OAuth/client configuration identifiers and credential names, never secret values.

Recommended backup anchor: create an immutable Git tag or equivalent recorded commit reference for the source/data snapshot immediately before cutover. No business data is copied to DEV/TEST.

## Preconditions for future Phase 7

Before cutover can be authorized:

- independent G6 QA PASS;
- `job-search-runtime-prod` exists, is private and contains only the approved PROD runtime snapshot;
- PROD runtime/write credential can write only PROD runtime;
- PROD source-read credential is read-only against source;
- PROD Cloudflare credential cannot target DEV/TEST accounts;
- PROD OAuth/client/origin are explicit and verified;
- candidate source SHA has already passed DEV and TEST;
- rollback anchor and previous live Worker configuration are recorded;
- current PROD remains functional immediately before cutover.

## Known preparation constraint

The live PROD endpoint cannot be assumed to match current `main`, because `main` can advance independently while PROD remains on its last deployed source SHA. Therefore Phase 7 must re-probe live health immediately before any mutation and must not infer deployment identity from `main`.
