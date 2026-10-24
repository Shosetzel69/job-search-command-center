# JSCC DEV Executor — deployment contract (not authorization)

Target: jscc-dev / europe-west1. Existing OAuth gateway remains the only external entry point. The runner is a dedicated Cloud Run Job named `jscc-dev-executor` and not a public service. Retain TEST/PROD isolation.

## Required gates before running GCP mutation
1. Source integration into feature branch and independent source/security review of full diff.
2. Establish exact names of existing ops GCS bucket, gateway SA, runner SA, secrets, and current revision via read-only inventory. Do not infer these names from examples.
3. Provision two independent SAs: gateway can start only fixed executor job, read/write only approved ops-object prefixes; runner can read input/patches, create admission/evidence receipts and access only approved GitHub credentials. Assess IAM conditional binding viability with actual GCS bucket permissions; if prefix scope cannot be enforced, require a separate dedicated bucket, not a project-wide grant.
4. Secret Manager: distinct approval HMAC key, admission HMAC key, GitHub App installation credential/PAT subject to owner approval. No secrets in image, Git, logs, Cloud Run arguments, or evidence.
5. Pin runner image by digest, verify `github_gates.py` is in it, verify `gh`, `git`, node and Python runtime. Pin image base by digest and package versions for release reproducibility.
6. Create dedicated job with one task, no retries for mutable actions, one execution at a time, timeout policy and locked-down network/identity. Job requires `JSCC_DEV_INPUT_BUCKET` and `JSCC_DEV_ADMISSION_HMAC_KEY`; privileged actions also require `JSCC_DEV_APPROVAL_HMAC_KEY` and GitHub token. Each capability `JSCC_DEV_ENABLE_*` remains disabled until an independently authorized action.
7. Deploy gateway with `/executor/operations` disabled; run auth and negative-path smoke tests. Enable route only after review, then per-action gate rollout. Verify original MCP tools unchanged.
8. Verify -> implement -> publish -> authorized merge -> authorized DEV deployment, with per-action evidence and distinct approvals. Confirm rollback by restoring prior gateway revision and disabling job execution. Keep release and rollback evidence.

## Unresolved issues / strict STOP
- Runner currently runs `npm` suites without installing dependencies after checkout; fix using pinned lockfile and deterministic `npm ci` before claiming a passing test execution.
- Runner does not yet reliably resolve GitHub App credentials from Secret Manager; GH_TOKEN must be injected securely into the runner job.
- No actual cloud IAM inventory, deployment or end-to-end validation has occurred.
- No approval to mutate main, merge a PR, change IAM, bind secrets, or deploy GCP.
