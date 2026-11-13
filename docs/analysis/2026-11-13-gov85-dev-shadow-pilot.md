# GOV-85 — DEV governance simplification (M0-M2 shadow pilot)
Status: HISTORICAL
Version: v0.1
Applicability: HISTORICAL_ONLY — M0-M2 evidence
Applies to: AGENTFLOW (historical shadow analysis; current DEV policy is GOVERNANCE.md §11)
Date: 2026-11-13
Root issue: #623
Baseline: `main@ce9206644c4d0556b3852dfe50a6717ebd5c4615`
Owner authorization: `APPROVE_GOV85_DEV_PILOT` — M0-M2 only

> **HISTORICAL M0-M2 EVIDENCE (as of pre-M3 approval).** GOV85-DEV was subsequently activated by the owner on 2026-11-13; the operative policy is `GOVERNANCE.md` §11. This dated original study remains non-authoritative and is not an operational gate. **NON-AUTHORITATIVE.** This is a proposed administrative view, not a change to effective approvals, release routing, pipeline, status semantics or environmental authority. Until separate M3 approval, the canonical Phase/Status in `GOVERNANCE.md` section 2.8 and `docs/software-delivery-lifecycle.md` remain controlling. Never execute a command based on shadow state alone.

## M0. Verified baseline and measurement

Read-only repository checks at the commit above:
- `GOVERNANCE.md` §2.8 lists **15 phases and 62 distinct canonical statuses**; its nominal sequence has **19 states**.
- `docs/agentflow.md` separates approved requirement, transfer, architectural gate, Development Analysis, ATC authorization, implementation, Evidence Bundle, independent review and release handoff.
- `docs/software-delivery-lifecycle.md` controls **G1-G5** and **EFA-01..EFA-17**, exact candidate identity, immutable digest, DEV→TEST→PROD and explicit PROD_GO.
- `cloudbuild.promotion.yaml` and `scripts/gcp/promote.sh` intentionally terminate via `exit 86`; `command-api/BUILD_TRIGGER.md` still names this blocked path as authoritative for DEV/TEST. GOV-85 cannot remove/bypass the block. A separately reviewed DEV-safe delivery route is required.
- Real-world comparison cases: #515/#615 (mobile / preparation-only); #616 (merged frontend pagination; DEV E2E still to verify); #87/#620/#621 (source-quality candidate, exact-SHA reviewer verdict).
- Baseline administrative actions/minutes per release: **NOT MEASURED**. Count phase/status vocabulary does **not** prove a real 85% reduction in time. Establish measured touches and elapsed administrative time on 3-5 comparable completed deliveries before acceptance.

| Structural measure | Current | Proposed | Reduction |
|---|---:|---:|---:|
| Administrative tracking phases | 15 | 3 | 80.0% |
| Administrative states | 62 | 9 | 85.5% |
| Nominal tracking states | 19 | 3 | 84.2% |

These are design metrics, **not** removal of release gates or technical checks.

## M1. Proposed administrative model

Three administrative phases:
1. `DEFINE`: requirements, architecture-if-triggered, analysis, bounded ATC and explicit owner authorization.
2. `EXECUTE`: implementation, tests, evidence references and independent exact-SHA review, preserving implementer/reviewer separation.
3. `RELEASE`: DEV readiness/functional acceptance, candidate identity, TEST/PROD stages when separately authorized, rollback and closure. **In the current pilot only DEV observations may be recorded; TEST/PROD operations are excluded.**

Nine proposed **administrative** states (not release verdicts):
`PROPOSED`, `APPROVED`, `IN_PROGRESS`, `READY`, `BLOCKED`, `CHANGES_REQUIRED`, `VERIFIED`, `ACCEPTED`, `CLOSED`.
`ACCEPTED` is a future administrative milestone only after documented functional acceptance; it is intentionally **not** inferred from any canonical technical PASS. It has no direct mapping from the 62 original states.

### Full 62→9 read-only status crosswalk

| Canonical phase | Canonical status | Shadow phase | Shadow admin state |
|---|---|---|---|
| `REQUIREMENTS` | `IDEA` | `DEFINE` | `PROPOSED` |
| `REQUIREMENTS` | `REQUIREMENT_ANALYSIS` | `DEFINE` | `IN_PROGRESS` |
| `REQUIREMENTS` | `REQUIREMENT_READY_FOR_APPROVAL` | `DEFINE` | `READY` |
| `REQUIREMENTS` | `REQUIREMENT_APPROVED` | `DEFINE` | `APPROVED` |
| `REQUIREMENTS` | `REQUIREMENT_CHANGES_REQUIRED` | `DEFINE` | `CHANGES_REQUIRED` |
| `REQUIREMENTS` | `REQUIREMENT_DEFERRED` | `DEFINE` | `CLOSED` |
| `REQUIREMENTS` | `REQUIREMENT_REJECTED` | `DEFINE` | `CLOSED` |
| `ARCHITECTURE` | `ARCHITECTURE_REVIEW` | `DEFINE` | `IN_PROGRESS` |
| `ARCHITECTURE` | `ARCHITECTURE_READY_FOR_APPROVAL` | `DEFINE` | `READY` |
| `ARCHITECTURE` | `ARCHITECTURE_APPROVED` | `DEFINE` | `APPROVED` |
| `ARCHITECTURE` | `ARCHITECTURE_CHANGES_REQUIRED` | `DEFINE` | `CHANGES_REQUIRED` |
| `ARCHITECTURE` | `ARCHITECTURE_BLOCKED` | `DEFINE` | `BLOCKED` |
| `DEVELOPMENT_ANALYSIS` | `DEVELOPMENT_ANALYSIS` | `DEFINE` | `IN_PROGRESS` |
| `DEVELOPMENT_ANALYSIS` | `DEVELOPMENT_ANALYSIS_BLOCKED` | `DEFINE` | `BLOCKED` |
| `DEVELOPMENT_ANALYSIS` | `READY_FOR_TASK_CONTRACTS` | `DEFINE` | `READY` |
| `TASK_CONTRACT` | `TASK_CONTRACT_DRAFT` | `DEFINE` | `IN_PROGRESS` |
| `TASK_CONTRACT` | `TASK_CONTRACT_PROPOSED` | `DEFINE` | `PROPOSED` |
| `TASK_CONTRACT` | `TASK_CONTRACT_CHANGES_REQUIRED` | `DEFINE` | `CHANGES_REQUIRED` |
| `TASK_CONTRACT` | `TASK_CONTRACT_APPROVED` | `DEFINE` | `APPROVED` |
| `IMPLEMENTATION` | `IMPLEMENTATION_AUTHORIZED` | `EXECUTE` | `APPROVED` |
| `IMPLEMENTATION` | `IMPLEMENTING` | `EXECUTE` | `IN_PROGRESS` |
| `IMPLEMENTATION` | `IMPLEMENTATION_BLOCKED` | `EXECUTE` | `BLOCKED` |
| `IMPLEMENTATION` | `IMPLEMENTATION_FAILED` | `EXECUTE` | `CHANGES_REQUIRED` |
| `IMPLEMENTATION` | `IMPLEMENTATION_COMPLETE` | `EXECUTE` | `READY` |
| `EVIDENCE` | `EVIDENCE_PREPARING` | `EXECUTE` | `IN_PROGRESS` |
| `EVIDENCE` | `EVIDENCE_READY` | `EXECUTE` | `READY` |
| `EVIDENCE` | `EVIDENCE_INCOMPLETE` | `EXECUTE` | `CHANGES_REQUIRED` |
| `REVIEW` | `REVIEW_PENDING` | `EXECUTE` | `READY` |
| `REVIEW` | `REVIEW_IN_PROGRESS` | `EXECUTE` | `IN_PROGRESS` |
| `REVIEW` | `REVIEW_PASS` | `EXECUTE` | `VERIFIED` |
| `REVIEW` | `REVIEW_FAIL` | `EXECUTE` | `CHANGES_REQUIRED` |
| `REVIEW` | `REVIEW_BLOCKED` | `EXECUTE` | `BLOCKED` |
| `DEV` | `DEV_PENDING` | `RELEASE` | `READY` |
| `DEV` | `DEV_IN_PROGRESS` | `RELEASE` | `IN_PROGRESS` |
| `DEV` | `DEV_PASS` | `RELEASE` | `VERIFIED` |
| `DEV` | `DEV_FAIL` | `RELEASE` | `CHANGES_REQUIRED` |
| `DEV` | `DEV_BLOCKED` | `RELEASE` | `BLOCKED` |
| `CANDIDATE` | `CANDIDATE_READY` | `RELEASE` | `READY` |
| `CANDIDATE` | `CANDIDATE_FROZEN` | `RELEASE` | `READY` |
| `CANDIDATE` | `CANDIDATE_INVALIDATED` | `RELEASE` | `CHANGES_REQUIRED` |
| `TEST` | `TEST_PENDING` | `RELEASE` | `READY` |
| `TEST` | `TEST_IN_PROGRESS` | `RELEASE` | `IN_PROGRESS` |
| `TEST` | `TEST_PASS` | `RELEASE` | `VERIFIED` |
| `TEST` | `TEST_FAIL` | `RELEASE` | `CHANGES_REQUIRED` |
| `TEST` | `TEST_BLOCKED` | `RELEASE` | `BLOCKED` |
| `RELEASE` | `RELEASE_PENDING` | `RELEASE` | `IN_PROGRESS` |
| `RELEASE` | `RELEASE_READY` | `RELEASE` | `READY` |
| `RELEASE` | `RELEASE_BLOCKED` | `RELEASE` | `BLOCKED` |
| `PROD_GATE` | `PROD_GO_PENDING` | `RELEASE` | `READY` |
| `PROD_GATE` | `PROD_GO` | `RELEASE` | `APPROVED` |
| `PROD_GATE` | `PROD_NO_GO` | `RELEASE` | `BLOCKED` |
| `PROD_DEPLOY` | `PROD_DEPLOYING` | `RELEASE` | `IN_PROGRESS` |
| `PROD_DEPLOY` | `PROD_DEPLOYED` | `RELEASE` | `IN_PROGRESS` |
| `PROD_DEPLOY` | `PROD_DEPLOY_FAILED` | `RELEASE` | `BLOCKED` |
| `PROD_SMOKE` | `PROD_SMOKE_PENDING` | `RELEASE` | `READY` |
| `PROD_SMOKE` | `PROD_SMOKE_PASS` | `RELEASE` | `VERIFIED` |
| `PROD_SMOKE` | `PROD_SMOKE_FAIL` | `RELEASE` | `CHANGES_REQUIRED` |
| `PROD_SMOKE` | `PROD_SMOKE_BLOCKED` | `RELEASE` | `BLOCKED` |
| `CLOSURE` | `DONE` | `RELEASE` | `CLOSED` |
| `CLOSURE` | `DEFERRED` | `RELEASE` | `CLOSED` |
| `CLOSURE` | `CANCELLED` | `RELEASE` | `CLOSED` |
| `CLOSURE` | `SUPERSEDED` | `RELEASE` | `CLOSED` |

**Orthogonal fields are mandatory** whenever mapping would otherwise collapse distinct semantics:
`canonical_process`, `canonical_phase`, `canonical_status`, `root_issue`, `scope/ATC`, `risk`, `actor_identity`, `candidate_sha`, `artifact_digests`, `environment`, `gate_id`, `gate_verdict`, `owner_approval_reference`, `blocked_by`, `disposition`, `evidence_url`, `rollback_reference`.

Explicit semantic guards:
- `REVIEW_PASS`, `DEV_PASS`, `TEST_PASS`, `PROD_SMOKE_PASS` -> shadow `VERIFIED` **plus original distinct gate event**; no gate equivalence, no implicit functional acceptance.
- `CANDIDATE_FROZEN` -> `READY` with frozen exact SHA event; any SHA change invalidates applicable evidence.
- `PROD_DEPLOYED` -> `IN_PROGRESS` with deployment event, not `VERIFIED` or `ACCEPTED`.
- `PROD_GO` -> `APPROVED` plus explicit **owner PROD_GO token**, never an inferred action.
- `DEFERRED/CANCELLED/SUPERSEDED/REJECTED` -> `CLOSED` **with exact disposition retained**; reopening requires a new applicable authorization.
- `BLOCKED` requires original blocker reason and affected gate; a failing test must never be translated into an accepted release.
- A noncanonical/missing source status (e.g. #515 `REQUIREMENTS_DEFINED`) is **UNMAPPED**, not guessed. Record a shadow exception, retain the canonical source untouched, and resolve its ownership before future migration.
- Any mismatch between issue body and subsequent exact-SHA reviewer evidence must be reported as a conflict. For #621 the original body contains R2 FAIL; the later comment contains R3 PASS for a **different SHA**. Never flatten this to unconditional PASS.

### Authorization and safety remain exactly as before

- `APPROVE_REQUIREMENT` / `APPROVE_TRANSFER` / `APPROVE_TASK_CONTRACT`, architectural review triggers and scoped stop conditions are unchanged. GOV-85 owner pilot approval is **not** an ATC implementation token.
- Independent review is an actual separate reviewer/actor and exact candidate SHA. A Claude-written review posted with the owner's token requires explicit identity provenance; GitHub actor alone cannot prove independent agency.
- Tenant isolation, ADR-005, `npm run check:tenant-boundary`, `CollectionResult`, SDQ-01, security/privacy/secret gates and Retrieve concurrency remain unchanged.
- Release gates G1-G5, EFA-01..17, candidate source+runtime identity, immutable Service/Job images, DB/IAM readiness, environment isolation, smoke and rollback are unchanged; `N/A` remains explicitly justified.
- `exit 86` guards, `JSCC_RUNTIME_BACKEND` policy, CI/network-dependent tests and lockfile issues are **separate technical remediations**; governance simplification supplies no technical waiver.
- #574 parked scope and #593 MAX_FILES=80 guard stay unchanged. No TEST/PROD operation is authorized.

## M2. Read-only shadow cases, verified from existing GitHub records

| Case | Current evidence (not mutated) | Shadow-only reading | Missing or guarded evidence |
|---|---|---|---|
| #515 / PR #615 | #515 contains noncanonical `REQUIREMENTS_DEFINED`; #615 is preparation-only, open/draft; no DEV deploy permission from its PR | `DEFINE / UNMAPPED` for #515; `EXECUTE / IN_PROGRESS` for documentation preparation as a descriptive view, not issue rewrite | Reconcile #515 canonical status; no build/deploy/acceptance inference |
| PR #616 | Merged pagination source to `main` (merge SHA `58074d66...`) | `EXECUTE / VERIFIED` only if exact-SHA review evidence is retained; DEV gate `PENDING/UNKNOWN` until measured | Authenticated DEV E2E, exact runtime Service/Job identity and scope checks |
| #87 / PR #620 / #621 | PR #620 merged to `main@ce9206644c4d0556b3852dfe50a6717ebd5c4615`; #621 R2 FAIL at `91ed389...`, later R3 PASS at `a83332c...` | `EXECUTE / VERIFIED` for R3 reviewed source only; later `RELEASE / READY` cannot mean DEV PASS | Distinguish reviewer identity from posting credential; prove DEV EFA separately |
| #623 | GitHub read on 2026-11-13 (issue last updated 16:33:38 UTC): `Phase: REVIEW` / `Status: REVIEW_PENDING`; owner approved M0-M2 only | `EXECUTE / READY` (shadow only; canonical status unchanged) | No pilot activation M3; no merge permitted |

These shadow readings are **analyst annotations only**, not machine statuses, independent verdicts, deployment authorizations or updates to referenced issues.

## Review protocol and acceptance

For M1 PR review on exact head SHA, reviewer verifies:
1. Only documentation files changed; no code, workflow, Cloud Run, DB, IAM or secrets changes.
2. All 15 phases and 62 canonical statuses mapped exactly once, with lossless original semantics preserved as orthogonal fields. Detect noncanonical statuses, do not auto-normalize them.
3. All controls G1-G5, EFA, explicit owner tokens, architecture triggers, tenant/SDQ/Retrieve, independent review and rollback remain effective.
4. New model is non-authoritative/shadow-only; rollout guards and TEST/PROD remain untouched.
5. Pilot exit data needed: counted admin handoffs/touches and elapsed admin time against matched baseline; regression/incident/rollback checks; 3-5 deliveries; no waived critical control.
6. Independent reviewer identity differs from implementer; posting through the owner's GitHub token cannot alone establish independence.

**Stop at M3 decision:** A separate explicit owner authorization is mandatory to activate GOV-85 for any DEV task. No auto-merge, build or deploy is permitted through M0-M2.

Refs: #623; `GOVERNANCE.md` §2.8 and §2.9; `docs/agentflow.md`; `docs/software-delivery-lifecycle.md`.
