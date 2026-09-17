# Release Record Template

Use one record per candidate promoted toward PROD.

This record contains no secret values.

## 1. Release identity

- Release ID: `#####`
- Primary Issue: `#####`
- Related Issues: `#####`
- Pull Request: `#####`
- Change type: `feature / bugfix / hotfix / infrastructure / migration`
- Owner: `#####`

## 2. Candidate identity

- Development branch: `#####`
- Baseline `main` SHA before final DEV verification: `#####`
- `CANDIDATE_SHA`: `#####`
- Candidate freeze timestamp: `#####`
- Candidate changed after freeze: `NO`

Rule: if candidate changes after freeze, retire this record or mark it superseded and start a new promotion cycle.

## 3. Scope / acceptance

- Approved scope summary: `#####`
- Acceptance criteria reference: `#####`
- Architecture/ADR reference if applicable: `#####`
- Out-of-scope explicitly preserved: `#####`

## 4. DEV gate

- DEV deployment run / evidence: `#####`
- DEV `/health.source_sha`: `#####`
- Automated test result: `#####`
- Technical verification result: `PASS / FAIL`
- Known observations: `#####`
- DEV gate approved at: `#####`

Expected candidate identity:

```text
DEV source_sha == CANDIDATE_SHA
```

## 5. TEST gate

- TEST deployment run / evidence: `#####`
- TEST `/health.source_sha`: `#####`
- QA ticket/report: `#####`
- Independent tester: `#####`
- QA verdict: `PASS / PASS WITH OBSERVATION / FAIL / BLOCKED`
- Defects found: `#####`
- Unresolved blocker/major defects: `NONE / #####`
- TEST gate accepted at: `#####`

Expected candidate identity:

```text
TEST source_sha == DEV frozen CANDIDATE_SHA
```

If TEST fails, stop this promotion and return to DEV. Any fix produces a new SHA and invalidates this TEST result.

## 6. Integration gate

Complete only after TEST PASS.

- Merge method: `merge commit preserving candidate ancestry`
- Post-merge `main` SHA: `#####`
- `CANDIDATE_SHA` reachable from resulting `main`: `YES / NO`
- Merge conflict requiring candidate-content change: `NO`
- Candidate rewritten by squash/rebase: `NO`

Any `NO`/invalid state above is `NO-GO`; generate a new candidate and re-run DEV/TEST.

## 7. Schema / migration / configuration

- Application version: `#####`
- Schema/migration version: `N/A / #####`
- Database migration required: `NO / YES`
- Migration backward compatible: `N/A / YES / NO`
- Configuration changes: `NONE / #####`
- Secret names/scopes changed: `NO / YES - non-secret description only`
- Runtime-data contract change: `NO / YES - #####`

## 8. Known-good PROD anchors

Capture immediately before PROD mutation.

- PROD `SOURCE_SHA`: `#####`
- PROD `RUNTIME_DATA_SHA`: `#####`
- PROD environment/URL: `#####`
- PROD config/version anchor: `#####`
- PROD schema/migration version: `#####`
- Pre-deploy `/health` evidence: `#####`

## 9. Backup / recovery readiness

### Code rollback
- Previous known-good source can be redeployed: `YES / NO`
- Redeploy procedure reference: `#####`

### Configuration rollback
- Previous configuration reference captured: `YES / N/A / NO`
- Restore procedure: `#####`

### Database rollback / recovery
- Destructive or non-reversible DB change: `NO / YES`
- Backup file required: `NO / YES`
- Backup identifier/path: `#####`
- SHA-256 checksum: `#####`
- Checksum verified: `YES / N/A`
- Restore demonstrated in non-PROD: `YES / N/A / NO`
- Forward-fix strategy: `#####`

### Rollback trigger criteria

Rollback is executed when any applicable condition occurs:
- wrong candidate/source identity;
- startup/health failure;
- authentication/security regression;
- critical functional regression;
- migration/data-integrity failure;
- runtime publication/redeploy inconsistency;
- other release-specific trigger: `#####`.

## 10. PROD readiness gate

- TEST PASS evidence reviewed: `YES / NO`
- Candidate integrated without mutation: `YES / NO`
- PROD target explicit: `YES / NO`
- Rollback anchors complete: `YES / NO`
- Backup/restore gate satisfied where applicable: `YES / N/A / NO`
- No unresolved blocker/major defect: `YES / NO`
- No secret exposure required: `YES / NO`

Readiness verdict: `GO-CANDIDATE / NO-GO`

## 11. Owner authorization

- Explicit owner GO: `YES / NO`
- Authorization timestamp/reference: `#####`

No PROD deployment without explicit owner GO.

## 12. PROD deployment

- Requested `CANDIDATE_SHA`: `#####`
- PROD deploy run: `#####`
- Actual deployed `/health.source_sha`: `#####`
- Post-deploy `RUNTIME_DATA_SHA`: `#####`
- Deployment result: `PASS / FAIL`

Expected identity:

```text
PROD source_sha == TEST-passed CANDIDATE_SHA
```

## 13. PROD smoke / acceptance

- HTTPS/load: `PASS / FAIL`
- `/health` identity: `PASS / FAIL`
- authentication/security smoke: `PASS / FAIL / N/A`
- core functional smoke: `PASS / FAIL`
- migration/data sanity: `PASS / FAIL / N/A`
- environment isolation regression: `PASS / FAIL / N/A`
- monitoring/log check: `PASS / FAIL`
- additional release-specific checks: `#####`

Final PROD verdict: `PASS / PASS WITH OBSERVATION / FAIL`

## 14. Rollback execution if needed

- Rollback required: `NO / YES`
- Trigger: `#####`
- Rollback action executed: `#####`
- Restored source SHA: `#####`
- Restored runtime/config/schema anchors: `#####`
- Post-rollback health: `PASS / FAIL`
- Evidence: `#####`

## 15. Closeout

- Final release state: `ACCEPTED / ROLLED BACK / SUPERSEDED / ABORTED`
- Issue acceptance criteria complete: `YES / NO`
- Documentation aligned: `YES / NO`
- Follow-up defects/technical debt: `#####`
- Closeout timestamp: `#####`
