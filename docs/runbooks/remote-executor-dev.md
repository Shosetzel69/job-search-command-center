# Remote Executor DEV runbook — #537

Status: implementation runbook for approved `ATC-537-01`.

## Scope

This runbook provisions and operates the DEV-only engineering control plane:

```text
ChatGPT custom MCP
  -> jscc-ops-gateway-dev
  -> fixed Cloud Run Job invocation
  -> jscc-diagnostics-dev
```

It does not provision or mutate TEST/PROD and does not add DB/Nile access.

The retired AV-537-01 Render endpoint is not used.

## Build boundary

Remote Executor images use the dedicated Artifact Registry repository:

`jscc-shared / europe-west1 / jscc-ops`

The ops images are built from an exact reviewed Git SHA by `cloudbuild.ops.yaml` using `jscc-ops-build@jscc-shared.iam.gserviceaccount.com`.

Cloud Build source staging for #537 uses the dedicated UBLA bucket `jscc-shared-ops-cloudbuild-source` with a 1-day lifecycle. The ops build identity has read access to that dedicated staging bucket only; the shared `jscc-shared_cloudbuild` bucket is not modified for #537.

The worker image contains only the Remote Executor implementation. It does not package the JSCC application candidate. `run_test_suite` verifies the already-deployed DEV application through a prepackaged, non-destructive suite.

Do not use the product `jscc-build` identity to publish `jscc-ops` images.

## Bootstrap inputs

The preferred one-shot bootstrap script is:

`scripts/gcp/bootstrap_remote_executor_dev.sh`

It builds the exact reviewed branch HEAD with the isolated ops build identity, resolves the existing DEV target facts, reuses the dedicated OAuth material from Secret Manager without interactive prompts, and then invokes the idempotent provisioning layer:

`scripts/gcp/provision_remote_executor_dev.sh`

Do not run the provisioning layer directly unless you intentionally supply all required immutable image/configuration inputs.

Required environment inputs:

- `GCP_RUNTIME_BUCKET` — existing DEV runtime bucket;
- `DEV_BASE_URL` — existing DEV application origin, HTTPS only;
- `GOOGLE_CLIENT_ID`;
- `GOOGLE_CLIENT_SECRET`;
- `GOOGLE_ALLOWED_SUB` — approved durable Google OIDC subject;
- `GATEWAY_IMAGE` — immutable `jscc-ops-gateway@sha256:...` reference;
- `WORKER_IMAGE` — immutable `jscc-diagnostics@sha256:...` reference;
- `SOURCE_SHA` — exact 40-character reviewed ops source SHA.

Never place secret values in GitHub comments, logs, command history intended as public evidence, or ChatGPT messages.

The bootstrap creates only the approved resources/identities from ATC-537-01. Bootstrap may run under the owner/provisioning identity because resource-scoped deployer bindings cannot exist before the two ops Cloud Run resources exist.

After bootstrap, routine deployments use only:

`scripts/gcp/deploy_remote_executor_dev.sh`

under impersonation of:

`jscc-ops-deployer-dev@jscc-dev.iam.gserviceaccount.com`

## OAuth callback cutover

Cloud Run can expose both deterministic and hash-based stable service URLs. For #537, use the exact URL returned by `gcloud run services describe jscc-ops-gateway-dev --format='value(status.url)'` and emitted by the bootstrap as `GATEWAY_URL`. Do not mix URL variants in the OAuth flow.

After the first gateway deployment:

1. Read the gateway URL from Cloud Run:
   `gcloud run services describe jscc-ops-gateway-dev --project=jscc-dev --region=europe-west1 --format='value(status.url)'`.
2. In Google Auth Platform, add exactly:
   `<gateway-url>/oauth/google/callback`
   as an authorized redirect URI for the DEV ops OAuth client.
3. Do not reuse the retired Render callback as the active target.
4. The **ChatGPT client callback** is a different URI and is pinned by the gateway to:
   `https://chatgpt.com/connector_platform_oauth_redirect`
   It is not the Google upstream callback and must not be replaced with the gateway URL.
5. Connect the private ChatGPT custom MCP to:
   `<gateway-url>/mcp`.

The gateway OAuth contract is Authorization Code + PKCE S256 using `@node-oauth/oauth2-server`, with Google OIDC verification delegated to `openid-client`, exact owner `sub`, scope `jscc.ops.dev`, audience `urn:jscc:ops:dev`, 15-minute opaque access token, no refresh token. Custom OAuth/OIDC cryptographic protocol code is prohibited.

## Verification

Before connecting ChatGPT, execute:

`scripts/gcp/verify_remote_executor_dev.sh`

The verifier resolves the existing DEV runtime bucket automatically.

The verification must PASS before live MCP validation. It checks, among other controls:

- exact gateway Job-run permission and absence of cancel/overrides;
- worker cannot execute Cloud Run Jobs;
- product and ops artifact lineages are disjoint;
- routine deployer is absent from product Cloud Run resources;
- worker cannot read OAuth auth state;
- gateway cannot read the product runtime bucket;
- dedicated log-view access;
- no worker project-level Secret Manager access;
- no DEV ops identities in TEST/PROD;
- retry/concurrency/retention invariants.

## Live acceptance order

Use this order so failures remain attributable:

1. gateway `/health`;
2. OAuth discovery;
3. ChatGPT custom MCP connection;
4. `auth_check`;
5. rejected unknown task / extra parameter / invalid target tests;
6. `describe_execution` against an allowlisted DEV execution;
7. `read_execution_logs` with bounded output;
8. `inspect_runtime_snapshot`;
9. `run_test_suite(dev-health, expected_source_sha)`;
10. idempotency and second-concurrent-operation tests;
11. exact execution-binding / stale-dispatch / generation-precondition tests;
12. sanitizer/public-evidence checks;
13. audit correlation;
14. full N1–N30 evidence matrix.

A Remote Executor operation never creates an AgentFlow PASS by itself.

## Trusted ops source admission

Ops images may be built only from:
- exact protected/reviewed `refs/heads/main`; or
- an owner-approved immutable tag matching `refs/tags/jscc-ops-approved/*`.

Every build must supply both the exact `SOURCE_SHA` and `TRUSTED_OPS_REF`. Cloud Build independently resolves the remote ref and rejects a SHA mismatch before tests/build/push. Feature-branch HEAD alone is never sufficient build authority.

Use `scripts/gcp/build_remote_executor_dev.sh`; direct ad-hoc `gcloud builds submit` without the trusted-ref substitution fails closed.

## Routine deployment

Routine deploy requires the same immutable image refs, ops source SHA, DEV runtime bucket and explicit `DEV_BASE_URL`.

The deployer can update only:
- `jscc-ops-gateway-dev`;
- `jscc-diagnostics-dev`.

It cannot update JSCC product services/jobs.

## Rollback

Rollback uses the previous known-good immutable gateway and worker digests through the routine deploy script. Do not rebuild an old version.

If auth, IAM, execution binding, sanitizer, target environment or image identity becomes ambiguous, fail closed and stop the ATC execution.

## Live bootstrap baseline validated 2026-10-11

The first complete DEV bootstrap passed on source SHA `76a964b346a43101350af5e8ac41942656856adb`.

Validated live evidence:
- Cloud Build `1f980840-276a-4ed4-b704-25ffd6d61849` — SUCCESS;
- gateway digest `sha256:d3b6411fe44ba0ae028ea8d6ba09f1179e19e6ee420b20a31eaec0cb541bc60f`;
- worker digest `sha256:3d30c540fb1fb68774303e3642761ae55d22b61d13ad7308f30a96de8ead654f`;
- `jscc-diagnostics-dev` deployed;
- `jscc-ops-gateway-dev` deployed;
- dedicated logging view IAM updated;
- routine deployer roles/bindings created;
- terminal result `REMOTE_EXECUTOR_BOOTSTRAP=PROVISIONED`.

This live result is the operational baseline for subsequent verifier and MCP acceptance evidence.

## Evidence

Evidence Bundle must record:
- exact Git SHA/PR;
- Cloud Build IDs and immutable gateway/worker digests;
- Cloud Run resource identities/config;
- IAM/isolation verification output;
- OAuth positive/negative tests;
- N1–N30 matrix;
- operation -> exact Cloud Run execution -> result correlation;
- sanitizer/public projection evidence;
- DEV functional acceptance.
