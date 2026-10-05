# Environment Provisioning Runbook - Command API

Status: CURRENT  
Applicability: DEV / TEST / PROD Command API  
Canonical deployment authority: `cloudbuild.promotion.yaml`

## Purpose

Define the current operational deployment boundary for the JSCC Command API after migration from Cloudflare to Google Cloud.

Historical Cloudflare provisioning/cutover procedures are available only through Git history and are non-authoritative.

## Preconditions

- exact immutable source SHA is known;
- required CI/review gates for that candidate are complete;
- target environment is explicit;
- no deployment is attempted through a Cloudflare Worker path;
- `ai-github-bridge` is treated separately and remains outside this runbook.

## Current architecture

```text
Command API DEV
  -> cloudbuild.promotion.yaml
  -> Cloud Run service jscc-command-api-dev

Command API TEST
  -> cloudbuild.promotion.yaml
  -> Cloud Run service jscc-command-api-test

Command API PROD
  -> Cloudflare deployment prohibited
  -> blocked until an approved GCP PROD promotion path exists

ai-github-bridge
  -> Cloudflare
  -> intentionally unchanged
```

The browser, API and frontend for a migrated environment use the corresponding Cloud Run origin. Runtime data and database bindings remain environment-specific.

## Deployment authority

For DEV and TEST, promotion is performed only through `cloudbuild.promotion.yaml`.

The promotion pipeline:

1. receives the exact Git SHA;
2. resolves/promotes immutable Service and Job artifacts;
3. provisions/verifies runtime seed;
4. deploys and executes the environment DB migration Job from the exact candidate Service digest;
5. verifies candidate migration versions/checksums, required schema and DB privilege readiness;
6. deploys the target Cloud Run application Job/Service;
7. verifies IAM, traffic, `/health`, `/health/db` and auth readiness;
8. emits promotion evidence and a terminal machine-readable checklist tied to the exact candidate.

Repository-controlled Cloudflare Command API mutation paths are fail-closed.

The following are forbidden for Command API DEV/TEST/PROD:

- `wrangler deploy`;
- `wrangler versions upload`;
- Cloudflare Workers Builds;
- legacy `env:bootstrap` / `env:deploy` mutation;
- legacy PROD Worker redeploy/cutover mutation.

## Steps

### DEV

Use the canonical Cloud Build promotion with target `dev` and the exact reviewed/approved SHA.

After promotion, validate the Cloud Run DEV origin and confirm `/health.source_sha` equals the candidate SHA.

### TEST

Promote the exact DEV-accepted candidate through the same GCP promotion contract with target `test`.

TEST must not rebuild or substitute another source identity.

### PROD

Do not deploy the Command API to Cloudflare.

Until GCP PROD promotion is explicitly implemented and approved, the deployment step is fail-closed. Existing verification-only legacy controls do not grant deployment authority.

## Verification

For every supported GCP promotion verify at minimum:

- Cloud Build/promotion result is PASS;
- target Cloud Run Service is the intended environment;
- `/health.status == ok`;
- `/health.environment` matches the target;
- `/health.source_sha` equals the requested immutable candidate;
- `/health/db` reports the expected environment database;
- candidate DB migration/schema readiness is PASS;
- `promotion-status.json` is terminal PASS with no incomplete step;
- functional acceptance required by `docs/software-delivery-lifecycle.md` is completed.

A successful legacy Cloudflare request is not evidence for the migrated Command API environment.

## Provider retirement

After repository retirement controls are merged:

- remove Command API `CLOUDFLARE_TOKEN` secrets from GitHub Environments DEV/TEST/PROD;
- disable/disconnect Cloudflare Workers Builds for the Command API;
- do not remove or alter `ai-github-bridge` Cloudflare configuration as part of this retirement.

## Rollback

DEV/TEST rollback uses the GCP/Cloud Run artifact and revision model defined by the active GCP promotion contract.

Cloudflare is not an authorized Command API rollback target.

PROD rollback/deployment remains blocked until the approved GCP PROD procedure defines its immutable rollback anchors and owner gate.

## Executable checklist

The complete ordered component plan is `docs/testing/gcp-promotion-checklist.md`. The UI-visible runtime checklist is updated by the same promotion path and is ADMIN-only. `/health/db` alone is never DB release readiness.

## Historical reference

Cloudflare-era Phase 7 operational evidence is intentionally excluded from the current source tree; historical copies remain reachable through existing Git history.

Refs: #198 #425 #478
