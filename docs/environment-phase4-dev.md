# Phase 4 — Isolated DEV runtime

Status: implementation in progress under #169 / PR #170.

This document records the **implemented Phase 4 delta** on top of ADR-003 and `docs/environment-provisioning-runbook.md`. It does not authorize TEST or PROD provisioning.

## Scope

Phase 4 enables real provisioning/deployment for **DEV only** through the single parameterized environment tool introduced in Phase 3.

Live TEST and PROD operations remain structurally blocked. `bootstrap-all` and development `isolation-test` remain non-mutating.

## DEV target

- source repository: `Shosetzel69/job-search-command-center`;
- runtime repository: `Shosetzel69/job-search-runtime-dev` (private);
- Cloudflare boundary: dedicated DEV account;
- Worker: `job-search-command-api` inside the DEV account;
- search mode: `disabled`;
- source identity: immutable 40-character `SOURCE_SHA`;
- runtime identity: independent `RUNTIME_DATA_SHA` from the DEV runtime repository.

No PROD jobs, applications, run history or search state are copied into DEV. Bootstrap uses an isolated empty seed that conforms to the canonical runtime-data contract.

## Build separation

`command-api/scripts/build-static.mjs` accepts `RUNTIME_DATA_DIR`.

For isolated DEV builds:

1. source code is the exact `SOURCE_SHA` checkout;
2. runtime data are obtained from `job-search-runtime-dev`;
3. `RUNTIME_DATA_SHA` is mandatory;
4. the frontend/Worker static protected data are assembled from that runtime snapshot;
5. `/health` must expose the same source/runtime identities.

The current PROD transition remains unchanged until Phase 6/7.

## Live gate

Phase 4 permits live `bootstrap`, `deploy` and `status` only when `--env dev` is explicit.

Examples:

```text
npm run env:bootstrap -- --env dev --source-sha <full-sha>
npm run env:deploy -- --env dev --source-sha <full-sha>
npm run env:status -- --env dev --source-sha <full-sha>
```

Live TEST/PROD fails before provider mutation. Dry-run remains available for all environments.

## Source-repository configuration required for live bootstrap

Configure these values in GitHub before running the live DEV workflow. Secret values must never be copied into issues, PRs, commits or chat transcripts.

### Variables

```text
DEV_CLOUDFLARE_ACCOUNT_ID
DEV_GOOGLE_CLIENT_ID
DEV_FRONTEND_ORIGIN
```

### Secrets

```text
DEV_CLOUDFLARE_TOKEN
DEV_GITHUB_RUNTIME_TOKEN
DEV_SOURCE_READ_TOKEN
DEV_ALLOWED_GOOGLE_SUB
BOOTSTRAP_GITHUB_TOKEN
```

Credential constraints:

- `DEV_CLOUDFLARE_TOKEN` is scoped to the dedicated DEV Cloudflare account only;
- `DEV_GITHUB_RUNTIME_TOKEN` may write only the DEV runtime repository and must not have source write access;
- `DEV_SOURCE_READ_TOKEN` is read-only to the source repository; PAT classic is not accepted by the architecture;
- `BOOTSTRAP_GITHUB_TOKEN` is a temporary provisioning credential and must be rotated/revoked when no longer needed;
- Google/OAuth configuration is DEV-specific where provider isolation requires it.

## Runtime repository bootstrap

The generic provisioner:

1. verifies or creates the private DEV runtime repository;
2. initializes missing canonical `data/*` files with isolated DEV seed content;
3. installs/synchronizes `.github/workflows/runtime.yml` from the source template;
4. sets non-secret runtime variables;
5. deploys the Command API from the exact source SHA against the DEV runtime snapshot;
6. validates `/health` identity.

Existing runtime data files are not overwritten implicitly by bootstrap.

## DEV runtime workflow

The runtime wrapper contains no duplicated search business logic. It validates immutable source identity and the environment policy.

In Phase 4, `SEARCH_MODE=disabled` causes execution to stop before Full Search. Search execution is therefore not enabled simply by provisioning DEV.

## Readiness check

A live DEV `status` is PASS only when `/health` confirms:

- `environment=dev`;
- expected `source_sha`;
- `runtime_repo=Shosetzel69/job-search-runtime-dev`;
- a valid independent `runtime_data_sha`;
- `search_mode=disabled`;
- `auth_configured=true`;
- `github_configured=true`.

## Independent G4 QA

Development does **not** self-certify cross-provider isolation. Claude performs independent G4 QA after development is complete.

G4 must prove, with safe/non-destructive probes, that:

- DEV GitHub write credentials cannot modify TEST or PROD runtime repositories;
- DEV Cloudflare credentials cannot manage TEST/PROD accounts/resources;
- cross-environment target/config mismatches fail closed;
- Full Search remains disabled in DEV;
- PROD state is unchanged;
- authentication, protected DEV data and a reversible DEV persistence smoke work correctly.

Phase 5 / TEST remains blocked until G4 PASS and a separate owner GO.
