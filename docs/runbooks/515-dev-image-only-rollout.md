# #515 — DEV-only image-only rollout: owner-gated preparation

Status: **PREPARATION ONLY — NO DEPLOY AUTHORIZED**  
Owner authorization: `APPROVE_DEV_DEPLOY_PREPARATION_515`  
Target: `jscc-command-api-dev` in `jscc-dev/europe-west1`  
Accepted source: `567c4246f8c9621f2df727e066b9e95f4ed7d449` (squash merge of PR #614)  
Independent source review: [PR #614 R2 REVIEW_PASS](https://github.com/Shosetzel69/job-search-command-center/pull/614#issuecomment-6781151345) for `4eca9d6b469e6da0aabc06bbaf57891ebfa1d803`.

**This file is a proposed runbook for independent review, not an instruction to execute.**
Absolutely no build, push, deploy, configuration or database mutation is authorized by the runbook itself.

## 1. Exact scope and non-goals

Deploy only the **Cloud Run Service image** for the existing `jscc-command-api-dev` UI/API. Reuse the existing runtime service, identities and application/database configuration. Do **not** deploy Search Job images, create migration Jobs, change Nile schema/taxonomy, run Retrieve, rotate secrets, change permissions, update TEST/PROD, or merge PR #591.

DO NOT alter or invoke the frozen `cloudbuild.promotion.yaml` or `scripts/gcp/promote.sh`. Both have deliberate fail-closed `exit 86` guards. This runbook neither removes nor bypasses them by modifying their implementation. The separate image-only build recipe `cloudbuild.531.dev-service.yaml` already exists and explicitly does not deploy or migrate. The service update described below **requires an independent security/architecture review and a separate owner-approved execution gate** before use.

## 2. Verified baseline (read-only DEV observation, 2026-11-11 Europe/Bucharest)

Source: connected DEV Remote Executor `describe_dev_runtime` operation `op-mwbb3olq-ysoa-1wlonq` and `run_test_suite(dev-health)` operation `op-mwbb5k9m-swdfhglbduc`.

| Property | Observed |
|---|---|
| Service | `projects/jscc-dev/locations/europe-west1/services/jscc-command-api-dev` |
| Runtime service account | `jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com` |
| Active revision | `jscc-command-api-dev-00065-xam` |
| Traffic | 100% to the above revision |
| Active immutable image digest | `sha256:99dfec55d24d4abb01308a4358e7a8f5321a5374b36eaeb112647192bd1681a1` |
| Live `/health` source | `f4ab40cb1fcba4146cd4b474dc667002492e4a52` (PASS) |
| Environment variables | 20 configured (values intentionally not collected) |
| Target image digest | **NOT BUILT OR VERIFIED** |

The DEV remote observer intentionally reports `target_source_sha=UNKNOWN` from Cloud Run Admin API alone; the separate read-only authenticated health result is the source identity evidence.

**Before any execution**, repeat these observations and stop if the baseline changes. The rollback target is the **actual live** prior service revision, not merely a previously documented image digest.

## 3. Postmerge CI gate — verification outstanding

`main` after #614: `567c4246f8c9621f2df727e066b9e95f4ed7d449`. The original PR head `4eca9d6b469e6da0aabc06bbaf57891ebfa1d803` passed exact-SHA source/security review, 116/116 frontend tests, build, Nile-only CI, Cloud Run Admin API v2 guard and secret scanning.

A push to `main` that touches `frontend/**` should trigger `.github/workflows/command-api-check.yml`. **Postmerge CI must be checked for the new commit, not inferred from the PR**. The currently available connector lists only PR-triggered runs and therefore did not establish the push run. Before an execution approval, obtain actual push workflow run ID/logs from GitHub Actions, confirm successful head SHA `567c4246...`, frontend tests/build and all required security gates. No success assertion until verified.

Commands for an authorized observer's local `gh` session (read-only):

```bash
gh run list -R Shosetzel69/job-search-command-center --commit 567c4246f8c9621f2df727e066b9e95f4ed7d449 --limit 30
gh run view <ACTUAL_RUN_ID> -R Shosetzel69/job-search-command-center --json headSha,status,conclusion,workflowName,jobs
```

The placeholder is deliberate: do not invent a run ID or reuse the PR's run as postmerge evidence.

## 4. Image-only build route (not executed)

**Candidate:** existing `cloudbuild.531.dev-service.yaml` with `scripts/gcp/build_531_role_family_dev_service.sh`. The script requires a clean Git checkout at the exact candidate SHA and `gcloud` project `jscc-dev`; it submits to the `jscc-shared` build project using dedicated `jscc-build@jscc-shared.iam.gserviceaccount.com`. The recipe tests Python roles, Command API and frontend, then builds/publishes **only** `jscc-service:<SHA>`. It does not build Job images or update Cloud Run. Existing `Dockerfile.service` embeds an OCI source revision label and compiles the frontend into the service image.

Before authorizing image build, independently inspect its build provenance, clean checkout, immutable Artifact Registry tag policy, permissions, dependencies, secret exposure and image identity. Confirm that `jscc-service:<SHA>` does not already exist before publishing to an immutable-tag registry. The source archive and build must be byte-identical to the accepted main tree.

**Proposed** build command for a separately approved image-build operation — **do not run under preparation-only authorization**:

```bash
# On a clean checkout exactly at the accepted SHA; project context jscc-dev:
bash scripts/gcp/build_531_role_family_dev_service.sh \
  567c4246f8c9621f2df727e066b9e95f4ed7d449
```

Record Cloud Build ID, exact source SHA, build result, registry tag, immutable `sha256:<64hex>` digest and OCI source label. A successful build is **not** a deployment.

## 5. DEV-only rollout (BLOCKED — requires separate owner approval)

Before deployment:
1. Reobserve 100% serving revision, service account, existing digest and `/health` SHA. Stop on drift.
2. Verify the accepted new image digest, source label and actual build evidence for the **postmerge** SHA. Do not substitute a PR SHA, a mutable `:latest` tag, or a digest for a different code line.
3. Take a redacted configuration/traffic snapshot and retain rollback revision. Preserve all existing variables, secrets, IAM, networking, scaling and Nile connection settings; **no full environment replacement**.
4. Validate live Nile DB schema/readiness compatibility in read-only mode. `#515` is a frontend-only change, but the full image rebuilt from `main` differs from deployed `f4ab40cb` in other repository files; no schema migration is permitted. Do not rely on the #614 diff alone for global runtime compatibility.
5. Approve exact image digest and the single DEV target.

After separate owner approval, an operator may update the **existing** service to an **immutable image digest**, changing `SOURCE_SHA` and `RUNTIME_DATA_SHA` only if their required runtime contract has been independently verified. Do not carry out blind `--set-env-vars` replacement (which would erase existing values). Cloud Run Admin API programmatic integrations use **v2 only** per ADR-009; ordinary `gcloud` CLI commands remain governed by the same least-privilege/DEV-only principles.

**Illustrative proposed command, not executed:**

```bash
# Replace IMAGE_DIGEST only with the verified immutable new sha256 digest.
# Preflight and owner approval required. No migration or Search Job update.
gcloud run services update jscc-command-api-dev \
  --project=jscc-dev --region=europe-west1 \
  --image="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@IMAGE_DIGEST" \
  --update-env-vars="SOURCE_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449,RUNTIME_DATA_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449"
```

`RUNTIME_DATA_SHA` deserves **specific review**: the previous deployed service reports it as the old source SHA; changing it blindly may violate runtime data-snapshot semantics. The independent reviewer must determine whether to preserve the existing runtime-data identity instead. **Do not run the illustrative command until this is resolved.** Likewise, inspect effective traffic; do not assume creation of a revision implies 100% serving traffic.

## 6. Acceptance and rollback

**Postdeployment acceptance (read-only):** verify Cloud Run Admin API v2 Service/revision, exact image digest and observed 100% traffic; auth `/health.source_sha`, canonical DEV marker, unchanged service account/config, Nile readiness, no schema modifications, no unexpected errors. Independent live Browser E2E with existing populated jobs at CSS widths 375/390/768/1024/1280/1536 (25+ rows where available), real fonts and 125% zoom; test zero PUBLICAT/action overlap, ROL readability, action labels/tooltips, menu a11y, GUI-only filters and Details scroll restoration. Close overflow menus for scanner default-state protocol; do not trigger Retrieve, Review, Apply, Archive or account changes. Explicit `DEV_E2E_PASS` only after independent evidence.

**Rollback plan, owner-gated:** preserve `jscc-command-api-dev-00065-xam` as pre-deploy revision as long as its digest/traffic state still matches this preflight. If deployment fails or quality gate fails, prepare traffic rollback to the **last independently observed healthy revision** and restore the correct environment/source identity only through an explicitly approved remediation. Beware Cloud Run tag/traffic and `latest` differences; inspect actual revision traffic and avoid replacing runtime variables. Verify old image digest and `/health` again after rollback. Do not roll back TEST/PROD or perform DB/schema rollback.

## 7. Outstanding gates and final state

- [x] PR #614 merged; source review PASS; #515 reopened, PR #591 unchanged.
- [x] DEV live old runtime and old health SHA observed read-only.
- [x] Existing Service-only Cloud Build route identified.
- [ ] Postmerge main-push CI evidence independently retrieved (no run ID yet).
- [ ] New image digest / reproducible build provenance (image not built).
- [ ] Read-only Nile readiness + candidate/current runtime compatibility.
- [ ] Independent review of this runbook, image-only build and rollout contract.
- [ ] Owner decision authorizing exact DEV image build if needed, and separately **DEV rollout**.
- [ ] Live DEV browser E2E and #515 closure.

**STOP: preparation only, no deployment executed or authorized.**
