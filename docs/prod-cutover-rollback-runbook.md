# PROD Cutover and Rollback Runbook

Status: HISTORICAL
Applicability: HISTORICAL_ONLY

> Retained only as Phase 7 / Cloudflare-era evidence. It is not an authorized current Command API deployment or QA procedure. Current deployment authority is `cloudbuild.promotion.yaml` and `docs/environment-provisioning-runbook.md`.

Status: Phase 7-specific cutover/rollback record for the initial isolated PROD migration. It is not the generic release lifecycle for future changes.

Permanent delivery process: `docs/software-delivery-lifecycle.md`  
Permanent release/rollback checklist: `docs/release-record-template.md`  
Delivery governance: #197  
Automation alignment: #198

The remainder of this document preserves the Phase 7 migration/cutover procedure and evidence model. Future DEV -> TEST -> PROD releases must follow the permanent lifecycle above. LEGACY remains outside the normal promotion chain.

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

The Phase 7 final-QA/remediation history remains tracked in #188 and its linked defects. This historical runbook must not be reused as the default release process for subsequent changes.

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

Approved application source used by the Phase 7 cutover:

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

Initial PROD runtime head used by bootstrap/deploy:

```text
f552d5fb958c1559a65f420904b86cc403fd12aa
```

`56c76e...` is the initial migration commit containing the canonical PROD runtime data. `f552d5...` adds the isolated PROD runtime workflow while preserving the migrated data and was the `RUNTIME_DATA_SHA` served by the successful initial dedicated PROD deployment.

Successful Phase 7 bootstrap/deploy run:

```text
https://github.com/Shosetzel69/job-search-command-center/actions/runs/35247969324
```

The run completed with the environment/security/Phase-7 contract tests passing.

## 4. Initial dedicated PROD identity

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

This proves initial deployment/bootstrap health only. Subsequent releases must use their own release record and exact candidate identity.

## 5. Target architecture after migration

Production ownership moved from the legacy stack:

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

Permanent rule under #197:
- LEGACY is outside the DEV -> TEST -> PROD chain;
- no normal release is deployed to LEGACY;
- no normal QA or development occurs there;
- no configuration/data mutation is allowed through the normal lifecycle;
- retirement or repurposing requires a separate explicit decision.

## 9. Phase 7 final QA execution — historical ticket #188

The initial cutover QA was tracked under:

```text
#188 [QA][Phase 7] Final validation DEV / TEST / PROD
```

That QA contract and its linked defects are historical evidence for the initial migration/cutover. They are not the generic template for future releases.

For future releases, TEST validation and PROD acceptance use `docs/software-delivery-lifecycle.md` plus the release record template.

## 10. Post-PROD isolation regression

The Phase 7 procedure required re-checking DEV and TEST after PROD actions to prove no cross-environment mutation. This remains a valid permanent security principle where a PROD release can affect shared control-plane behavior.

Any unexpected DEV/TEST mutation remains a stop condition.

## 11. Stop conditions

Permanent stop conditions are defined in `docs/software-delivery-lifecycle.md`.

The Phase 7-specific stop conditions included:
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

For the initial Phase 7 cutover, primary rollback was operational return to the preserved legacy deployed endpoint.

Historical sequence:
1. stop further new-PROD actions;
2. direct operational use back to the legacy endpoint as applicable;
3. verify legacy application/health/auth sufficiently for rollback use;
4. confirm DEV/TEST unchanged;
5. preserve the dedicated PROD stack and all evidence for investigation;
6. do not delete or repurpose either stack;
7. remediate through a separate DEV task and repeat QA.

Rollback never copies DEV/TEST runtime data into PROD.

For future releases, rollback is release-specific and must be prepared before PROD using `docs/release-record-template.md`:
- previous known-good PROD source SHA;
- previous runtime/config/schema anchors;
- redeploy/restore procedure;
- validated backup/restore evidence for destructive/non-reversible DB changes.

LEGACY must not be assumed to be the permanent rollback mechanism after its future retirement.

## 13. Final acceptance

Phase 7 acceptance remains governed by #188/#186 as historical migration closeout.

Future release acceptance requires:
- exact candidate identity preserved DEV -> TEST -> PROD;
- independent TEST PASS;
- candidate integrated into `main` without rewrite;
- PROD rollback readiness;
- explicit owner GO;
- successful PROD deploy and smoke/acceptance;
- completed release record.

## 14. Observation and cleanup

Legacy cleanup is not part of the normal release process and requires a separate explicit decision.

Unrelated infrastructure, including `ai-github-bridge`, remains untouched by application release rollback unless separately affected and approved.

## 15. Evidence package

The Phase 7 closeout evidence remains in #186/#188 and related tickets.

Every future release uses its own release record, containing without secret values:
- Issue/PR;
- candidate SHA;
- DEV evidence;
- TEST evidence/verdict;
- post-integration `main` SHA;
- migration/config versions;
- known-good PROD anchors;
- rollback/backup evidence;
- owner GO;
- PROD deploy evidence;
- post-deploy health/smoke evidence;
- defects/observations;
- final acceptance state.
