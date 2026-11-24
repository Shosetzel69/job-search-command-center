# JSCC DEV Service release — GitDeploy / GCloudDeploy

**Authority:** existing #492. **Environment:** GCP DEV only (`jscc-dev`, `europe-west1`). These are two execution transports for **one** reviewed, immutable release candidate. They share the same policy validator and runtime rollout engine.

## GitDeploy — automatic

`.github/workflows/GitDeploy.yml` starts automatically when the owner publishes a **non-draft, non-prerelease GitHub Release** whose version tag matches `jscc-dev-vX.Y.Z`. A read-only admission job verifies the tag's SHA is reachable from `main`, then dispatches the protected deployment job on `main`; there is no issue-comment trigger and no automatic deploy on every merge.

The privileged job requires the existing `dev` environment to have **Required Reviewers, Prevent self-review, Prevent administrator bypass (`can_admins_bypass=false`), and a distinct eligible reviewer account** (not the shared owner/agent login). It verifies the published release record, the exact candidate SHA, a successful mandatory CI set, and the existing DEV WIF identity before invoking `scripts/deploy/GitDeploy.sh`. It only runs after the reviewer authorizes the protected environment. If this configuration or IAM is missing, it must fail closed.

This two-event pattern preserves the existing GitHub main-branch WIF trust context. Review the effective WIF provider conditions before activating. **Do not publish a release for a candidate until the PR has independent exact-SHA review and owner release authorization.** Publishing a release is an operational release request and is visible in this public repository; never include credentials or private profile data.

## GCloudDeploy — manual break-glass fallback

`scripts/deploy/GCloudDeploy.sh` is run interactively from **Google Cloud Shell**, on a clean, fully updated `main` checkout. It takes the same immutable candidate SHA and already-published `jscc-dev-vX.Y.Z` release tag. The default action is **preflight**; the `deploy` action reruns preflight and requires an attached TTY and an exact confirmation read from `/dev/tty` (stdin pipes are rejected). A non-service-account active `gcloud` principal is required. Google Cloud operations impersonate the dedicated DEV deployer service account using the active Cloud Shell session (no JSON key). It does not create a release or bypass its approval record.

**Break-glass security model:** GCloudDeploy is an operator-assisted recovery mechanism, **not equivalent to GitDeploy's independent environment-review gate**. A shell script, TTY and Cloud Shell environment variables are **not cryptographic human-identity attestations**: an authorized GCP principal could call `gcloud` without the wrapper. Before permitting manual deployments, independently inventory and restrict `roles/iam.serviceAccountTokenCreator` / impersonation of `jscc-app-deployer-dev@jscc-dev.iam.gserviceaccount.com` to an exclusive human-owned GCP principal, not any agent-shared account; remove direct Cloud Run update privileges from non-break-glass principals. Require separately recorded owner approval and independent review of the exact candidate, followed by audited GCP IAM actions. If these conditions cannot be verified, **do not activate GCloudDeploy**. The script's Cloud Shell environment check is advisory only; the *effective GCP IAM binding* is the enforceable boundary.

Manual channel example (placeholders, not authorization):

```bash
bash scripts/deploy/GCloudDeploy.sh <approved-40-char-SHA> jscc-dev-vX.Y.Z preflight
bash scripts/deploy/GCloudDeploy.sh <approved-40-char-SHA> jscc-dev-vX.Y.Z deploy
```

Do not start the manual route while GitDeploy is active for the same service. The engine checks revision/configuration/traffic drift and fails closed; nevertheless it does not establish a universal distributed lock across older workflows.

**CI handling:** each mandatory GitHub Actions check is queried by `check_name` with `filter=latest`, all pages are collected (bounded to fail closed), and only the latest run by check ID is accepted. An earlier green result cannot mask a newer failure. This prevents unrelated skipped issue-comment runs from pushing required checks beyond the first 100.

## Shared execution contract

`scripts/deploy/jscc-dev-service.sh` and `jscc_deploy_guard.py` enforce: verified GitHub release record, exact SHA on main, CI success, read-only DEV baseline, immutable Artifact Registry, dedicated identity, Cloud Build Service image provenance, config/secrets/VPC/scaling parity, 0% traffic stage, authenticated tagged /health and /health/db, 100% cutover and post-cutover smoke. The previous live revision is recorded dynamically and rollback is attempted on failure; concurrent external changes prevent blind rollback. Failed cleanup may require manual incident recovery. No Nile DDL, Search Job, runtime secrets, TEST or PROD operations.

**Technical deployment PASS is not functional acceptance.** Run independent DEV user/tenant-level acceptance separately, and record the run ID, source SHA, serving revision and digest in #492 / applicable P4 item.

## Migration policy

Current existing release mechanisms, their `exit 86` controls and the unfinished #680 work remain **unchanged** while these two routes are developed and validated. No automatic cutover, retirement, IAM or environment-policy mutation is authorized by creating this PR. After independent review, validate both routes (preflight + at least one authorized real DEV release and Cloud Shell fallback dry run) and only then request approval to disable/remove older mechanisms.

## Known activation dependencies

- A distinct required GitHub reviewer, Prevent self-review and **disable administrator bypass** (`can_admins_bypass=false`) must be present on `dev`; agents sharing `Shosetzel69` cannot substitute for an independent reviewer.
- Verify whether the existing WIF trust condition permits a GitHub-generated `workflow_dispatch` identity. Authentication failure is a blocker, not an invitation to grant broad IAM privileges.
- Cloud Shell operator needs access to impersonate `jscc-app-deployer-dev@jscc-dev.iam.gserviceaccount.com`; required least-privilege Cloud Build, Cloud Run, Artifact Registry and source-staging permissions must be effective.
- Review actual DEV config parity on the first staged rollout and test controlled rollback. No rollout to TEST/PROD.

