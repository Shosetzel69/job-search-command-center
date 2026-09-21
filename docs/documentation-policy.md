# Documentation Policy - Context Budget and Progressive Disclosure

Status: CANONICAL
Scope: project documentation, Issues, runbooks and AI context loading
Last verified: 2026-09-21

## 1. Goal

Documentation must reduce execution risk without becoming execution overhead.

Core rule:

> Read and maintain only the context required for the current task.

GitHub remains the canonical project state. This policy controls how much of that state is loaded or duplicated for one task.

## 2. Documentation layers

### L0 - Entry / handoff
Examples: README, Issue, PR description, release handoff.

Purpose: explain what is being done and where the authoritative detail lives.

Rule: short, decision-oriented, links instead of copied background.

### L1 - Canonical current-state documentation
Examples: ARCHITECTURE, GOVERNANCE, delivery lifecycle, requirements, data contracts, API/source strategy.

Purpose: current approved state.

Rule: read only the sections relevant to the task. A canonical document is not automatically mandatory reading in full.

### L2 - Operational procedures
Examples: runbooks, QA procedures, migration/cutover procedures.

Purpose: execute one concrete operational procedure safely.

Rule: one procedure, one purpose. Do not embed project history or duplicate architecture.

### L3 - Reference / history
Examples: analysis documents, reports, superseded runbooks, docs/archive.

Purpose: preserve reasoning and evidence.

Rule: never load by default. Read only when explicitly required by the task or when current evidence is insufficient.

## 2.1 Process applicability during AgentFlow transition

Operational/process documentation may temporarily coexist for two process modes:

- `AGENTFLOW`;
- `LEGACY-ADAPTED`.

When a process document is created or materially changed, add where relevant:

`Applies to: AGENTFLOW | LEGACY-ADAPTED | BOTH`

Rules:
- do not mark the legacy document `SUPERSEDED` while active legacy-adapted work still depends on it;
- cross-link successor/predecessor documents instead of merging both processes into one oversized runbook;
- do not mass-retrofit untouched historical documents;
- process applicability is not a replacement for document status (`CANONICAL`, `HISTORICAL`, `SUPERSEDED`).

## 3. AI context loading

Default context for execution:

1. assigned Issue/task;
2. .ai-instructions.md;
3. affected code/configuration;
4. only the relevant sections of canonical documents required by the task.

Do not automatically read all of ARCHITECTURE.md, GOVERNANCE.md or docs/.

Excluded by default:
- docs/archive/**;
- documents marked SUPERSEDED or historical;
- old test reports;
- unrelated analysis;
- unrelated runbooks.

Prefer targeted search and section reads before full-document reads.

If more than 5 supporting documents appear necessary, first reduce the context to a short context map. Do not solve context overload by loading more documents.

## 4. Context map in executable Issues

An Issue handed to an AI should contain, when relevant:

- Required context: exact files/sections required;
- Optional context: only if a question remains;
- Excluded context: historical/superseded material that must not drive execution.

The handoff must be sufficient to act without reconstructing the project from chat history.

## 5. Issue safeguard

Issue title:
- describe the problem or expected result in human-readable language;
- package/wave codes may be secondary, not the only meaning of the title.

Normal executable Issue target: <= 80 lines.
Above 120 lines: split supporting detail into a linked document or sub-Issue unless the Issue is intentionally an umbrella/release record.

Preferred structure:
- Objective;
- Context: 3-5 lines;
- Scope;
- Out of scope;
- Acceptance criteria;
- Required context / references.

Do not copy architecture, governance or runbook content into the Issue.

QA Issues add only the fields needed for safe execution: Executor, Environment, Required capabilities, Preflight, Evidence, Mutations/Rollback and Owner gate where applicable.

## 6. Runbook safeguard

A runbook covers one operational procedure.

Preferred structure:
- Purpose;
- Preconditions;
- Steps;
- Verification;
- Rollback;
- Escalation / stop conditions.

Target: <= 150 lines.
Above 200 lines: review and split by procedure/phase before reuse unless there is a documented reason not to.

A historical runbook must be marked SUPERSEDED or HISTORICAL and point to the current replacement.

Existing oversized documents may remain as reference, but executable tasks must reference exact sections instead of loading them in full.

## 7. Analysis documents

Analysis is decision-support history, not a second current-state manual.

After a decision:
- record the outcome/status and link to the approved Issue/ADR when useful;
- do not continuously synchronize the full analysis document with later implementation details;
- current behavior belongs in canonical current-state documentation.

Do not create an analysis document only to satisfy process.

## 8. Update discipline

Update only documentation materially affected by a change.

Prefer:
- update one canonical source;
- link to it from other places;
- archive/supersede obsolete material.

Avoid:
- copy/paste synchronization;
- documentation-only churn with no material change;
- repeating the same rule in multiple documents.

Periodic documentation review may identify drift, but does not justify automatic rewrites or mass synchronization.

## 9. Safeguard test

Before adding documentation, ask:

1. Is this information needed to execute, decide or operate?
2. Does it already have a canonical home?
3. Can I link instead of duplicate?
4. Will an AI/user know exactly what to read?
5. Am I preserving history instead of mixing it with current state?

If the answer to 2 is yes, update/link the canonical source. Do not create another source of truth.


## 10. Automated enforcement

Pull requests that change Markdown run `.github/workflows/documentation-policy.yml`.

The check:
- evaluates only changed Markdown files;
- skips `docs/archive/**` and documents marked `SUPERSEDED` or `HISTORICAL`;
- warns when an active runbook exceeds 150 lines;
- fails when an active runbook exceeds 200 lines;
- warns when a non-runbook document exceeds 300 lines;
- warns when a runbook omits preferred operational headings.

Executable Development/QA/operations Issues should start from `.github/ISSUE_TEMPLATE/executable-task.yml`.
