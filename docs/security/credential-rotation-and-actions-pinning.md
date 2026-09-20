# Credential rotation and GitHub Actions pinning

Issue: #234 / parent #21  
Release: Release 1 / Wave 3

## 1. Compromised token rotation

This procedure covers environment-scoped GitHub PATs/tokens and Cloudflare deployment credentials used by JSCC.

### Roles

| Secret | Purpose / consumer |
|---|---|
| `GH_RUNTIME_TOKEN` | runtime GitHub access; propagated to Worker as `GITHUB_TOKEN` |
| `GH_BOOTSTRAP_TOKEN` | environment/bootstrap operations only |
| `SOURCE_READ_TOKEN` | immutable source checkout by the runtime repository workflow |
| `CLOUDFLARE_TOKEN` | deploy/configure the environment Worker |

DEV, TEST and PROD credentials are rotated independently. Do not broaden a credential scope during rotation.

### Rotation procedure

1. **Identify scope**
   - environment: DEV / TEST / PROD;
   - credential role;
   - repositories/account/resources reachable by that credential;
   - whether compromise is confirmed or suspected.

2. **Contain**
   - for confirmed compromise, revoke the exposed token at the provider immediately;
   - do not print, paste into an Issue, or preserve the old token as evidence;
   - if several environments use distinct credentials, do not rotate unaffected environments without evidence they are exposed.

3. **Create replacement**
   - create a new credential with the minimum permissions required by the same role;
   - preserve environment isolation and repository boundaries;
   - verify the new token can access only its intended resources before propagation.

4. **Update the GitHub Environment secret**
   - replace only the affected secret (`GH_RUNTIME_TOKEN`, `GH_BOOTSTRAP_TOKEN`, `SOURCE_READ_TOKEN`, or `CLOUDFLARE_TOKEN`);
   - never place the value in repository files, workflow inputs, comments, artifacts or logs.

5. **Propagate downstream where required**
   - `GH_RUNTIME_TOKEN`: update Worker secret `GITHUB_TOKEN`;
   - `SOURCE_READ_TOKEN`: update the target runtime repository secret used for source checkout;
   - `GH_BOOTSTRAP_TOKEN`: no persistent runtime copy is expected; use only for the bootstrap/configuration operation;
   - `CLOUDFLARE_TOKEN`: remains an environment deployment credential and is not copied into application runtime.

6. **Validate**
   - validate provider permissions using a non-destructive read;
   - validate the affected environment with the current known-good source SHA;
   - confirm `/health`: expected environment, source SHA, runtime repo/ref and `github_configured=true`;
   - do not run Full Search only to validate credential rotation;
   - PROD validation remains non-mutating unless a separately approved release/cutover action is required.

7. **Record sanitized evidence**
   - date/time;
   - environment and credential role;
   - old credential revoked: YES/NO;
   - replacement scope/permissions (names only, never the value);
   - validation result and health identity;
   - incident/change Issue reference.

### Failure / rollback

A compromised credential is never restored. If the replacement fails, create another least-privilege replacement and repeat propagation/validation. Application rollback and credential rotation are separate operations.

## 2. GitHub Actions pinning decision

### Current state

Active workflows use external action references by mutable major tag, primarily:
- `actions/checkout@v4` (with the new secret-scanning workflow already using `@v6`);
- `actions/setup-node@v4`;
- `actions/setup-python@v5`;
- `actions/upload-artifact@v4`.

Major tags are convenient but mutable. Several existing workflow runs also report Node 20 action-runtime deprecation warnings.

### Decision

**ADOPT full-length commit SHA pinning for every external action used by active JSCC workflows.**

Rules:
- each `uses: owner/action@...` reference must use the reviewed 40-character commit SHA;
- retain a trailing comment with the human-readable release tag/version;
- resolve the SHA from the canonical action repository, never a fork;
- before pinning, select a currently supported Node 24-compatible release when the existing major is obsolete;
- local scripts/actions are not affected;
- action upgrades are explicit dependency changes with CI evidence.

### Release 1 pinned baseline

#242 selects the following canonical action releases:

| Action | Release | Full commit SHA | Runtime |
|---|---|---|---|
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | Node 24 |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` | Node 24 |
| `actions/setup-python` | `v7.0.0` | `5fda3b95a4ea91299a34e894583c3862153e4b97` | Node 24 |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | Node 24 |

Each SHA was resolved from the corresponding tag in the canonical `actions/*` repository and the checked-in action manifest was verified to use Node 24.

### Future action update procedure

For every action version bump:

1. identify the required action and target release from its canonical repository;
2. review the release notes for behavior, runtime and permission changes;
3. resolve the exact release tag to its canonical full 40-character commit SHA;
4. inspect the action manifest/runtime and reject obsolete Node runtimes;
5. update every active workflow reference for that action;
6. keep the human-readable release as a trailing comment, for example:
   `uses: actions/checkout@<40-char-sha> # v7.0.1`;
7. run `npm run test:environment` and the full repository CI;
8. merge only with green CI and no mutable external action reference remaining.

The permanent regression guard is `scripts/test_action_pinning.mjs`, executed by `npm run test:environment`.

Do not use forks, branch names or mutable major tags as the pinned source.

### Enforcement sequence

1. Complete migration in #242.
2. Verify all active workflows are green.
3. Verify `scripts/test_action_pinning.mjs` reports no mutable external action reference.
4. Only then may the owner enable GitHub's repository policy requiring full-length action SHAs.

The policy must not be enabled before migration because it would intentionally break current workflows.

## 3. Release 1 status

#234 closes the operational procedure and architectural decision. #242 implements the workflow migration and permanent CI regression guard.
