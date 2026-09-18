# Project Sanity

Status: implementation for #211.

## Purpose

Every JSCC chat is a temporary workspace. GitHub remains the operational source of truth.

Before substantive work resumes in any project chat, the AI must compare the chat context with the latest project-state snapshot. This prevents stale thread context from overriding newer release, deployment, QA or defect evidence.

## Automatic snapshot

Workflow: `.github/workflows/project-sanity.yml`

Artifact: `current-project-state`

Files:
- `current-project-state.json` - machine-readable snapshot;
- `current-project-state.md` - compact human-readable snapshot.

The workflow is read-only with respect to the repository and all application environments. It runs after relevant issue/PR/lifecycle events and once daily as drift protection.

The generator reads:
- the single active PR whose title matches `[Release N Wave M]`;
- that PR's immutable head SHA;
- issue references in the release PR body;
- open blocker/bug and QA issue state;
- promotion evidence artifacts created by the canonical DEV/TEST/PROD workflows.

Evidence chain:
- DEV: `promotion-dev-pass`;
- TEST deployed: `promotion-test-deployed`;
- TEST PASS: `promotion-test-pass`;
- PROD PASS: `release-record`.

Important: the historical artifact name `promotion-dev-pass` proves the deployment/technical evidence produced by the workflow. The sanity snapshot deliberately reports this as `DEV=DEPLOYED`, not as completed functional DEV verification. The next gate remains `DEV_FUNCTIONAL_VERIFICATION` until later lifecycle evidence advances the candidate.

## Fail-closed behavior

The generator does not guess when:
- more than one active release PR exists;
- the active candidate SHA is invalid;
- related GitHub evidence cannot be read.

Those conditions produce `SANITY: WARNING`.

No sanity operation may:
- deploy code;
- write application/runtime data;
- change GitHub issues/PRs;
- mutate DEV, TEST or PROD;
- touch LEGACY.

## Chat-start rule

At the first substantive message in a JSCC chat:

1. obtain the latest successful `Project sanity snapshot` artifact;
2. compare the chat's project statements with the snapshot;
3. classify material chat state as `CURRENT`, `STALE`, `SUPERSEDED` or `UNIQUE`;
4. if the artifact is unavailable, stale or `WARNING`, perform the existing manual GitHub sanity fallback;
5. persist material `UNIQUE` information before declaring a chat disposable.

Default response is compact:

```text
SANITY: PASS | WARNING

Release / candidate:
DEV:
TEST:
PROD:
Blockers:
QA:
Next gate:

Stale/superseded chat state:
Unique information not yet persisted:

Chat deletion verdict:
SAFE TO DELETE | DO NOT DELETE
```

The generated snapshot cannot decide whether a chat contains unique information. Therefore its own deletion field is `REQUIRES_CHAT_COMPARISON`; the final deletion verdict is produced only after the AI compares the actual chat.

## Manual verification

Unit/contract tests:

```bash
node --test scripts/test_project_sanity.mjs
```

Generator syntax:

```bash
node --check scripts/project_sanity.mjs
```

Live read-only generation inside GitHub Actions:

```bash
npm run sanity:project -- --output-json project-state/current-project-state.json --output-md project-state/current-project-state.md
```
