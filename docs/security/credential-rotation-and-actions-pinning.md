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

### Enforcement sequence

1. Implement migration in #242.
2. Verify all active workflows are green.
3. Verify no mutable external action tag remains.
4. Only then may the owner enable GitHub's repository policy requiring full-length action SHAs.

The policy must not be enabled before migration because it would intentionally break current workflows.

## 3. Release 1 status

#234 closes the operational procedure and the architectural decision only. The actual workflow migration is #242 and remains a separate implementation change.
