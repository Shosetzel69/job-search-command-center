# Claude Production E2E Runbook — historical pre-Phase-7 baseline

Status: HISTORICAL
Applicability: HISTORICAL_ONLY

> Retained only as Phase 7 / Cloudflare-era evidence. It is not an authorized current Command API deployment or QA procedure. Current deployment authority is `cloudbuild.promotion.yaml` and `docs/environment-provisioning-runbook.md`.

Status: **SUPERSEDED for current Phase 7 final QA**  
Original date: 2026-09-11

This document described the pre-migration production E2E flow against the legacy production origin:

`https://job-search-command-api.myeboda.workers.dev`

That origin is now the **LEGACY rollback reference only** during Phase 7 final validation. It is not the current dedicated PROD target.

## Current canonical QA contract

For the final validation of DEV / TEST / PROD after Phase 7 migration, use:

- GitHub issue **#188 — `[QA][Phase 7] Final validation DEV / TEST / PROD`**;
- `docs/testing/phase7-final-environment-qa.md`;
- `docs/environment-provisioning-runbook.md`;
- `docs/prod-cutover-rollback-runbook.md`.

Current dedicated PROD URL:

`https://job-search-command-api.job-search-prod.workers.dev`

Current DEV / TEST URLs:

- DEV: `https://job-search-command-api.job-search-dev.workers.dev`
- TEST: `https://job-search-command-api.job-search-test.workers.dev`

LEGACY remains read-only during #188:

`https://job-search-command-api.myeboda.workers.dev`

Do not use the historical execution order, historical production target, historical live-search authorization phrase, or historical ticket-close recommendations from the pre-Phase-7 procedure for #188.

## Historical purpose

The previous content in this file remains available in Git history and may be consulted only as historical evidence for Package 2A/legacy PROD testing (#126, #122, #96, #24). It is not an execution contract for Phase 7.
