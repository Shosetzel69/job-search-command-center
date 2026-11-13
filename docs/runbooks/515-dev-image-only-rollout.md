# #515 — DEV rollout preparation R2: source-paired Service + Search Job

**Status: PREPARATION ONLY — NO BUILD, MERGE OR DEPLOY AUTHORIZED**  
Owner authorization: `APPROVE_DEV_DEPLOY_PREPARATION_515`  
Target environment: `jscc-dev / europe-west1` only  
Exact accepted application source: `567c4246f8c9621f2df727e066b9e95f4ed7d449` (PR #614 squash merge)  
Independent PR #614 source review: [R2 REVIEW_PASS](https://github.com/Shosetzel69/job-search-command-center/pull/614#issuecomment-6781151345)  
Review of this runbook R1: [#615 F615-01/02 PREP_REVIEW_FAIL](https://github.com/Shosetzel69/job-search-command-center/pull/615#issuecomment-6782175627)

This is a *proposed* execution contract for independent review, **not** a command to build, deploy or change anything. The R1 **Service-only** design is **REJECTED** because it would break DEV Retrieve when the Service and Search Job have different immutable build SHAs. "Image-only" here means **container image updates only, with no migrations or runtime data mutations**, and requires a *source-paired* Service and Job. The owner has **not** authorized expansion to a paired Job build/update; this remains a separate explicit decision gate.

## 1. Source compatibility and immutable identity

The reviewed source delta is `f4ab40cb1fcba4146cd4b474dc667002492e4a52 → 567c4246f8c9621f2df727e066b9e95f4ed7d449`. Independent reviewer established that within the contents shipped by `Dockerfile.service`, the only product delta is `frontend/src/main.jsx` plus frontend test files not shipped in the final runtime image. API, Nile migrations, shared modules, Dockerfile.service and runtime data JSON are unchanged. No database schema migration is required or authorized.

**F615-02 CLOSED at runbook level — deterministic rule.** `Dockerfile.service` generates `BUILD_IDENTITY={sourceSha:GIT_SHA,runtimeDataSha:GIT_SHA}`. `command-api/src/environment-config.js::identitySha` **rejects** either `SOURCE_SHA` or `RUNTIME_DATA_SHA` if present and unequal to the embedded build identity. For an image built from `567c4246f8c9621f2df727e066b9e95f4ed7d449`, the new Service revision MUST use

```text
SOURCE_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449
RUNTIME_DATA_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449
org.opencontainers.image.revision=567c4246f8c9621f2df727e066b9e95f4ed7d449
```

Set the **two environment variables atomically in the same Cloud Run Service revision as the immutable image digest** using `--update-env-vars`; do not preserve `RUNTIME_DATA_SHA=f4ab40cb...`, do not use `--set-env-vars`, and do not update the SHA pair on the old image. An alternative that removes both overrides and relies on the baked identity needs its own independent review; it is **not** the selected R2 procedure. After rollout, verify **both** `/health.source_sha` **and** `/health.runtime_data_sha` exactly match `567c4246f8c9621f2df727e066b9e95f4ed7d449` together with the image OCI revision label.

## 2. Verified DEV baseline — read-only observations

DEV Remote Executor operations:
- `op-mwbb3olq-ysoa-1wlonq` (`describe_dev_runtime`, SUCCEEDED), `jscc-command-api-dev`: active revision `jscc-command-api-dev-00065-xam`, 100% traffic, image digest `sha256:99dfec55d24d4abb01308a4358e7a8f5321a5374b36eaeb112647192bd1681a1`, runtime identity `jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com`, **20** configured environment variables.
- `op-mwbb5k9m-swdfhglbduc` (`run_test_suite(dev-health)`, SUCCEEDED/PASS): old effective `/health.source_sha=f4ab40cb1fcba4146cd4b474dc667002492e4a52`.
- Independent reviewer read-only Console observation: Service `SOURCE_SHA` and `RUNTIME_DATA_SHA` both equal the old SHA; `APP_ENV=dev`, `SEARCH_MODE=disabled`, `JSCC_RUNTIME_BACKEND=gcp`, **`GCP_SEARCH_JOB=jscc-search-dev-stage-585`**, `NILE_DATABASE_URL` pinned to secret version 1; `ALLOWED_GOOGLE_SUB` and `GOOGLE_CLIENT_ID` configured at `latest`. `JSCC_DEPLOY_MARKER=585-canonical-origin-fix-20261029` is a legacy marker, **intentionally retained** unless a separate reviewed decision changes it.
- **Search Job effective digest, baked SHA and configuration are NOT YET VERIFIED.** Reviewer reports the last `jscc-search-dev-stage-585` execution on **2026-11-07** already failed. Record as **PRE-EXISTING FAILURE; current Retrieve health UNKNOWN**, not attributed to this rollout. Never claim Retrieve PASS without independent evidence.

Before any authorized change repeat live observations and stop on drift. Preserve the old active Service revision and old Job image **digest** as distinct rollback anchors.

## 3. F615-01 — mandatory Service ↔ Job identity coupling

`command-api/src/runtime-gcp.js::dispatchWorkflow` passes the serving Service's `SOURCE_SHA` to the Search Job override and executes `scripts/gcp_source_snapshot.py` in DEV under `-ceu` **before** the collector. `Dockerfile` bakes `JSCC_JOB_BUILD_SHA=${GIT_SHA}`. Snapshot startup raises if `SOURCE_SHA !== JSCC_JOB_BUILD_SHA`. This also applies to scheduled/admin runs; `SEARCH_MODE=disabled` **does not prevent all DEV Retrieve dispatches**. Therefore Service-only rollout from old SHA to `567c4246f8c9621f2df727e066b9e95f4ed7d449` while keeping an old Job image **would make all DEV Retrieve attempts fail**.

**Mandatory read-only preflight for Job:** inspect `jscc-search-dev-stage-585` (not an assumed `jscc-search-dev` alias), recording the immutable digest, OCI `org.opencontainers.image.revision`, baked `JSCC_JOB_BUILD_SHA`, configured image, effective job template/args/env/secret references/service account, retry/concurrency/scheduler settings, last execution status and any active executions. Do not disclose secret values. Read existing scheduled triggers and account for concurrent runs.

**Explicit owner choice — NOT YET APPROVED:**
- **A — RECOMMENDED (maintain Retrieve):** authorize a **paired DEV-only Job image build and update** from **the same exact SHA `567c4246f8c9621f2df727e066b9e95f4ed7d449`**, plus the Service image/update. The Job update, quiescence of Retrieve/schedules and restoration after rollout each need explicit owner approval. Record both image digests and both rollback targets. This is a scope expansion from preparation-only / Service-only to a source-paired **Service+Job image** rollout; **do not infer approval** from the earlier Service preparation authorization.
- **B — NOT RECOMMENDED (known outage):** owner explicitly accepts `DEV Retrieve UNAVAILABLE` until a future paired Job update, verifies **all** schedulers/dispatch sources cannot run and acknowledges the limitation in acceptance. Without verified suppression of scheduled/manual/admin triggering, **B must be rejected**. Never silently take option B.

**Selected technical recommendation: A; authorized execution option: NONE.** A separate written owner decision is required to choose A or B. Until then **hard STOP before builds, Job/Service updates or promotion**. No code, CI, Cloud Run, Cloudflare or database modification is authorized by this runbook.

**If A is subsequently approved and independently reviewed**, use a narrow DEV maintenance window: ensure no active execution and temporarily block new/manual/admin/scheduled Retrieve dispatch via an approved reversible mechanism; preserve active locks and do not delete runtime data to force a stop. Build and attest both exact-SHA immutable images first; update the Search Job image by digest while dispatch is quiesced; update the Service image plus its SHA pair **in one revision**; validate both effective identities and only then restore dispatch. A Job update **has no traffic split**; unlike the Service, restoring it requires an explicit digest update. If quiescence cannot be proven, abort. Avoid modifying any Job template setting except the image; document observed differences. No change to production jobs, database migrations or TEST/PROD.

## 4. Postmerge CI — verified PASS (F615-08)

The source commit on `main` is `567c4246f8c9621f2df727e066b9e95f4ed7d449`. Independent GitHub Actions review plus GitHub connector job inspection confirmed:
- [Validate Command API #42919456446](https://github.com/Shosetzel69/job-search-command-center/actions/runs/42919456446) — `validate=success`, `Nile-only native provider CI=success`; frontend **116/116 PASS**, zero failures/skips and successful frontend build.
- [Secret scanning #42919456537](https://github.com/Shosetzel69/job-search-command-center/actions/runs/42919456537) — `gitleaks=success`.
- [Cloud Run Admin API v2 contract #42919456522](https://github.com/Shosetzel69/job-search-command-center/actions/runs/42919456522) — `api-version-policy=success`.

These are **postmerge push runs for `567c4246f8c9621f2df727e066b9e95f4ed7d449`**, not PR-branch CI. Recheck the accepted SHA at release time and stop if `main` has moved.

## 5. Build provenance, registry immutability and config gates

**Service-only build recipe exists but is INSUFFICIENT for option A:** `cloudbuild.531.dev-service.yaml` and `scripts/gcp/build_531_role_family_dev_service.sh` can test/build `jscc-service:<SHA>` without deploying/migrating. This recipe is not a paired Job build. **A separately reviewed, exact-SHA Job-image build path is still required before approving option A execution**; do not invoke the deliberately frozen promotion pipeline to fabricate one. The current repo `Dockerfile` embeds `JSCC_JOB_BUILD_SHA=${GIT_SHA}`, and the finished Job image must be attested at exact SHA. No actual candidate image has been built or published by this preparation.

**Before any separately authorized build** verify:
1. Fresh, clean checkout at `567c4246f8c9621f2df727e066b9e95f4ed7d449` and read-only remote `refs/heads/main` identity (`git ls-remote origin refs/heads/main`). Reject moved main, dirty tree, missing source provenance; record Cloud Build IDs, base-image digests, OCI revision labels and immutable image digests. The existing 531 script submits local working tree; Cloud Build `COMMIT_SHA` may be unset. No lockfiles and mutable base-image tags mean byte-for-byte reproducibility is **not guaranteed**. Compare actual image contents/provenance, not only a tag.
2. Artifact Registry `jscc-shared / europe-west1 / jscc` has `dockerConfig.immutableTags=true`; no pre-existing `jscc-service:${source}` or Job image tag collision. If an image already exists, inspect and verify its digest/provenance instead of overwriting.
3. Current Service+Job *resolved* secret version references and non-sensitive env/config fingerprints, including `NILE_DATABASE_URL:1` and `ALLOWED_GOOGLE_SUB` / `GOOGLE_CLIENT_ID` resolved versions where the reference is `latest`. Re-creation must not silently drift authentication. Stop if a `latest` reference resolves to an unexpected version. Never print values.
4. Read-only Nile readiness and absence of schema delta, current tagged Service revisions/URLs, unchanged service account, traffic and network/scaling/secret settings. `FRONTEND_ORIGIN` retained, `JSCC_DEPLOY_MARKER` intentionally stale unless later separately decided; do not add tags or disturb existing tag routes.

**Frozen legacy controls stay frozen:** `cloudbuild.promotion.yaml` first-step `exit 86`, `scripts/gcp/promote.sh` `exit 86`, migration entrypoints and TEST/PROD pathways unchanged. `cloudbuild.service.yaml` and 531 recipe do not authorize production deployment.

## 6. Proposed execution stages — ALL BLOCKED WITHOUT NEW APPROVAL

1. **Gate S0 (owner)** select A (paired source-pinned images) or B (known Retrieve outage with all triggers disabled); require independent review of chosen contract and any new Job-image recipe. **Default FAIL-CLOSED.**
2. **Gate S1 (evidence)** repeat live Job and Service baselines, postmerge CI, exact source identity, registry/secret compatibility, no active execution, rollback targets.
3. **Gate S2 (build)** independent approval for building required immutable images. Only build after authorizing image build/push; this stage makes **no Cloud Run revision or Job update**. Record real digest for both images.
4. **Gate S3 (DEV rollout)** separate owner approval for exact Service and (if A) Job **digests** and target identities. Preserve all variables/config. Update the Job image only by immutable digest under quiescence. Proposed Service revision uses **both** mandatory environment identities in the **same** revision as the new immutable image:

```bash
# ILLUSTRATIVE ONLY — DO NOT EXECUTE; requires approved digest and S0-S3 gates.
gcloud run services update jscc-command-api-dev \
  --project=jscc-dev --region=europe-west1 \
  --image="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@<VERIFIED_SERVICE_SHA256_DIGEST>" \
  --update-env-vars="SOURCE_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449,RUNTIME_DATA_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449"
```

Do not substitute a floating tag, replace the entire env map, or alter Nile secret references. Use Cloud Run Admin API v2 in any JSCC-owned programmatic integration. Observe actual revision/traffic; do not assume `latest` means 100% of traffic.
5. **Gate S4 (read-only acceptance)** verify 100% intended DEV traffic, effective Service digest, exact Service OCI label and both health SHAs; for option A also verify the effective Job digest and baked `JSCC_JOB_BUILD_SHA=567c4246f8c9621f2df727e066b9e95f4ed7d449` before unblocking triggers. Confirm unchanged secrets, no unintended tag changes and read-only DB health. A narrowly scoped, **separately approved Retrieve smoke test** is required for end-to-end Retrieve acceptance; the prior failed execution means it must not be presumed healthy. Browser UX E2E uses existing 25 populated jobs at CSS widths 375/390/768/1024/1280/1536 and 125% zoom, real fonts, a11y and no overlapping/clipped controls. Do not initiate Retrieve/Apply/Archive/profile mutation during read-only UX testing.
6. **Gate S5 (rollback)** during quiescence, restore the prior Service revision's routing (which restores its revision-scoped old SHA pair) **and**, for option A, restore the prior Search Job **image by its old immutable digest**. Verify both matching old SHAs and old `/health` before resuming triggering; no TEST/PROD or DB rollback. Don't restore just one component while Retrieve is enabled. Keep existing tagged URLs and distinguish pre-existing Job execution failures from rollout-induced regressions.

## 7. Decision and status

| Gate | State |
|---|---|
| PR #614 merged, #515 OPEN, PR #591 untouched | VERIFIED |
| Actual old DEV Service/health and revision | VERIFIED |
| Postmerge CI `567c424` | VERIFIED PASS |
| Source Job SHA coupling (F615-01) | DOCUMENTED; **owner choice A/B outstanding** |
| Service identity pair (F615-02) | DOCUMENTED and fixed by contract |
| Registry immutability / secret-version drift | REQUIRED LIVE PREFLIGHT |
| Existing Search Job digest and build SHA | UNKNOWN — READ-ONLY CHECK REQUIRED |
| Paired Job-image recipe and independent review | REQUIRED FOR OPTION A |
| Candidate image(s), build provenance, digests | NOT BUILT / NOT VERIFIED |
| Live DEV image rollout / retrieval test | NOT AUTHORIZED / NOT RUN |
| New `#615` independent R2 review | PENDING |

**STOP before build, Job update, Service update, merge or deploy. The next owner decision concerns the necessary paired Job scope; it does not itself deploy anything.**
