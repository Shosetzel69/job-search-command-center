# JSCC DEV Executor — readiness gate, 2026-10-24

## Source baseline
- Base repository `main`: `c827feca125f43c4477d5d559fd7d000827c7cde` at last GitHub inspection.
- Integration branch: `test/github-connector-merge-e2e-r1`; R12 gateway route installed **OFF by default**, runner staged at `ops/dev-executor`.
- This is an engineering assessment, **not** an independent security review and **not** an authorization to deploy.

## Blocking findings, prioritized
1. **P0: deterministic npm install blocked** — `ops/package-lock.json` is missing from `main`, yet runner insists on it at the immutable checkout and runs `npm ci`. Adding a lockfile to the integration branch alone does not resolve execution against `main`. Lockfile must be generated with real npm registry integrity metadata, verified against exact `ops/package.json`, reviewed, and merged through separate scoped approval.
2. **P0: runtime capability gate not independently reviewed** — untested integration of OAuth actor → authorization record → ATC proof → HMAC admission → GCS consume → runner. No privileged actions may be enabled.
3. **P0: runtime infra not commissioned** — no verified dedicated Cloud Run Job, IAM isolation, secret bindings, GCS bucket policy, image digest, or rollback.
4. **P1: supply-chain drift** — runner image uses mutable `node:24-bookworm-slim` and unpinned APT `python3/git/gh`. Pin immutable base digest and dependencies before release build.
5. **P1: integrated tests missing** — historical 10 Python + 4 Node test results were obtained on R12 offline source, not the current integrated GitHub tree.
6. **P1: error/evidence hardening** — executor result currently records `str(e)`; require bounded redaction of all potentially credential-bearing process errors before live dispatch.

## Minimal sequence
A. Generate deterministic lockfile using a trusted npm registry in Cloud Shell or authorized CI; compare dependencies and scan.
B. Review source/integration and close findings. Merge lockfile into `main` only after explicit owner approval and independent review.
C. Read-only GCP inventory, then proposed exact IAM/secrets resources for a distinct infra approval.
D. Build locked image; stage Cloud Run job and disabled gateway. Execute isolated negative tests; then guarded verify-only E2E.
E. Independent scope approvals for each publish/merge/deploy action.

## Required owner decisions
- **Decision 1 (source change):** authorize a reviewed PR that adds *only* verified `ops/package-lock.json` to `main`. Until that change lands, no successful `verify` on exact `main` is possible.
- **Decision 2 (infrastructure; later):** approve exact reviewed DEV IAM, secrets and Cloud Run resource mutations. Not requested yet; inventory is pending.

Explicitly **NOT** granted: permission to merge the R12 executor, modify GCP/IAM, enable privileged API, or deploy.
