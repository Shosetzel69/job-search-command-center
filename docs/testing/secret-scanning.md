# Secret scanning

Issue: #233 / parent #21  
Release: Release 1 / Wave 3

## Tool and cost

JSCC uses the open-source Gitleaks CLI. The CI workflow downloads a fixed release archive and verifies its SHA-256 before execution.

Current scanner:
- version: `8.30.1`;
- Linux x64 archive SHA-256: `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`;
- configuration: `.gitleaks.toml`;
- cost: no project subscription/license required for this CLI workflow.

## CI behavior

Workflow: `.github/workflows/secret-scanning.yml`.

Triggers:
- every pull request;
- push to `main`;
- manual `workflow_dispatch`.

The workflow:
1. checks out full Git history;
2. downloads and checksum-verifies the pinned scanner binary;
3. executes a fail-closed synthetic-secret self-test in a temporary Git repository;
4. selects an immutable Git range;
5. scans committed changes using the default Gitleaks rules extended by project configuration.

Scan scope:
- PR: `base SHA..head SHA`;
- push: `before SHA..current SHA`;
- manual: full history (`--all`).

A finding exits non-zero and fails the security gate. Findings are emitted with `--redact`.

## Self-test

`scripts/security/gitleaks-selftest.sh` creates a temporary repository containing a synthetic, non-working GitHub-PAT-shaped value. The self-test passes only if Gitleaks rejects the fixture with its secret-detected exit code.

The synthetic credential is never committed to the JSCC repository.

## False positives / allowlisting

False positives must be suppressed narrowly in `.gitleaks.toml`.

Rules:
- use a scoped `[[allowlists]]` entry with a specific path, regex, or target rule;
- include a short reason in the allowlist description;
- prefer rule-specific suppression over global suppression;
- do not disable broad default rules only to make CI green;
- never allowlist an actual active credential;
- rotate/revoke a real credential before any historical suppression decision.

Example:

```toml
[[allowlists]]
description = "Synthetic documentation example tracked by <issue>"
targetRules = ["<rule-id>"]
paths = ['''^docs/example-file\.md$''']
```

## Local reproduction

With Gitleaks 8.30.1 available:

```bash
bash scripts/security/gitleaks-selftest.sh
gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts="BASE..HEAD" .
```

Never paste real credentials into test fixtures.
