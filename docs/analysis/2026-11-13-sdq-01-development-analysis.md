# DA-SDQ-01 — Development Analysis for source data quality

**Process:** AGENTFLOW 1.4
**Phase:** DEVELOPMENT_ANALYSIS
**Status:** READY_FOR_TASK_CONTRACTS (proposed ATCs are NOT executable)
**Root issue:** [#87](https://github.com/Shosetzel69/job-search-command-center/issues/87)
**Requirement and handoff:** [DISC-SDQ-01 / approved DTP](https://github.com/Shosetzel69/job-search-discovery/blob/main/proposals/DTP-DISC-SDQ-01-20261113.md)
**Owner token:** `APPROVE_REQUIREMENT DISC-SDQ-01; APPROVE_TRANSFER DTP-DISC-SDQ-01` (2026-11-13)
**Architecture authority:** [DISC-SDQ-01, D-01..D-06 approved](https://github.com/Shosetzel69/job-search-discovery/blob/main/proposals/jscc-source-data-quality-and-archived-repair-20261113.md)
**Dev analysis baseline:** `main@567c4246f8c9621f2df727e066b9e95f4ed7d449`
**Existing implementation candidate:** [PR #617](https://github.com/Shosetzel69/job-search-command-center/pull/617) head `ab811a216af9c20fa8659dd0a8bbb665aa9aa333`, 19 commits ahead, four altered Python files, unmerged; **no automatic merge authority**
**Analysis date:** 2026-11-13

## 1. Existing mechanisms, observed gaps, reuse decision

| Existing implementation | Verified behavior / gap | Reuse decision |
|---|---|---|
| `scripts/job_search_public_boards.py` (`_linked_job_board`, `_heading_list_board`, specialized adapters) | Card or page context may fill title, description and location simultaneously. Provider-specific JobPosting detail adapters partly exist in PR #617. | Reuse the module and real provider fixtures; change only affected families, never rebuild 166 adapters. |
| `scripts/source_orchestration.py` (`CollectionResult`, `record_results`, `partial`, source_id tagging) | Fetch completion and field quality are separate; success can include unusable content. | Reuse existing partial/error diagnostics and source/run IDs; **do not break the common CollectionResult signature**. |
| `scripts/shared_corpus_repository.py` `prepare_posting`, `project_collection` | Title/company/identity requirements exist; description may be absent or polluted without quality verdict. | Extend the existing projection/validation boundary; no new service or database. |
| `scripts/shared_corpus_repository.py` `_upsert_posting`, `_advance_lifecycle` and `persist_collection` | Existing posting/canonical JSON and fields can be replaced with worse incoming values; incomplete source lifecycle suppression exists for projection misses. | Reuse identity and lifecycle rules, extend quality suppression and non-degradation. |
| `command-api/src/multiuser-repository.js` `/me/jobs` | Selects a posting by lifecycle and recency; no quality-based preference; `archived_at` is independent profile-owned state. | Only if source/canonical quality reconciliation proves necessary, adjust the existing deterministic SQL selection and test; no new API. |
| `evaluation_basis_hash` / `job_version` | Semantic changes can invalidate cached personal evaluation. | Preserve existing versioning; no FIT algorithm changes. |

**No new mechanism is needed:** the proposal extends the existing collector result, projection, per-posting payload, upsert and lifecycle controls. A small pure quality evaluator within the existing Python data flow is allowed if it demonstrably avoids duplicated checks; it must not require a new runtime component, external dependency or parallel persistence.

## 2. Architecture delta check (against ARCHITECTURE.md)

- Existing ADR-005 shared `canonical_jobs` / `source_postings` ownership remains unchanged; profile state stays in isolated tenant data through ADR-008.
- No new datastore, new scheduler, cross-tenant personal query, second provider pipeline, extra service or env binding is required by the approved design.
- `ARCHITECTURE.md` `10 treats a change to the **shared connector contract** as an architecture trigger. The implementation MUST preserve `CollectionResult`'s stable constructor/signature and existing `partial` semantics; any requirement to change it materially requires an architecture return, not an assumed authorization.
- Adding provenance/quality metadata to the existing payload is compatible in principle with the approved design, but the author must check current JSON consumers before finalizing the ATC implementation. No DB migration is assumed; if necessary, it is a stop condition and a separately approved per-environment change.
- Shared writes must not be mixed with tenant-aware personal writes. Historical archive repair must use approved shared corpus write paths plus **read-only**, authorized, tenant-scoped personal checks; any personal-content write is outside scope.
- Release target DEV only; no policy activation, JobsPipe override or TEST/PROD promotion.
**Architecture delta verdict:** `NO_NEW_ARCHITECTURE_DECISION_FOR_PROPOSED_SLICES`, conditional on preserving these boundaries. Canonical repo architecture must reference the already approved decision when a reviewed implementation updates relevant documentation; no duplicate ADR or new acronym is proposed.

## 3. Dependency-aware implementation slices

| Slice | Proposed ATC | Files / modules likely affected | Exit condition |
|---|---|---|---|
| M1 — deterministic field-quality decision | `ATC-SDQ-01-01` | `scripts/shared_corpus_repository.py`, `scripts/source_orchestration.py` and existing tests | source/run/posting-level `VALID/INCOMPLETE/INVALID`, provenance; no invented fields |
| M3 — non-degradation and lifecycle guard | `ATC-SDQ-01-02` | `scripts/shared_corpus_repository.py`, tests; conditional `command-api/src/multiuser-repository.js` if projection proof requires | worse posting cannot replace better, stable identities, partial source never false-inactivates |
| M2a — demonstrated provider fixes | `ATC-SDQ-01-03` | `scripts/job_search_public_boards.py`, relevant current tests; reuse exact reviewed PR #617 deltas | Luxoft, Stripe, Crossover, Orange provider-specific field proof and negative fixtures |
| M2b — other structural-risk families | `ATC-SDQ-01-04` (analysis and bounded family fixes) | Only verified affected adaptors/tests, scoped by family | source-by-source evidence and reviewed patches; no blanket 48-source rewriting |
| M4 — DEV release acceptance | `ATC-SDQ-01-05` | Existing build/deploy scripts, CI, report evidence, no unapproved infra extension | independent review, exact digests, paired Service+Search Job, fresh Retrieve/Nile/API/UI evidence |
| M5a — historical read-only inventory and dry-run | `ATC-SDQ-01-06` | existing tenant gateway/shared corpus reads; preferably no product code | tenant-scoped inventory, immutable plan, write-free dry-run |
| M5b — historical batch write | `ATC-SDQ-01-07` (conditional) | approved existing shared write path and narrowly bounded repair tests | separately authorized writes, idempotency, before/after and rollback |

**Sequence:** 01 → 02 and 03 → 05 initial DEV gate → 04 family remediations → 05 final DEV gate → 06 → 07. Do not run 07 on the strength of DTP, ATC approval or an unapproved dry-run alone.

## 4. Targeted technical risk analysis

**Quality false positives:** legitimate short descriptions and international multi-site roles exist; length is an investigation flag, not invalidity. Multi-location fields may be lengthy and correct.

**Incorrect origin/mapping:** job URL and provider-specific JobPosting must match the canonical record. UI markup and adjacent card text may be different jobs; reject field contamination rather than generating plausible text.

**Duplicate or destructive persistence:** `_upsert_posting` updates source payload and canonical fields; preserving `posting_id`/`job_id` across stronger/weaker observations is mandatory. Multiple source postings may feed one canonical job; API's current lateral posting selection is recency/lifecycle based. Review per-source versus canonical quality before changing the read projection.

**Lifecycle regression:** a collection with rejected records must not be interpreted as complete for the source; tie quality rejection to existing `incomplete_source_ids` or `global_projection_gap` and test the existing transition `ACTIVE → UNCONFIRMED → INACTIVE`.

**Historical retention/security:** archive state is in `profile_job_state.archived_at`. A collector fix does not automatically reprocess stored archives, and unauthed `/me/jobs?include_archived=true` returns 401. A later inventory requires server-resolved, authorized tenant context; no admin bypass.

**PR #617 scope / review:** the PR includes more than Luxoft/Stripe and has no independent EXACT-SHA verdict recorded here. Review and salvage the exact needed patches; do not silently merge unrelated work or represent isolated tests as production E2E.

**Operational:** actual DEV build/deploy and Nile writes are privileged operations. The available sandbox is not equivalent to a Cloud Build/Cloud Run deployment operator; deploy authorization and rollback remain separate gates.

## 5. Test context and evidence policy

Relevant existing suites verified in repo:
- `scripts/test_public_boards.py` and `scripts/test_workday_connector.py`;
- `scripts/test_shared_corpus_repository.py` and `scripts/test_source_orchestration.py`;
- `command-api/test/multiuser.test.mjs` if canonical posting selection/UI projection changes.

**Review independence:** implementation executor does not issue its own PASS. Review by an independent tester (Claude) against the exact candidate SHA, all mapped ACs, CI, and negative fixtures; code-reviewed green unit tests are not Nile/UI acceptance.

Evidence policy per proposed ATC: `ARTIFACT_OR_REPRODUCIBLE` for pure logic, `BOTH_REQUIRED` for schema/provider-sensitive Nile evidence, deploy provenance and tenant-scoped repair.

## 6. Acceptance mapping and coverage plan

| Requirement | ATC(s) | Status before implementation |
|---|---|---|
| SDQ-01 social-sharing contamination | 01, 03, 04 | NEIMPLEMENTAT for approved requirement; prior isolated code in PR #617 unmerged |
| SDQ-02 complete job-specific description | 01, 03, 04 | PARȚIAL — PR #617 has unmerged provider fixes |
| SDQ-03 independent location/salary | 01, 03, 04 | PARȚIAL — Luxoft/Stripe fixed only in unmerged candidate, Crossover open |
| SDQ-04 dates / URL / identity | 01, 03, 04 | PARȚIAL — existing identity rules and candidate path checks, no accepted E2E |
| SDQ-05 quality outcome / provenance | 01 | NEIMPLEMENTAT |
| SDQ-06 non-degradation | 02 | NEIMPLEMENTAT |
| SDQ-07 partial lifecycle | 02 | PARȚIAL — existing suppression handles projection skips but not full quality rejection |
| SDQ-08 idempotent repair | 02, 07 | NEIMPLEMENTAT for historical repair |
| SDQ-09 archived/user isolation | 06, 07 | NEIMPLEMENTAT for repair; existing profile ownership is present |
| SDQ-10 source → Nile → API → UI | 05, 07 | NEIMPLEMENTAT for quality acceptance |
| SDQ-11 disabled-source / access protections | 01, 03, 04, 05 | PARȚIAL — existing controls, must re-prove unchanged |

Status classifications refer specifically to new SDQ-01 acceptance and do not revoke previous unrelated feature acceptance.

## 7. Review gate and stop conditions

**Verdict:** `READY_FOR_TASK_CONTRACTS`; contract proposals are separate from implementation authorization.

**Stop and return to owner / Architecture Gate** on: required shared connector interface break, different data authority/tenancy, DB schema change, new privileged service, new recurring cost, new privacy exposure, provider access bypass, or inability to preserve existing identity/lifecycle. For M5 writes: stop until explicit durable approval of exact dry-run plan and rollback.

**Concurrent main delta observed 2026-11-13:** after this analysis branch was created, §main§ advanced by one unrelated frontend-only commit affecting §frontend/src/job-page-model.mjs§, §frontend/src/main.jsx§ and three existing frontend tests. This does **not** change the verified source/persistence findings, but main SHA and integration conflict status must be rechecked immediately before any ATC implementation or PR #617 reuse. The analysis branch itself remains documentation-only and intentionally does not merge/rebase a concurrent implementation.

**No work performed:** no source code changed on `main`/PR #617, no tests or deploy executed as part of this Development Analysis, no data reads/writes of personal Nile rows.
