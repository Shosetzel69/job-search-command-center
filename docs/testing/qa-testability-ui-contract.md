# QA/Testability UI Contract

Status: **CANONICAL**  
Version: **1.0**  
Approved: **2026-09-21**

## 1. Purpose

This contract defines the minimum UI testability rules for browser-based automated QA in JSCC.

It applies to future UI changes and to QA tickets/runbooks that require autonomous browser interaction in DEV or TEST. PROD keeps its separate safety and owner-gate rules.

The goal is simple: a nominal automated test path must not require a human to operate controls that the browser executor cannot address reliably.

## 2. Scope

Covered:
- React UI interactions used by functional, smoke and E2E tests;
- destructive confirmations;
- temporary test fixture creation and cleanup;
- controls required by Claude Web or another browser executor;
- test authoring rules for future QA tickets.

Not covered:
- Command API semantics;
- authentication policy;
- release/deploy owner gates;
- OS/browser security prompts that are intentionally external to the application;
- executor-specific features such as Playwright dialog hooks.

## 3. Definitions

**DOM-addressable control** - application UI element exposed in the page DOM and operable through stable semantic attributes such as role, accessible name, label or documented test selector.

**Browser-native dialog** - UI created by APIs such as `window.alert`, `window.confirm` or `window.prompt`. It is outside the application DOM.

**System dialog** - OS/browser-owned UI such as native file pickers, permission prompts or certificate dialogs.

**Owner gate** - deliberate human authorization required by governance, security or PROD safety. It is not a testability defect when explicitly declared by the test contract.

**Nominal automated path** - the expected path of a test, including cleanup, when no exceptional security/owner action is required.

## 4. Mandatory UI rules

### 4.1 DOM-first automation surface

Any control required by a nominal automated browser test MUST be DOM-addressable.

A testable UI MUST NOT rely on browser-native or system dialogs for ordinary application actions when the same behavior can be implemented inside the application DOM.

### 4.2 Browser-native dialogs

The following APIs MUST NOT be used in UI flows that are part of autonomous functional/E2E testing:

- `window.confirm`;
- `window.alert`;
- `window.prompt`.

Specialized test frameworks may be able to control these dialogs, but that does not satisfy this contract when independent QA uses a different browser executor.

### 4.3 Destructive confirmations

A destructive action that requires confirmation MUST use an in-app confirmation dialog/modal.

Minimum contract:
- semantic `role="dialog"`;
- `aria-modal="true"`;
- accessible title/name;
- explicit Confirm and Cancel actions;
- deterministic accessible button names;
- contextual message identifying the target when relevant;
- Cancel performs no destructive request;
- Confirm performs the destructive request exactly once;
- dialog closes after the terminal result or exposes the resulting error in the DOM;
- keyboard/focus behavior must not trap automation or accessibility users.

Prefer role + accessible name for automation. Use a stable `data-testid` only when semantic selectors are insufficient.

### 4.4 Stable selectors

Tests SHOULD target semantic roles, labels and accessible names rather than CSS structure or visual position.

A UI change MUST NOT require tests to depend on generated class names, coordinates or text fragments that are not part of the user-facing contract.

### 4.5 Test fixture cleanup

If a DEV/TEST scenario creates a temporary fixture, its normal cleanup path MUST be automatable through the same supported UI/API boundary.

Cleanup MUST NOT introduce an accidental owner interaction.

If cleanup cannot be completed autonomously because of a testability defect, the test stops further mutable actions and reports the cleanup risk explicitly.

## 5. Owner action and legitimate exceptions

Human interaction is valid only when it is intentionally part of the contract, for example:
- explicit PROD GO;
- interactive authentication that cannot be safely delegated;
- security consent owned by the browser/identity provider;
- another owner gate explicitly declared in the QA ticket.

Such steps MUST be marked `OWNER ACTION` in the test contract.

A UI implementation detail MUST NOT be reclassified as `OWNER ACTION` merely because automation cannot operate it.

If a system/native dialog is unavoidable, the feature/ticket MUST document:
- why it cannot be represented in the DOM;
- which executor can operate it;
- the fallback classification when that capability is unavailable.

## 6. QA result classification

When an autonomous UI test encounters an unexpected non-DOM blocker:

- product behavior otherwise correct, but UI is not automatable -> `BLOCKED-TESTABILITY`;
- executor lacks a capability explicitly required by the ticket -> `BLOCKED-CAPABILITY`;
- product behavior contradicts expected functional behavior -> `FAIL`;
- deliberate owner gate reached as designed -> `OWNER ACTION` / test waits only if the ticket permits it.

Do not ask the owner to click through an accidental testability blocker in order to preserve the appearance of automation.

A reproducible `BLOCKED-TESTABILITY` condition requires a defect/change ticket unless an approved exception already exists.

## 7. Contract for future QA tickets

Any QA ticket/runbook containing browser interaction MUST:
- include this document in `Required context`;
- declare executor, environment and browser capability preflight;
- use DOM-addressable controls in the nominal path;
- include cleanup in the scenario, not as an informal manual step;
- identify intentional `OWNER ACTION` separately;
- define `PASS / FAIL / BLOCKED / N/A` and distinguish testability from product failure.

Any Development ticket that introduces or changes a destructive UI action MUST include acceptance criteria for DOM-accessible confirmation and browser automation.

## 8. Review checklist

Before a UI change is READY FOR TEST:
- [ ] nominal actions are DOM-addressable;
- [ ] no new `window.alert/confirm/prompt` is required by the tested flow;
- [ ] destructive confirmation is an in-app accessible dialog;
- [ ] Confirm and Cancel are independently testable;
- [ ] temporary fixture cleanup is autonomous in DEV/TEST;
- [ ] intentional owner gates are explicit;
- [ ] automated frontend tests cover the confirmation semantics where applicable.

## 9. Current known violation

Issue **#257** tracks the current use of browser-native confirmation for:
- Source deletion in `frontend/src/admin-shell.jsx`;
- extensible nomenclature deletion in `frontend/src/nomenclatures-admin.jsx`.

Until #257 is fixed, scenarios that require those dialogs may be `BLOCKED-TESTABILITY` for Claude Web and must not be converted into manual owner cleanup as the normal test path.
