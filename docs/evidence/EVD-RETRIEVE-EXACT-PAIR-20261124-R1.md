# EVD-RETRIEVE-EXACT-PAIR-20261124-R1 — DEV read-only identity verification

**Authority:** #520 (master Retrieve E2E); linked #521, #87, #530.  
**Evidence type:** read-only operational investigation, **not independent tester acceptance**.  
**No mutation:** no Retrieve dispatched, no Service/Job change, build, DB/config/schema/env/IAM operation, TEST or PROD work.  
**Observation time:** 2026-11-24 ~16:35–16:37 UTC (connector result timestamps).

## Evidence

| ID | Control | Exact evidence | Verdict |
|---|---|---|---|
| V-01 | Live DEV Service | Operation `op-mwux34ay-e3p6965emnw` / `describe_dev_runtime`: Service `jscc-command-api-dev` rev `jscc-command-api-dev-00116-dox`, 100% effective traffic, image `sha256:701d24ca2b463f08e3e2b0012c4ead9e16a12461cc517d27aa5f101711d29a67` | VERIFIED (Service only) |
| V-02 | Exact image traffic | Operation `op-mwux3n1j-zinywzja3ic` / `inspect_dev_rollout`, expected digest `sha256:701d24ca2b463f08e3e2b0012c4ead9e16a12461cc517d27aa5f101711d29a67` -> `IMAGE_MATCHED_100_PERCENT`, `other_percent=0`, `unknown_percent=0`. Its `source_provenance` is `UNVERIFIED` (not an independent build attestation). | VERIFIED image/traffic, NOT build provenance |
| V-03 | Running application SHA | Operation `op-mwux1l1a-tk4fd-z7hcu` / `run_test_suite` with `suite=dev-health`, `expected_source_sha=0c5ccc5d0cc15d775c963f42dc62572580051778` -> `test_verdict=PASS`, `target_source_sha=0c5ccc5d0cc15d775c963f42dc62572580051778`, `coarse_error=null`. | VERIFIED Service SHA /health |
| V-04 | Release record correlation | [#492 technical deploy evidence](https://github.com/Shosetzel69/job-search-command-center/issues/492#issuecomment-7136305032) associates GitDeploy run `45426683998` and Service revision `00116-dox`/same digest with commit `0c5ccc5d`. | CORRELATED (historical release evidence) |
| V-05 | Previous image mismatch | Operation `op-mwux2i20-6uk3rid-qlg` compared obsolete `00112-tiv` digest `sha256:74891e2c...` with the new serving image and returned `DIFFERENT_IMAGE`; V-01/V-02 establish this was a **superseded reference**, not a failed deployment. | RESOLVED reference mismatch |
| V-06 | Current source main | GitHub `main` now `d49c2dcdf1406d7c9a648e57e39fa1dadf0f356f` (merge #688), later than serving `0c5ccc5d`. The presence of this new commit does not establish its DEV deployment. | MAIN != observed Service SHA, normal pending release possibility |
| V-07 | Search Job effective image/SOURCE_SHA | **NOT OBSERVED.** Existing typed DEV connector catalogs `describe_dev_runtime` only for the allowlisted **Services**, not `jscc-search-dev` Job template; `run_test_suite` checks Service /health only. No current paired Job resource attestation from a permitted read-only execution. | BLOCKED |
| V-08 | End-to-end pair readiness | Cannot compare Service `source_sha` to current Job `SOURCE_SHA`, `JSCC_JOB_BUILD_SHA` or immutable Search Job digest. The existing [`scripts/gcp_source_snapshot.py`](https://github.com/Shosetzel69/job-search-command-center/blob/d49c2dcdf1406d7c9a648e57e39fa1dadf0f356f/scripts/gcp_source_snapshot.py) checks Job SOURCE_SHA == baked JSCC_JOB_BUILD_SHA and refuses mismatches before collector calls. | BLOCKED; conditional failure risk, not a demonstrated live mismatch |

## Important distinction

Earlier `dev-health` operations `op-mwuuwrzr-tq5zkmq6cj0` and `op-mwuuxapw-isbcaair-hu` returned `BLOCKED / source_sha_mismatch` when their expected SHA was stale. The correctly parameterized V-03 returned `PASS`. **Retract any conclusion that those earlier checks proved a wrong deployed Service SHA.**

The reference matrix in [EVD-RETRIEVE-E2E-20261124-R1](EVD-RETRIEVE-E2E-20261124-R1.md) remains a **code-and-historical-evidence** reconciliation; this follow-up verifies **only Service identity**. No D5-AC02 PASS, no D1–D4 current-pair functional acceptance, and no historical D6 operation are justified.

## Existing read-only paths and gap

1. **Already works:** the DEV typed connector `describe_dev_runtime`, `inspect_dev_rollout`, `run_test_suite` reliably verify the active **Service** image and application SHA.
2. **Available in repo but not executed here:** `.github/workflows/gov85-dev-paired-images.yml` has an `action=preflight` path that runs `gcloud run jobs describe jscc-search-dev` and the existing `control/scripts/gcp/gov85_sanitize_runtime_images.py` to emit redacted Service + Search Job image evidence. This workflow includes the existing WIF authentication and is pinned to an old candidate SHA; it must **not** be invoked outside its exact gate or interpreted as current-pair proof.
3. **Current limitation:** the connected typed DEV diagnostics interface cannot read Search Job template/source identity, and no existing successful exact-current-state read from the canonical Job was supplied. **Do not invent a source SHA or image digest or start a heavy Retrieve.**

## Required next control

Obtain an **authorized, purely read-only, redacted** observation of the canonical `jscc-search-dev` effective template (project `jscc-dev`, region `europe-west1`) with image digest and container `SOURCE_SHA` only, plus baked image identity `JSCC_JOB_BUILD_SHA` / provenance when available. Prefer reusing an **existing approved preflight operator**; no WIF or IAM change, no custom shell service, no unreviewed GCP workflow. Compare against active Service observation refreshed immediately before decision. Check for active executions/lock and applicable source policy. If Service and Search Job differ, **do not deploy or run Retrieve** until an authorized, reviewed, coordinated paired release plan exists.

**Final verdict: `SERVICE_IDENTITY_PASS / SEARCH_JOB_ATTESTATION_BLOCKED / EXACT_PAIR_NOT_VERIFIED`.** No independent acceptance or deployment PASS is claimed.
