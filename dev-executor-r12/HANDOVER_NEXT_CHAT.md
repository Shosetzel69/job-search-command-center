# JSCC DEV Executor — Handover for next chat (2026-10-24)

## User requirement
Complete DEV Executor entirely in Google Cloud: Gateway performs authentication/authorization; runner performs checkout, isolated modifications, tests, evidence, Git commit/push, PR, authorized merge and DEV deployment. GitHub is repository/PR backend, not ChatGPT execution delegate. User requests no interruptions except material decisions; responses 3–4 lines.

## Verified GCP baseline (from Cloud Shell)
Project `jscc-dev`, region `europe-west1`.
Cloud Run services: `jscc-ops-gateway-dev` (revision `jscc-ops-gateway-dev-00008-8q4`, gateway image sha256:f3572d2d5d4e5696891dcd3941fc462f746afd5b22f02094a7f6b8e6a8b4ec7c), `jscc-command-api-dev`.
Jobs: `jscc-db-migrate-dev`, `jscc-diagnostics-dev`, `jscc-search-dev`.
Gateway SA `jscc-ops-gateway-dev@jscc-dev.iam.gserviceaccount.com`; current custom role `jsccOpsGatewayLroReaderDev` grants only `run.operations.get`. Deployer SA custom role reader also only `run.operations.get`. Gateway resource IAM includes `allUsers` `roles/run.invoker` but gateway OAuth protection is present in source.
Images reside in `europe-west1-docker.pkg.dev/jscc-shared/jscc-ops` and `.../jscc`.

## Repo / conector
`Shosetzel69/job-search-command-center` `main` last confirmed SHA `c827feca125f43c4477d5d559fd7d000827c7cde` (recheck before changes). ChatGPT Github connection identity `Shosetzel69` with Admin. Synthetic #567 merged with connector squash; DO NOT interact with #566 Nile. DEV connector has only `auth_check`, `run_operation`, `get_operation`; task allowlist: `describe_execution`, `read_execution_logs`, `inspect_runtime_snapshot`, `run_test_suite` (`dev-health` only). It cannot deploy/modify GCP.

## Current artifact
`jscc-dev-executor-r8-intermediate.zip` assembled from the verified on-disk R7 candidate. R8 source includes gateway ATC approval issuer, Cloud Run dispatch module and isolated Python runner. Admission signature/receipt added in R8, but gateway handler integration is NOT finished. No code deployed. No GitHub PR created for R8.

## Remaining implementation, in order
1. Fetch exact current `ops/src/gateway.mjs`, `ops/src/lib.mjs`, `ops/src/worker.mjs` and tests; implement real authenticated route and authenticated-actor binding to ATC approval. Integrate durable idempotency reservation via existing GCS primitives.
2. Implement immutable patch ingestion with GCS generation and digest binding; secure runner input and evidence redaction.
3. Finish GitHub checks/review-thread pagination and fail-closed merge authorization; verify GitHub auth via Secret Manager and SA separation.
4. Complete deployment target (service/job), image build, rollback and IAM manifests; ensure no arbitrary commands/privilege escalation.
5. Independent code/security review, unit/integration tests, GCP deployment (human Cloud Shell operator needed) and E2E.
Do not state implementation is complete or ready to install before 1–4, or tests PASS without running them.

## User constraints
No change to `main`, GCP infra, IAM, nor privileged merge without explicit scoped authorization; no Nile changes. User desires code finished before tests, and requests a release + handover on first stop.
