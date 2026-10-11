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

It builds the exact reviewed branch HEAD with the isolated ops build identity, resolves the existing DEV target facts, prompts only for missing OAuth bootstrap values, and then invokes the idempotent provisioning layer:

`scripts/gcp/provision_remote_executor_dev.sh`

Do not run the provisioning layer directly unless you intentionally supply all required immutable image/configuration inputs.

Required environment inputs:

- `GCP_RUNTIME_BUCKET` — existing DEV runtime bucket;
- `DEV_BASE_URL` — existing DEV application origin, HTTPS only;
- `GOOGLE_CLIENT_ID`;
- `GOOGLE_CLIENT_SECRET`;
- `GOOGLE_ALLOWED_SUB` — approved durable Google OIDC subject;
- `OAUTH_CLIENT_SIGNING_KEY` — random high-entropy server-side signing key;
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

The gateway OAuth contract is Authorization Code + PKCE S256, Google OIDC, exact owner `sub`, scope `jscc.ops.dev`, audience `urn:jscc:ops:dev`, 15-minute opaque access token, no refresh token.

## Verification

Before connecting ChatGPT, execute:

`GCP_RUNTIME_BUCKET=<dev-runtime-bucket> scripts/gcp/verify_remote_executor_dev.sh`

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

## Routine deployment

Routine deploy requires the same immutable image refs, ops source SHA, DEV runtime bucket and explicit `DEV_BASE_URL`.

The deployer can update only:
- `jscc-ops-gateway-dev`;
- `jscc-diagnostics-dev`.

It cannot update JSCC product services/jobs.

## Rollback

Rollback uses the previous known-good immutable gateway and worker digests through the routine deploy script. Do not rebuild an old version.

If auth, IAM, execution binding, sanitizer, target environment or image identity becomes ambiguous, fail closed and stop the ATC execution.

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
