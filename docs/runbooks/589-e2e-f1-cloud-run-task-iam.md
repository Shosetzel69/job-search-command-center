# JSCC #589 — E2E F1: Cloud Run Tasks IAM resolution (DEV only)

**Source context:** [E2E_ACCEPTANCE_FAIL #6666789474](https://github.com/Shosetzel69/job-search-command-center/issues/589#issuecomment-6666789474), actual `describe_execution` on `jscc-diagnostics-dev-5lf4k` reports `task_read_403`.

**Google Cloud authoritative documentation**
- [Cloud Run v2 tasks.list](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions.tasks/list): `GET .../jobs/{job}/executions/{execution}/tasks` requires **`run.tasks.list` on the parent Execution**.
- [Cloud Run IAM access management](https://docs.cloud.google.com/run/docs/securing/managing-access): IAM bindings may be granted at the Cloud Run **Job** level, without granting a project-wide role.
- [Policy Troubleshooter](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access): check effective allow, deny, condition and PAB policies for the exact principal/resource/permission.
- [gcloud run jobs add-iam-policy-binding](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/add-iam-policy-binding): additive resource-level grant.

## Implemented targeted fix

`scripts/gcp/repair_remote_executor_dev_task_iam.sh`
- **Default `--check` is read-only.** Checks exact `jscc-dev/europe-west1/jscc-diagnostics-dev` and expected runtime identity `jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com`.
- Checks existing custom role `projects/jscc-dev/roles/jsccDiagnosticsExecutionReaderDev` contains `run.executions.get` and `run.tasks.list` and no mutating permissions.
- Reads the Job IAM policy. If an unconditional role binding already exists, the script changes **nothing**. If a conditional binding exists, refuses to replace or override it.
- With `--apply` **only when binding is missing**, adds that existing custom role to that service account on **only that Job**, confirms binding with a subsequent read.
- Uses official IAM Policy Troubleshooter on existing Execution `jscc-diagnostics-dev-5lf4k`, with exact subject, `run.tasks.list` and resource. Reports `EFFECTIVE_IAM_GRANT_REPORTED`, `effective policy still denies` or `TROUBLESHOOTER_UNAVAILABLE`, never fabricates a successful live API read.
- No project-level IAM, no Viewer/Admin grant, no service-account key or impersonation token, no TEST/PROD resource, no changes to #595 IAM observer grants.

This is a source implementation. To apply against live DEV requires an existing **authorized GCloud operator**, not a read-only diagnostic worker or an isolated workspace shell. The present JSCC DEV connector's `workspace_run` rejects `gcloud` executable arguments with `invalid_argv`. No live IAM mutation was possible via that connector.

## Verification gates

1. Unit tests `ops/test/test_dev_task_iam_remediation.py` use a fake `gcloud` executable to prove exact target, no blanket IAM, no repeated grants, conditional denial, wrong-identity denial and effective Policy Troubleshooter refusal.
2. `bash -n` and Python unittest run in Remote Executor CI; this **does not validate the live IAM state**.
3. If `--check` says `JOB_BINDING_PRESENT` but live Cloud Run `tasks.list` is still HTTP 403, stop. Investigate effective deny/PAB, impersonated service account identity, Cloud Run parent resource and permission propagation. Do **not** add generic Viewer or project-wide IAM.
4. After a reviewed, authorized `--apply` when needed, run the independent DEV `describe_execution` scenario on the known execution and require non-empty task metadata/exit evidence. Retest F2/F3 independently.
5. Leave `E2E_ACCEPTANCE_FAIL` until F1–F3 have real evidence. A green source CI, successful Job IAM readback or even Troubleshooter `CAN_ACCESS` is **not** a task-metadata E2E PASS.

**Separation:** this E2E F1 finding is distinct from the broader project-IAM **F1 HIGH** security finding in PR #595, which remains open.

## 2026-11-05: Actual troubleshooting results supersede missing-binding hypothesis

The owner enabled the Policy Troubleshooter API and obtained **`overallAccessState=CAN_ACCESS`**, `allowAccessState=ALLOW_ACCESS_STATE_GRANTED`, `denyAccessState=DENY_ACCESS_STATE_NOT_DENIED` for the **v2 Execution** parent `//run.googleapis.com/projects/jscc-dev/locations/europe-west1/jobs/jscc-diagnostics-dev/executions/jscc-diagnostics-dev-5lf4k`. The job IAM custom role is already present. **Do not run `--apply` or add IAM grants**.

The CLI `gcloud run jobs executions tasks list --impersonate-service-account=...` returned HTTP 403, specifically **`run.tasks.list` denied on `namespaces/jscc-dev/tasks`**. This is the **Cloud Run v1 namespace path**, not the narrower v2 execution parent checked by Policy Troubleshooter and requested by `ops/src/worker.mjs`.

Google official docs establish this distinction:
- [v1 namespaces.tasks.list](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.tasks/list) authorizes the namespace `namespaces/{project}`.
- [v2 projects.locations.jobs.executions.tasks.list](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions.tasks/list) authorizes the exact `projects/{project}/locations/{location}/jobs/{job}/executions/{execution}` parent.

**Do not grant project IAM merely to satisfy the v1 CLI implementation.** Instead, diagnose the actual v2 path using `bash scripts/gcp/verify_remote_executor_dev_task_v2.sh`; this read-only probe impersonates the existing DEV worker and calls the exact v2 URI, emitting only HTTP status and bounded task count, never a token or task payload.

- `V2_TASKS_VERDICT=READ_GRANTED`: API v2 access works under Cloud Shell impersonation. Any deployed worker's existing `task_read_403` still needs a worker-runtime token/identity/request-path investigation; it is not automatically closed by this probe.
- `V2_TASKS_VERDICT=HTTP_DENIED`: API v2 also denies, and a detailed, server-side diagnosis of effective identity/resource remains necessary; no speculative IAM grants.
- Auth/transport failures are inconclusive, not PASS.

The original deployed #537 worker uses the v2 REST path; the test's CLI 403 alone is insufficient to explain the worker error. The independent E2E finding remains OPEN until a real worker `describe_execution` shows task metadata.
