# Project Sanity

Status: CANONICAL
Version: v1.1
Applicability: CURRENT
Applies to: BOTH
Effective from: 2026-10-01
Scope: JSCC chat-resume sanity
Implements: #211, #222, #227, #448
Last verified: 2026-10-01

## 1. Goal

Sanity answers one practical question first:

> Is this chat still useful to continue from?

GitHub remains the operational source of truth. The project snapshot is evidence, not the user-facing output.

## 2. What sanity evaluates

When sanity runs, identify in this order:

1. **Ultima interacțiune** - the most recent substantive user↔assistant exchange before the sanity trigger.
2. **Ultima acțiune materială** - the latest concrete project action/decision recorded in this chat.
3. **Subiect** - the narrow working topic, in 3-7 words.
4. **Actualitate** - whether that topic/state is still current against GitHub evidence.
5. **Verdict** - whether to continue here, move elsewhere, or delete the chat.

If the trigger is a bare `sanity`, the command itself is never reported as the last interaction.

`Ultima interacțiune` and `Ultima acțiune materială` are intentionally different:
- interaction = what the user last asked and what the assistant answered/did;
- material action = latest state-changing project operation or decision, which may be older.

If no material action exists, write exactly: `Nicio acțiune materială.`

## 3. Actualitate

Use only:

- `DA` - subject is active and the chat's material state is current.
- `PARȚIAL` - subject is active, but at least one material fact in the chat is stale.
- `NU` - the working basis/topic is no longer current or was superseded.
- `ÎNCHIS` - the subject/action is completed and no further action remains here.

Give one short sentence explaining the classification.

## 4. Verdict

Use only:

- `CONTINUĂ AICI` - this chat remains the right place to continue.
- `MUTĂ ÎN ALT CHAT` - work remains, but this chat is no longer the right scope/basis.
- `POȚI ȘTERGE` - the relevant subject is closed/superseded and no material chat-only information would be lost.

`POȚI ȘTERGE` is fail-closed: any material information that exists only in chat must be persisted first.

## 5. Required default output

Keep the answer short. Each field should normally be one sentence.

```text
SANITY

Ultima interacțiune:
[what the user asked + what the assistant answered/did]

Ultima acțiune materială:
[concrete action, or "Nicio acțiune materială."]

Subiect:
[3-7 words]

Actualitate:
DA | PARȚIAL | NU | ÎNCHIS — [one-sentence reason]

Verdict:
CONTINUĂ AICI | MUTĂ ÎN ALT CHAT | POȚI ȘTERGE
```

Do not add project-wide status sections by default.

## 6. Optional change block

Add this block only when something material changed after the chat's last relevant state:

```text
Schimbat între timp:
[one concise change]
```

Prefer one sentence. Use at most three short bullets only when one line would hide an important distinction.

If nothing relevant changed, omit the block entirely.

## 7. What must stay out of the default answer

Do not include global:
- DEV/TEST/PROD status;
- SHA values;
- release/wave state;
- blocker lists;
- QA lists;
- project summaries.

Include one of these only if it is directly required to explain `Actualitate` or `Verdict`.

Sanity is not a project-status report.

## 8. Evidence and failure behavior

Use the latest successful `Project sanity snapshot` and targeted GitHub evidence as needed.

Workflow: `.github/workflows/project-sanity.yml`
Artifact: `current-project-state`

The workflow is manual-only (`workflow_dispatch`) during the GitHub Actions conservation window. Run it explicitly when a fresh snapshot is required; no push, issue, workflow-run or scheduled event should allocate a sanity runner automatically.

If current evidence cannot be established, do not guess. Return only a concise blocked result:

```text
SANITY — BLOCAT

Motiv:
[why current state cannot be verified]

Verdict:
NU CONTINUA PE BAZA ISTORICULUI ACESTUI CHAT
```

## 9. Safety

Sanity is read-only. It never:
- deploys;
- changes application/runtime data or configuration;
- mutates DEV, TEST or PROD;
- touches LEGACY.

## 10. Verification

```bash
node --test scripts/test_project_sanity.mjs
node --check scripts/project_sanity.mjs
```
