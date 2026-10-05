# GCP migration lessons learned — DEV -> TEST

Status: CURRENT  
Tracker: #425 / #483  
Last consolidated: 2026-10-04

Each lesson below is paired with the permanent control that prevents recurrence.

| Observed failure / risk | Permanent control |
| --- | --- |
| Manual Job/Service build and deploy choreography caused identity drift and operator work. | One Cloud Build promotion entry point; immutable candidate SHA and image digests. |
| Active `gcloud` project could differ from the intended target. | Every project-dependent command carries explicit `--project`; environment mapping is centralized. |
| Historical scripts embedded old SHA/digests. | Digests are resolved from Artifact Registry for the requested candidate; no historical release identity is hard-coded. |
| Runtime seed initially omitted required files. | One canonical seed manifest plus provision/verify gate. |
| OAuth-origin troubleshooting became mixed with runtime migration. | OAuth/browser acceptance is a separate gate from infrastructure promotion. |
| DEV -> TEST initially missed Service -> Job override IAM parity. | Promotion reconciles and verifies `roles/run.jobsExecutorWithOverrides` after Job deployment. |
| Canonical Command API path variables were omitted in an early GCP Service deployment. | Service deployment sets the complete canonical data-path contract on every promotion. |
| GitHub-hosted runner availability/quota could block deployment. | Cloud Build is the deployment control plane. |
| Legacy Cloudflare deployment paths could accidentally remain authoritative. | Command API Cloudflare deploy paths are fail-closed; ai-github-bridge remains separate. |
| Standalone TEST needed a newer control plane than the frozen candidate. | Pipeline SHA and candidate SHA are distinct, explicit identities for TEST-only promotion. |
| A newer control-plane checkout could accidentally rebuild an older candidate. | TEST-only requires pre-existing immutable candidate images; no rebuild is allowed. |
| TEST seed could be synthesized from a newer control-plane checkout. | Standalone TEST uses verify-only runtime seed. |
| DEV evidence previously proved SHA but not full artifact parity. | TEST gate validates both Job and Service digests. |
| `/health/db` passed while TEST had no schema at all. | DB connectivity and DB schema readiness are separate gates. |
| TEST database migrations were omitted from promotion. | Dedicated environment-scoped Cloud Run DB Migration Job runs candidate migrations before application rollout. |
| A recorded migration version can still coexist with schema drift. | Post-migration check verifies migration version/name/checksum and required relations. |
| Cloud Build reported SUCCESS although login was functionally broken. | Promotion checklist must reach terminal PASS; functional DEV/TEST acceptance remains a separate release gate. |
| The real migration state was not visible to the owner. | `promotion-status.json` is updated step-by-step and shown ADMIN-only in the UI. |
| Manual emergency DB commands were required to repair TEST. | Normal DEV/TEST promotion owns schema migration; operator SQL is not part of the canonical path. |

## Incident #483

The v0.6.0 standalone TEST deployment returned Cloud Build SUCCESS, `/health=ok` and `/health/db=ok`, but first Google login failed because `system_bootstrap` did not exist. Inspection of `jobsearch_test` showed that even `schema_migrations` was absent. Applying candidate migrations 001-005 restored login.

The root procedural defect was therefore not a bad migration: **database migration was absent from the promotion contract and database health checked only connectivity/binding**.

The permanent invariant is:

```
candidate application
+ candidate runtime data contract
+ candidate database schema
+ environment IAM/configuration
= deployable environment
```

None of these components may be inferred from another component's health check.
