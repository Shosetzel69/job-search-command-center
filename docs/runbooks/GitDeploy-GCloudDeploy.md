# JSCC DEV — GitDeploy + GCloudDeploy

## Two routes, one Service deploy engine

**GitDeploy:** Automatic after `Validate Command API` finishes successfully on a `push` to `main` (including PR merges). The workflow authenticates with the existing DEV Workload Identity Federation service account, checks the exact `main` source SHA and all five mandatory canonical CI job results, then runs `scripts/deploy/GitDeploy.sh` and the common Service-only deploy engine. No GitHub Release, release tag, issue-comment command, second reviewer, or manual owner command is required.

**GCloudDeploy:** Manual fallback in authenticated Cloud Shell. Run `bash scripts/deploy/GCloudDeploy.sh <40-char-main-SHA> preflight`, then `bash scripts/deploy/GCloudDeploy.sh <40-char-main-SHA> deploy`. It validates clean up-to-date `main`, uses a detached candidate worktree, checks the same canonical CI results, requires a TTY confirmation, and impersonates the DEV deployer service account. The operator must have effective GCP IAM rights. Don't use both routes simultaneously.

**Common:** DEV Cloud Run Service only (`jscc-dev`, `europe-west1`, `jscc-command-api-dev`). Immutable image digest, Cloud Build provenance, 0%-traffic staging, authenticated health+database checks, safe 100%-traffic cutover, and conditional rollback. **No changes to Nile data/schema, Search Job, IAM, TEST or PROD.** CI failure blocks deployment; no separate PR reviewer in solo-DEV mode.

## One-time automatic activation requirements

The existing GitHub environment `dev` currently requires manual approval, so **automatic operation requires turning off Required Reviewers** there; keep environment names and existing WIF variables. This setting is not changeable through the current GitHub connector. Verify WIF subject/attribute restriction to the intended repository, `refs/heads/main`, and the approved DEV identity; do not allow untrusted PR branches to impersonate the deployer. The allowed WIF event/context (`workflow_run` + `environment=dev`) must also be verified. An overly broad WIF binding is not made safe by shell checks.

The GitHub workflow does not auto-deploy documentation-only commits when `Validate Command API` does not run (existing workflow `paths` filter). Any code-relevant merge that triggers that validation will start GitDeploy once canonical CI is green. If `main` changes before the run starts, the stale candidate is rejected.

## Retirement of old DEV deployment entrypoints

**Only retire after one successful authenticated GitDeploy run AND a separate GCloudDeploy preflight.** Legacy P4 issue-comment deploy, old paired-image release and ad-hoc DEV GCP release workflows may then be removed from GitHub. Leave unrelated CI, search/validation, DEV diagnostics, TEST/PROD and legacy fail-closed `exit 86` protections alone. Existing GCP infrastructure, databases, service accounts, credentials and images are not 'old routes' and must not be deleted.

### Operational readiness and evidence

PR #681 contains implementation and tests, not proof of effective WIF/IAM or a real Cloud Run release. A green CI contract is not functional acceptance. Successful staging and cutover plus independently checked DEV UI/tenant acceptance are required for declaring the app delivered.

