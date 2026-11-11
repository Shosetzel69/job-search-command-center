# ATC-542-01 — Temporary browser experiment exception / R2 Evidence Bundle

Status: **CANDIDATE ONLY — NOT EXECUTION AUTHORIZATION**. Root #544; security #501; AgentFlow 1.4 ESCALATED / IR2.

## Scope and user decision
Owner approved (conversation, 2026-10-25) investigation of one publicly posted OSF Digital job and one publicly posted MADIFF job through a temporary, no-additional-cost browser runtime. Owner subsequently authorized the steps needed for testing, conditional on security review. This is **not** an approval to bypass network restrictions or the original ATC exclusion of browser automation; the Architecture Gate/security exception remains pending explicit documented approval.

No credentials, cookies from accounts, private endpoints, TEST/PROD, deploys, source activation, or persistent service.

## Immutable candidate and review
Repository: Shosetzel69/job-search-command-center, draft PR #573, branch experiment/544-zoho-browser-feasibility. Reviewer must record exact PR HEAD, base-main SHA and all changed file/blob SHAs **after** final edits. Existing R1/R2 REVIEW_FAIL are not superseded. Independent IR2 distinct-reviewer evidence required.

## Mandatory controls / acceptance
- F01: fail if either tenant fails; semantic extraction is *candidate evidence* only, never full completeness certification.
- F02: network **not yet contained**. A fixed navigation URL and Chrome flags do NOT allowlist redirects, scripts, or XHR. GitHub Action MUST fail before browser network activity until an independently reviewed egress control / explicit exception is approved. Do not remove the blocking step by simply changing its exit code.
- F03: bounded stdout/stderr, per-process byte caps with overflow termination.
- F04: isolated profile, no --no-sandbox, process-group kill in finally, job cap 6 min, browser subprocess cap 45s.
- F05: separately approved security/architecture exception needed because initial #544 ATC excluded browser/new runtime; no auto-promotion from this note.
- F06: ONE owner-authorized run maximum. Workflow has fixed repo+main, manual-only dispatch, concurrency without cancellation, and rerun attempt == 1, but **these do not prevent a second fresh run**. Execution remains blocked pending independently enforceable one-use gate, followed by workflow removal via separately reviewed PR.

## Execution record (populate only after authorized execution)
- Reviewed candidate commit / blob SHAs: PENDING
- Baseline main SHA at merge: PENDING
- Independent review evidence / IR2 reviewer: PENDING
- Authorized run ID, run attempt and start/finish timestamp: PENDING
- Public-hosted-runner free eligibility and spend proof: PENDING
- Tenant results: PENDING
- Retiring PR and verification of disabled/deleted workflow: PENDING

## Test coverage and limitations
Synthetic tests under experiments/zoho544/test_browser_probe.py exercise DOM classification, output overflow on both streams, timeout, exit-code and binary-missing paths. They do **not** demonstrate network containment, external page completeness, child-termination verification or the one-run gate. Report these as OPEN, not PASS.

## Rollback
No merge, dispatch or deployment pending review. Once a single authorized run completes, disable and remove workflow by reviewed PR, retain only sanitized outcome/SHAs and cost/usage record.
