# JSCC #589 R3 — DEV GCloud operator, read-only delivery slice

**Status:** SOURCE ONLY / NOT DEPLOYED / no IAM changes / no Cloud Build submissions.

## Existing infrastructure reused

- Single Google OIDC user and single JSCC Gateway; the existing
  `run_operation` task catalog exposes read-only operations.
- Existing `jscc-diagnostics-dev` worker and inherited GCP service account.
- Cloud Run v2 service/revision APIs and Cloud Build GET for **preapproved
  build IDs**; no unrestricted GCloud shell or new provider.
- Remote Git stays exclusively in the standard GitHub connector.
- No new Google Cloud services, jobs, secrets, project roles, TEST or PROD.

## R3 functionality

### 1. `inspect_dev_rollout`

Input:
`{ "environment":"dev", "service":"<allowlisted DEV service>", "expected_image_digest":"sha256:<64 hex>" }`

Operation class: `OBSERVE`; authenticated Google user via existing
`jscc.ops.dev` OAuth; existing dispatch/source/digest/expiry guards.

It queries the **observed** Cloud Run v2 traffic through the reviewed
`createDevObserver` and compares every positively routed revision to the
expected immutable image digest. Results include:
- `IMAGE_MATCHED_100_PERCENT`, `SPLIT_TRAFFIC`,
  `DIFFERENT_IMAGE` or `IMAGE_NOT_PROVEN`;
- matched/other/unknown percent, active revision count, expected digest,
  timestamp and `source_provenance='UNVERIFIED'`.
- `traffic_cutover_authorized=false` **always**.

It rejects unknown/malformed/cross-project targets, inconsistent traffic,
duplicate serving revisions and invalid digest inputs. Revisions with
`percent=0` are excluded from the effective active count; mutable image
tags or missing container digests never count as proof.
R1's observed `LATEST` allocation resolver remains in place.

### 2. `describe_dev_build` immutable result evidence

Extends the existing known-ID build observation by projecting
`results.images[].name/digest` ONLY for the fixed
`europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/` registry with verified
immutable `sha256` digests. Result is `immutable_images_json` (bounded
4 KiB), retained in authenticated evidence only. No build substitutions,
source strings, secret env or logs are returned. Source identity is
deliberately `UNKNOWN` unless independently verified.

**Builds are NOT triggered by this operation.**

### 3. Catalog and rollout compatibility

Catalog changes from `589-r1b-v1` to `589-r3-v1`, so old gateway /
new worker mismatch must fail closed. Release requires paired, matching
immutable gateway+worker images, a drain of existing operations,
separate owner permission to deploy and a tested rollback to R33.

## Exact file scope

- `ops/observation/dev-rollout-evaluator.mjs` new pure evaluator
- `ops/observation/dev-runtime-observer.mjs` build-image projection
- `ops/src/{lib.mjs,worker.mjs}` typed catalog, dispatch & evidence
- `ops/Dockerfile.worker` bundled dependency
- `ops/test/r3-gcloud-rollout.test.mjs`, `ops/test/r3-gcloud-build-images.test.mjs`
- `ops/test/r1-b-existing-job.test.mjs` updated catalog assertion
- `.github/workflows/remote-executor-check.yml` JS syntax test

## Review and authorization gates

1. Independent EXACT-FILE review, including R1 #595 independent
   `REVIEW_FAIL` F1 HIGH from broad project-level IAM. Owner instructed
   leaving permissions unchanged, **not** security risk acceptance.
2. All Node, Python, security and Nile CI checks green on exact SHA.
3. Real redacted Cloud Run/Cloud Build fixtures and authenticated E2E are
   still required: static test fixtures alone are not enough.
4. Next mutating development (Cloud Build submit, Cloud Run deploy/traffic,
   rollback, GCS or Nile mutation) requires a reviewed dedicated execution
   policy and explicit owner approval for each target/action/scope. The
   current diagnostics worker must NOT become an arbitrary privileged shell.
5. Zero-incremental-cost proof still needs billing/quota evidence. Each
   new diagnostic invocation may consume billable Cloud Run resources.

**Not in R3:** triggering Cloud Build, mutable Cloud Run operations,
authorizing change requests, managed database access, extra Google users
or TEST/PROD operations.
