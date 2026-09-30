# GCP end-to-end promotion procedure

Status: canonical replacement for the manual GCP migration choreography used during #425/#440.

## 1. What was wrong with the manual procedure

The initial DEV migration proved the architecture but exposed operational defects in the procedure:

1. Job and Service were built with separate manual trigger invocations.
2. Build status was polled manually.
3. Artifact digests were resolved manually.
4. Job and Service were deployed separately.
5. The active gcloud project could differ from the target project.
6. The first DEV deployment script contained historical hard-coded SHA/digest values.
7. Runtime seed provisioning omitted `applications.json`.
8. OAuth origin troubleshooting was mixed into runtime migration and caused an unnecessary custom-domain detour.
9. Legacy DEV/TEST were assumed older than GCP DEV before exact deployment evidence was checked; in reality GCP DEV was behind the legacy promoted candidate.
10. UI parity and runtime parity were initially treated as one gate; they must be evidenced separately.
11. GitHub Actions jobs may currently fail before steps execute, so GCP promotion must not rely on GitHub-hosted runners as its only executor.
12. DEV -> TEST promotion initially reproduced artifacts but not the effective Service -> Job override IAM contract; control-plane parity is therefore an explicit promotion responsibility.

## 2. Canonical model

One immutable candidate SHA is the only release identity.

```
candidate SHA
  -> tests
  -> build Job image once (or reuse exact existing artifact)
  -> build Service image once (or reuse exact existing artifact)
  -> resolve immutable digests
  -> DEV seed verification
  -> DEV Job + Service deploy by digest
  -> DEV /health + /health/db
  -> DEV evidence
  -> TEST seed verification
  -> TEST Job + Service deploy using the SAME digests
  -> TEST /health + /health/db
  -> TEST evidence
```

No rebuild occurs between DEV and TEST.

## 3. Canonical entry point

`cloudbuild.promotion.yaml`

Inputs:
- `_GIT_SHA`: exact 40-character lowercase candidate SHA.
- `_TARGET`: `dev` or `dev-test`.

Normal full promotion:

```
_TARGET=dev-test
_GIT_SHA=<frozen candidate>
```

The Cloud Build execution is the operator. Individual gcloud commands are not part of the normal release procedure.

## 4. Environment mapping

Resolved only by `scripts/gcp/environment.sh`:

| Environment | Project | Job | Service | Search mode | Database |
| --- | --- | --- | --- | --- | --- |
| DEV | jscc-dev | jscc-search-dev | jscc-command-api-dev | disabled | jobsearch_dev |
| TEST | jscc-test | jscc-search-test | jscc-command-api-test | smoke | jobsearch_test |

No PROD path exists in this implementation.

Every project-dependent gcloud command includes explicit `--project`.

## 5. Runtime seed contract

Canonical manifest:

`scripts/gcp/runtime_seed_files.txt`

Required:
- applications.json
- jobs.json
- run-history.json
- run-status.json
- search-config.json
- search-state.json

`seed_runtime.sh`:
- creates the environment bucket only when absent;
- uploads only missing seed objects;
- never overwrites existing environment runtime state during a normal promotion;
- verifies every mandatory seed object after provisioning.

Candidate-managed assets remain in the immutable image:
- sources.json
- source-categories.json
- nomenclatures.json

## 6. Promotion evidence

Each environment produces:

`artifacts/gcp-promotion/<environment>-<candidate-sha>.json`

Evidence includes:
- environment;
- candidate SHA;
- Job digest;
- Service digest;
- Service revision;
- Service URL;
- expected DB;
- health PASS;
- DB health PASS;
- seed manifest PASS.

TEST promotion fails unless DEV evidence exists and verifies for the exact same candidate SHA.

## 7. One-time control-plane prerequisites

These are infrastructure prerequisites, not per-release operator steps.

The Cloud Build execution identity must have only the permissions required to:
- read/write the shared Artifact Registry;
- deploy Cloud Run Job/Service in DEV and TEST;
- act as the respective runtime service accounts;
- verify/provision the environment runtime buckets;
- read Secret Manager metadata needed by deployment.

Each environment must already contain:
- `NILE_DATABASE_URL`
- `ALLOWED_GOOGLE_SUB`
- `GOOGLE_CLIENT_ID`

The OAuth client referenced by `GOOGLE_CLIENT_ID` must authorize the canonical environment Cloud Run origin.

Runtime service accounts require access to their own:
- runtime bucket;
- Nile secret;
- allowed-user secret;
- OAuth client-id secret;
- Cloud Run Job invocation boundary as required by the Service.

The Service invokes Cloud Run Jobs with per-execution overrides. Therefore the runtime service account must receive the predefined least-privilege role `roles/run.jobsExecutorWithOverrides` on its environment Job. `roles/run.invoker` is insufficient for this path because it does not grant `run.jobs.runWithOverrides`.

Promotion applies and verifies this binding through `scripts/gcp/reconcile_job_invocation_iam.sh`. The same script is the control-plane-only remediation entry point for an already deployed environment; it changes IAM only and does not rebuild or redeploy Service/Job images.

No cross-environment fallback is permitted.

## 8. Gates

Promotion fails immediately if:
- candidate SHA is not exact;
- immutable Job or Service image cannot be resolved/built;
- a mandatory runtime seed is missing after provisioning;
- a required environment secret is missing;
- the environment runtime service account does not have the verified override-capable Job execution binding;
- Service does not route 100% to the new revision;
- Service URL differs from canonical run.app origin;
- /health does not report the exact candidate;
- /health runtime backend is not GCP;
- /health/db does not bind to the correct environment/database;
- TEST evidence does not match the DEV candidate.

## 9. Browser acceptance

Infrastructure promotion is non-interactive.

Google end-user login is an external interactive identity flow. Its configuration is verified structurally by `auth_configured=true` and the environment-specific OAuth origin. A release that changes authentication/UI behavior still requires a separately recorded browser acceptance test; ordinary backend/source changes do not require the owner to repeat deployment commands.

## 10. Deprecated manual commands

Do not use as normal procedure:
- manual `jscc-gcp01-build` + `jscc-gcp05-service-build` sequencing;
- manual digest resolution;
- manual `gcloud run jobs update`;
- manual `gcloud run services update`;
- historical hard-coded `deploy_dev_job.sh` behavior.

`deploy_dev_job.sh` now only delegates to the generic promotion orchestrator.
