# Minimal Release Record

One short record per PROD promotion. No secret values.

The automation carries evidence through this artifact chain:

```text
promotion-dev-pass
  -> promotion-test-deployed
  -> promotion-test-pass
  -> release-record
```

## Required

- Issue / PR: `#####`
- `CANDIDATE_SHA`: `#####`
- DEV PASS evidence: `#####`
- TEST deployment evidence: `#####`
- TEST PASS evidence: `#####`
- Previous PROD `SOURCE_SHA`: `#####`
- Previous PROD `RUNTIME_DATA_SHA`: `#####`
- Rollback action/reference: `#####`
- Owner GO: `YES / NO` — reference/time: `#####`
- PROD deploy evidence: `#####`
- PROD `/health.source_sha`: `#####`
- PROD smoke verdict: `PASS / FAIL`
- Final state: `ACCEPTED / ROLLED BACK / ABORTED / SUPERSEDED`

Identity checks:

```text
DEV source_sha  == CANDIDATE_SHA
TEST source_sha == CANDIDATE_SHA
PROD source_sha == CANDIDATE_SHA
```

If candidate changes after DEV freeze, start a new promotion cycle.

## Conditional — complete only when applicable

### Configuration change

- Configuration rollback reference/action: `#####`

### Database / schema / data change

- Migration/schema version: `#####`
- Destructive or non-reversible: `YES / NO`

If `YES`:
- Backup identifier/path: `#####`
- SHA-256 checksum verified: `YES / NO`
- Restore demonstrated in non-PROD: `YES / NO`
- Recovery/forward-fix reference: `#####`

### Release-specific risk / exception

- Owner-accepted exception or reduced test scope: `N/A / #####`

## Rule

This record is deliberately minimal. Do not add routine administrative fields unless they materially improve release safety or traceability. Promotion artifacts contain identifiers and evidence only; secrets are never recorded.
