# PROD Cutover and Rollback Runbook

Status: Phase 7 canonical PROD data migration and dedicated PROD bootstrap/deploy completed successfully. Final independent QA is pending in #188; final owner acceptance and post-cutover cleanup are not yet complete.

Parent/orchestration: #186  
Preparation: #175  
Security gate: #177 / #183  
Final QA: #188

## 1. Current state

The Phase 7 authorization gate has already been satisfied and executed.

Completed:

1. G6 independent QA = PASS;
2. #177 security blockers closed;
3. owner gave explicit separate Phase 7 GO;
4. exact approved application source SHA recorded;
5. canonical PROD runtime data migrated into `Shosetzel69/job-search-prod`;
6. isolated PROD runtime workflow installed;
7. dedicated PROD Worker deployed successfully;
8. PROD Worker runtime secrets configured;
9. dedicated PROD `/health` identity converged successfully;
10. legacy deployed Worker remains available as rollback reference.

Pending:

1. independent final QA in #188;
2. one controlled PROD Full Search through the normal application path;
3. publication -> runtime SHA advance -> automatic PROD redeploy validation;
4. post-PROD DEV/TEST isolation regression;
5. read-only legacy rollback validation;
6. explicit final owner acceptance;
7. later observation/cleanup decisions.

## 2. Canonical endpoints

```text
DEV
https://job-search-command-api.job-search-dev.workers.dev

TEST
https://job-search-command-api.job-search-test.workers.dev

PROD dedicated target
https://job-search-command-api.job-search-prod.workers.dev

LEGACY rollback reference
https://job-search-command-api.myeboda.workers.dev
```

## 3. Immutable anchors

Approved application source:

```text
SOURCE_SHA=1ca1d16f0c2bb0529cf4a91283117a120dfc80fc
```

Trusted control-plane main used for successful Phase 7 execution:

```text
55ef89ddbbbb27ac1f23c7a66957fc3c5188ce53
```

Initial canonical PROD data migration commit:

```text
56c76e0724af629cb2fdfec19d444008574a5164
```

Current PROD runtime head used by bootstrap/deploy:

```text
f552d5fb958c1559a65f420904b86cc403fd12aa
```

`56c76e...` is the initial migration commit containing the canonical PROD runtime data. `f552d5...` adds the isolated PROD runtime workflow while preserving the migrated data and is therefore the `RUNTIME_DATA_SHA` served by the successful initial dedicated PROD deployment.

Successful Phase 7 bootstrap/deploy run:

```text
https://github.com/Shosetzel69/job-search-command-center/actions/runs/35247969324
```

The run completed with 58/58 environment/security/Phase-7 contract tests passing.

## 4. Current dedicated PROD identity

The successful Phase 7 run validated the dedicated target with:

```json
{
  "status": "ok",
  "environment": "prod",
  "source_sha": "1ca1d16f0c2bb0529cf4a91283117a120dfc80fc",
  "runtime_repo": "Shosetzel69/job-search-prod",
  "runtime_ref": "main",
  "runtime_data_sha": "f552d5fb958c1559a65f420904b86cc403fd12aa",
  "search_mode": "live",
  "auth_configured": true,
  "github_configured": true
}
```

This proves initial deployment/bootstrap health. It does not replace the final end-to-end Full Search validation required by #188.

## 5. Target architecture after migration

Production ownership is moving from the legacy stack:

```text
legacy Cloudflare account
+ legacy deployed Worker
+ legacy runtime/deployment path
```

into the isolated target:

```text
Job Search PROD Cloudflare account
+ Shosetzel69/job-search-prod/main
+ .github/workflows/runtime.yml
+ dedicated PROD OAuth/origin/credentials
```

Source code remains in:

```text
Shosetzel69/job-search-command-center
```

The approved application payload is immutable and separate from privileged trusted control-plane tooling.

## 6. Migration record

Only canonical runtime-data contract files were migrated into `job-search-prod`. No DEV/TEST operational data is promoted into PROD.

The initial migration commit is:

```text
56c76e0724af629cb2fdfec19d444008574a5164
```

The isolated runtime workflow was subsequently installed, producing:

```text
f552d5fb958c1559a65f420904b86cc403fd12aa
```

The successful bootstrap/deploy used that latter runtime head and built static assets from its `data/` snapshot.

## 7. Credential and Cloudflare isolation

The PROD GitHub roles remain separate:

- bootstrap/admin role;
- runtime role;
- source-read role;
- Cloudflare deploy credential.

G6 verified the PROD Cloudflare credential could access the dedicated PROD account and was denied against:

- DEV account;
- TEST account;
- legacy Cloudflare account.

Known account IDs used for isolation evidence:

```text
PROD target: 05c75e8c6f1e84e2c8b29b941598bd53
LEGACY:      1c10181de5c9d73957e1947f4411d55b
```

Credential segregation remains a permanent acceptance condition.

## 8. Legacy rollback state

Legacy endpoint:

```text
https://job-search-command-api.myeboda.workers.dev
```

The deployed legacy Worker was not deleted or repurposed. Its Cloudflare Git/build integration was disconnected during Phase 7 preparation to freeze the rollback baseline and prevent new source pushes from silently redeploying legacy.

Until final QA and owner acceptance:

- legacy is read-only;
- no deploy/config/data mutation is allowed;
- no legacy cleanup is allowed;
- no `[LEGACY]` UI marker is added, because that would intentionally mutate the rollback baseline;
- credentials/resources needed for rollback are retained.

The requested `[LEGACY]` marker is deferred until final acceptance or a separate explicit owner decision.

## 9. Final QA execution — canonical ticket #188

Claude executes the final QA under:

```text
#188 [QA][Phase 7] Final validation DEV / TEST / PROD
```

Claude must not modify source code, GitHub secrets/variables, Cloudflare settings, runtime configuration, or legacy resources during QA.

Execution order:

1. DEV;
2. TEST;
3. PROD;
4. DEV/TEST post-PROD regression;
5. legacy read-only rollback check.

### DEV expectations

- HTTPS/application load PASS;
- `/health.environment=dev`;
- runtime repo = `job-search-runtime-dev`;
- `SEARCH_MODE=disabled`;
- persistent `[DEV]` marker;
- auth/UI smoke PASS;
- Full Search blocked/fails closed;
- no mutation caused by PROD testing.

### TEST expectations

- HTTPS/application load PASS;
- `/health.environment=test`;
- runtime repo = `job-search-runtime-test`;
- `SEARCH_MODE=smoke`;
- persistent `[TEST]` marker;
- auth/UI smoke PASS;
- no live external collection/PROD-style publication;
- no mutation caused by PROD testing.

### PROD expectations before controlled Full Search

- `/health.environment=prod`;
- exact approved source SHA;
- runtime repo/ref = `Shosetzel69/job-search-prod` / `main`;
- current runtime head captured;
- `SEARCH_MODE=live`;
- auth/github configured;
- migrated configuration/application data readable;
- no non-production badge.

### Exactly one controlled PROD Full Search

Claude executes exactly one Full Search using the existing approved PROD configuration, without changing criteria immediately before the run.

Required evidence:

- start time;
- UI initiation screenshot/state;
- GitHub runtime workflow URL and run ID;
- workflow conclusion;
- source warnings/failures, if any;
- `job-search-prod/main` SHA before/after;
- generated result publication evidence;
- automatic PROD redeploy evidence;
- post-redeploy `/health`.

Expected successful convergence:

```text
source_sha remains 1ca1d16f0c2bb0529cf4a91283117a120dfc80fc
runtime_data_sha == new job-search-prod/main after publication
runtime_repo == Shosetzel69/job-search-prod
runtime_ref == main
search_mode == live
auth_configured == true
github_configured == true
```

Partial external-source failures may produce `PASS WITH OBSERVATION` only if the application contract tolerates them and a valid result/status snapshot is published and redeployed. Total collection failure, failed publication, or failed redeploy is FAIL.

## 10. Post-PROD isolation regression

After the controlled PROD Full Search:

- re-read DEV `/health` and `[DEV]` marker;
- re-read TEST `/health` and `[TEST]` marker;
- compare DEV/TEST runtime heads before/after;
- prove PROD execution changed only PROD runtime state where expected;
- verify no cross-environment data contamination.

Any unexpected DEV/TEST mutation is a stop condition and blocks final acceptance.

## 11. Stop conditions

Final acceptance must stop on:

- source/runtime identity mismatch;
- authentication regression;
- protected data/API exposure;
- invalid or missing runtime data;
- cross-environment credential access;
- total PROD collection failure;
- failed runtime publication;
- failed automatic PROD redeploy;
- stale static assets after successful runtime publication;
- unexpected DEV/TEST mutation;
- loss of legacy rollback availability;
- unapproved paid/quota behavior.

## 12. Rollback

Primary rollback remains operational return to the preserved legacy deployed endpoint.

Sequence if final validation exposes a blocker:

1. stop further new-PROD actions;
2. direct operational use back to the legacy endpoint as applicable;
3. verify legacy application/health/auth sufficiently for rollback use;
4. confirm DEV/TEST unchanged;
5. preserve the dedicated PROD stack and all evidence for investigation;
6. do not delete or repurpose either stack;
7. remediate through a separate DEV task and repeat QA.

Rollback never copies DEV/TEST runtime data into PROD.

## 13. Final acceptance

Final QA is accepted only when #188 records:

- DEV PASS;
- TEST PASS;
- PROD PASS or explicitly accepted PASS WITH OBSERVATION;
- successful controlled PROD Full Search publication/redeploy consistency;
- post-PROD isolation PASS;
- legacy rollback read-only PASS;
- no unresolved blocker/major defect.

After that, #186 may proceed to explicit owner final acceptance.

## 14. Observation and cleanup

Cleanup is not part of #188.

Only after final owner acceptance and a stable observation period may a separate explicit decision authorize some or all of:

- permanent retirement of obsolete legacy credentials;
- addition of a `[LEGACY]` marker if the legacy endpoint is retained for reference;
- further restriction/removal of legacy deployment mechanisms;
- archival/removal of the legacy stack;
- retention-period cleanup of rollback evidence.

Unrelated infrastructure, including `ai-github-bridge`, remains untouched.

## 15. Evidence package

Final Phase 7 closeout must include:

- approved source SHA;
- initial migration commit;
- current/final PROD runtime SHA;
- successful Phase 7 bootstrap/deploy run ID;
- pre/post controlled-search PROD `/health`;
- PROD runtime workflow run ID;
- GitHub credential-role segregation evidence;
- Cloudflare isolation evidence;
- auth/UI/protected-path smoke evidence;
- DEV/TEST post-PROD preservation evidence;
- legacy rollback read-only evidence;
- defects/observations;
- final owner acceptance timestamp.

No secret values are included in evidence.
