# Command API Build / Deployment Authority

Status: CURRENT
Scope: JSCC Command API only

## Purpose

Define the only authorized deployment path for the JSCC Command API after the GCP migration.

## Current rule

Cloudflare Workers Builds for the **JSCC Command API are retired** for DEV, TEST and PROD.

The following are **not authorized deployment paths** for the Command API:

- `wrangler deploy`;
- `wrangler versions upload`;
- Cloudflare Workers Builds;
- any legacy workflow or script that mutates a Command API Worker.

Local/CI Wrangler dry-run checks may still be used to validate build compatibility, provided they do not mutate a Cloudflare account.

## Canonical deployment authority

Command API deployment authority is:

```text
DEV / TEST
  -> cloudbuild.promotion.yaml
  -> scripts/gcp/promote.sh
  -> Google Cloud Run
```

Promotion uses an exact immutable Git SHA and verifies the deployed Cloud Run Service/Job and health evidence.

PROD Command API deployment to Cloudflare is prohibited. Until an approved GCP PROD promotion path exists, PROD deployment remains fail-closed.

## Explicit exclusion

`ai-github-bridge` is a separate engineering/governance component. Its Cloudflare deployment lifecycle is intentionally unchanged by #478.

Refs: #425 #478
