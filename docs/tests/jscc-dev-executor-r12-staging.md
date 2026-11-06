# JSCC DEV Executor R12 — isolated staging

Branch: `test/github-connector-merge-e2e-r1` (reused by owner request).

Status: R12 archive is an **offline candidate**, not integrated into the operational gateway or runner. `main`, GCP, IAM and deployment are unchanged.

Next gates before deployment:
1. Verify R12 archive SHA-256 and exact contents, stage source under a dedicated prefix, compare with `ops/` entry points.
2. Generate `ops/package-lock.json` from the exact `ops/package.json` using an npm registry with verified integrity metadata; never synthesize a lockfile offline.
3. Complete fail-closed OAuth/ATC binding, immutable GCS patch binding, GitHub checks and review-thread pagination, runner isolation, and Secret Manager/IAM manifest.
4. Run independent source/security review and CI. Deployment needs separate authorization.

This document confers **no authorization** for merge, GCP mutation, or privileged execution.
