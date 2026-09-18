# Project Sanity

Status: CANONICAL
Scope: JSCC chat-resume sanity + GitHub current-state evidence
Implements: #211, #222

## 1. Purpose

Every JSCC chat is a temporary workspace. GitHub remains the operational source of truth.

Sanity answers the chat-level question first:

> Is the information and working subject of this chat still current and useful?

Only after that does it expose project/release/environment state needed to support the answer.

## 2. Chat-first evaluation

At the first substantive message in a resumed JSCC chat, or when the owner writes `sanity`:

1. inspect the current chat and identify its **last material action**;
2. identify the result/status left by that action;
3. identify the chat's narrow working **subject**;
4. obtain the latest successful `Project sanity snapshot`;
5. compare the chat subject/action with current GitHub evidence;
6. classify the subject relevance;
7. report only material changes since the last chat action;
8. show only current project state relevant to this chat;
9. decide whether the chat can safely continue or be deleted.

A material action is the latest concrete project operation or decision in this chat, for example: implementation, PR/Issue change, deployment, test result, approved decision, completed analysis or explicit blocked/waiting state. Ignore greetings, generic status questions and other non-state-changing messages when identifying it.

If an exact action timestamp is available, include it. Do not invent one.

## 3. Topic relevance classifications

- `CURRENT`: the chat subject is still active and its material working state agrees with current evidence.
- `PARTIALLY_CURRENT`: the subject is still active, but one or more material facts in the chat are stale and must be replaced before continuing.
- `SUPERSEDED`: a newer candidate, ticket, decision, workflow or procedure replaced the working basis of this chat. Do not continue from the old basis.
- `CLOSED`: the chat subject/action is completed and no further action remains for that subject.

These classifications describe the **chat topic**, not whether sanity itself succeeded.

## 4. Sanity status

- `SANITY: PASS`: chat relevance was verified against sufficient current evidence. A topic may still be `SUPERSEDED` or `CLOSED`.
- `SANITY: WARNING`: verification completed but found material contradictions, stale assumptions or ambiguous state that must be called out.
- `SANITY: BLOCKED`: current GitHub/snapshot evidence cannot be obtained or is insufficient. Never claim the chat is current from memory alone.

## 5. Required default output

The chat assessment must come first. Do not start with release/DEV/TEST/PROD status.

```text
SANITY: PASS | WARNING | BLOCKED

CHAT
Last material action:
Result:
Subject:
Relevance: CURRENT | PARTIALLY_CURRENT | SUPERSEDED | CLOSED
Reason:

CHANGED SINCE
- only material changes relevant to this chat
- "none" when there are no relevant changes

CURRENT RELEVANT STATE
- only evidence/state needed for this chat
- omit unrelated global project status

NEXT
- next useful action for this subject
- "none" when the subject is complete

UNIQUE / PERSISTENCE
- material chat-only information not yet persisted, or "none"

CHAT VERDICT
SAFE TO CONTINUE | SAFE TO DELETE | DO NOT DELETE
```

## 6. Chat verdict rules

`SAFE TO CONTINUE`:
- current evidence is available;
- the subject is `CURRENT` or `PARTIALLY_CURRENT`;
- any stale facts have been explicitly replaced in the sanity output;
- no unresolved contradiction prevents execution.

`SAFE TO DELETE`:
- no material `UNIQUE` information remains only in chat;
- required decisions/results are already persisted in GitHub;
- the topic is normally `CLOSED` or `SUPERSEDED`, or the owner explicitly asked only for deletion safety.

`DO NOT DELETE`:
- material `UNIQUE` information still exists only in chat;
- persistence is incomplete;
- or an unresolved ambiguity means deletion could lose project context.

`CLOSED` never implies `SAFE TO DELETE` by itself.

## 7. Project-state evidence

Workflow: `.github/workflows/project-sanity.yml`

Artifact: `current-project-state`

Files:
- `current-project-state.json` - machine-readable snapshot;
- `current-project-state.md` - compact human-readable snapshot.

The snapshot is evidence for the chat comparison, not the first section of the user-facing sanity response.

It derives:
- active checkpoint/FRC PR and immutable SHA;
- related blockers and QA Issues;
- promotion evidence for DEV/TEST/PROD;
- next lifecycle gate;
- LEGACY boundary.

Discovery convention:
- `[Release N Wave M] ...` = intermediate validation checkpoint;
- `[Release N FRC] ...` or `[Release N Final Release Candidate] ...` = Final Release Candidate.

Checkpoint TEST PASS stops before PROD. Only an FRC can advance toward PROD.

## 8. Topic-scoped project status

Do not dump the full project snapshot by default.

Show release/candidate/DEV/TEST/PROD only when one of them:
- is part of the chat subject;
- changed since the chat's last material action;
- proves that the chat state is stale/superseded;
- is required for the next action.

For a documentation, architecture, source investigation or other unrelated chat, omit environment/release details unless they materially affect that topic.

## 9. Fail-closed and safety

If the latest snapshot is unavailable, stale for the event being evaluated or has `SANITY: WARNING`, use targeted GitHub verification. If current evidence still cannot be established, return `SANITY: BLOCKED`.

Sanity is read-only. It never:
- deploys code;
- writes application/runtime data;
- changes configuration;
- mutates DEV, TEST or PROD;
- touches LEGACY.

The generated snapshot cannot determine chat-only `UNIQUE` information. The AI performs that comparison from the visible chat before issuing a deletion verdict.

## 10. Verification

```bash
node --test scripts/test_project_sanity.mjs
node --check scripts/project_sanity.mjs
```

Live snapshot generation remains:

```bash
npm run sanity:project -- --output-json project-state/current-project-state.json --output-md project-state/current-project-state.md
```
