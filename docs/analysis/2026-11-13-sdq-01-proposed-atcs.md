# Proposed Agent Task Contracts — DISC-SDQ-01

**Artifact ID:** `ATC-PACK-SDQ-01-R1`
**Root issue:** [JSCC #87](https://github.com/Shosetzel69/job-search-command-center/issues/87)
**Approved requirement:** [DTP-DISC-SDQ-01](https://github.com/Shosetzel69/job-search-discovery/blob/main/proposals/DTP-DISC-SDQ-01-20261113.md)
**Approved architecture:** [DISC-SDQ-01, D-01..D-06](https://github.com/Shosetzel69/job-search-discovery/blob/main/proposals/jscc-source-data-quality-and-archived-repair-20261113.md)
**Development Analysis:** [DA-SDQ-01](./2026-11-13-sdq-01-development-analysis.md)
**Framework:** AgentFlow 1.4.0; `docs/agentflow.md` `8 and `GOVERNANCE.md`
**State:** `TASK_CONTRACT_PROPOSED / NOT_APPROVED / NOT_EXECUTABLE`
**Baseline:** `main@567c4246f8c9621f2df727e066b9e95f4ed7d449`; recheck HEAD and diff at start of execution.
**Prior code:** PR #617 head `ab811a216af9c20fa8659dd0a8bbb665aa9aa333` (open, not merged); reuse only reviewed, in-scope deltas.

## Contract-wide invariants

- DEV-only development branch; no edits in TEST/PROD, no production or tenant-user data reads in development; no unauthorized Nile write/migration.
- Source registration/operational disable is preserved, including JobsPipe and every explicitly deferred/blocked/policy-excluded source.
- No provider restrictions bypass (robots, CAPTCHA, TLS, rate limits, credentials, same-host).
- No speculative enrichment, role FIT/ATS scoring modifications or automated assertion that sampled data is exhaustive.
- No new package, service, database table, scheduled job, or material common `CollectionResult` interface change unless independently approved.
- Use existing failure/partial handling, per-record identity and shared/personal boundaries.
- Review/executor separation: independent Claude review of exact SHA; no self-reported PASS as independent sign-off.
- Each task: retry limit **2 focused remediation cycles**. Exceeding the limit requires a distinct review of findings and owner decision. Fix only reported finding IDs.
- Every evidence record must be self-contained with unique `EVD-SDQ-01-XX` identifier and exact SHA, tests/commands, changes and negative proof, rather than an ever-growing ticket comment.
- If a task touches more than five files, report coherence verification: import/interface parity, versioned contracts, docs and cross-file references.
- Before requesting independent review, enumerate its own mapped ACs as IMPLEMENTAT / PARȚIAL / NEIMPLEMENTAT / AMÂNAT and cite a file/section or reproducible command for each IMPLEMENTAT.

## ATC-SDQ-01-01 — Deterministic shared job-field quality gate (M1)

**Status:** PROPOSED, implementation not authorized.
**Parent:** #87; DTP `SDQ-01..05, SDQ-11`.
**Objective:** classify normalized observations with honest field provenance; prevent known UI/card contamination from being represented as verified job content.
**Scope:** extend `scripts/shared_corpus_repository.py` `prepare_posting` / `project_collection` and `scripts/source_orchestration.py` existing diagnostics, with focused tests in `scripts/test_shared_corpus_repository.py` / `scripts/test_source_orchestration.py`. Prefer a small pure helper in an existing file unless testability proves otherwise. Preserve `CollectionResult` constructor/signature. Define `VALID / INCOMPLETE / INVALID` and stable issue codes, per-field provenance, job identity/run/source references, and a fail-closed unknown provenance.
**Out:** per-provider parser implementation; database schema change; UI changes; FIT/ATS scoring; historic data mutation.
**Dependencies:** approved DISC-SDQ-01/DTP and DA; none of the subsequent ATCs.
**Acceptance / verification:**
- `Q1-AC1 (SDQ-01, SDQ-02)`: mocked Luxoft/Stripe/Crossover social share, adjacent-card and same-title-as-description cases are rejected or explicitly incomplete; legitimate short text is not auto-rejected by a hard size rule.
- `Q1-AC2 (SDQ-03, SDQ-04)`: salary-as-location, invented/future date and invalid URL cannot be promoted as trusted provider fields; legitimate multi-site location is retained.
- `Q1-AC3 (SDQ-05)`: each verdict carries stable field issue codes/provenance and source/run identity without leaking secrets; existing `partial` outcome remains compatible.
- `Q1-AC4 (SDQ-11)`: registry operational flags, JobsPipe mode and provider access constraints unchanged.
**Proof requested:** `python3 -m unittest scripts.test_shared_corpus_repository scripts.test_source_orchestration` or equivalent exact existing test commands, path-level diff, fixture/vs verdict matrix, exact SHA, independent review.
**Stop:** a breaking `CollectionResult` interface, unknown lineage that would force fabricated provenance, new DB column, or false rejection of valid multi-location/short descriptions.
**Impact declaration:** DEV Python only; no env vars, secrets, DB schema, deps or non-collection modules by default.
**Evidence:** `EVD-SDQ-01-01`, policy `ARTIFACT_OR_REPRODUCIBLE`.
**Commit message:** `feat(#87): add deterministic source job field quality validation`.

## ATC-SDQ-01-02 — Nile non-degradation and lifecycle safety (M3)

**Status:** PROPOSED; depends on reviewed accepted implementation from 01.
**Parent:** #87; `SDQ-05..08, SDQ-11`.
**Objective:** ensure weaker/invalid data never overwrites a valid posting/canonical job and that partial sources cannot falsely expire known jobs.
**Scope:** `scripts/shared_corpus_repository.py` `persist_collection`, `project_collection`, `_upsert_posting`, `_advance_lifecycle`, existing tests. If needed for demonstrated canonical-selection consistency only, scope the existing `command-api/src/multiuser-repository.js` lateral source posting selection and `command-api/test/multiuser.test.mjs`. Use existing payload and stable IDs.
**Out:** new identity algorithm, new database table, personal data SQL, tenant scope changes, broad API refactor, unrequested post retention changes.
**Dependencies:** 01 reviewed and approved; current provider-supported Nile testing-container contract before any managed-DEV DB mutation.
**Acceptance / verification:**
- `Q2-AC1 (SDQ-06)`: good→bad and bad→good repeated source observations preserve best grounded data deterministically, including ordering permutations and different source postings of one canonical job.
- `Q2-AC2 (SDQ-07)`: quality-rejected and globally incomplete source batches suppress `ACTIVE→UNCONFIRMED→INACTIVE`; unrelated complete sources still advance correctly.
- `Q2-AC3 (SDQ-08)`: `source_id`/`external_job_id`/canonical URL identity, posting/job UUIDs and first-seen history preserved across valid upgrades.
- `Q2-AC4 (SDQ-05)`: per-source rejected/accepted metrics and errors survive persistence reporting without false `success`.
- `Q2-AC5 (SDQ-11)`: no new schema, database binding or secret, except by new approval.
**Proof requested:** `scripts/test_shared_corpus_repository.py` regression assertions with mocked transactions; official Nile test-container evidence for provider-sensitive SQL before managed DEV; SQL/query diff; exact SHA and independent review.
**Stop:** DB migration, newly required cross-plane FK, mixed shared-write/tenant-write transaction, provider incompatible SQL or source registry write.
**Impact:** Python data path; optional existing API query/test. `APP_ENV`/`NILE_DATABASE_URL` unchanged; DB schema none unless separately approved. Test container only until promoted.
**Evidence:** `EVD-SDQ-01-02`, policy `BOTH_REQUIRED` where provider-sensitive SQL is touched, otherwise `ARTIFACT_OR_REPRODUCIBLE`.
**Commit message:** `fix(#87): protect canonical postings from degraded source updates`.

## ATC-SDQ-01-03 — Proven provider defects and PR #617 salvage (M2a)

**Status:** PROPOSED, depends on 01 (and 02 before accepted persistence).
**Parent:** #87; `SDQ-01..04, SDQ-11`.
**Objective:** replace proven field contaminations with source-specific verified detail extraction; reuse existing unmerged fixes rather than duplicate code.
**Scope:** `scripts/job_search_public_boards.py`, `scripts/test_public_boards.py` and, only for pre-existing PR #617 review findings on the approved relevant behavior, `scripts/job_search_workday.py` / `scripts/test_workday_connector.py`. Priority provider examples: Luxoft title/description/location, Stripe cross-card location/description, Crossover salary/location, Orange Softgarden blank description. Validate first-party URL and real payload for each. Reconcile existing PR #617 tests with the shared quality gate; cherry-pick/merge only exact reviewed in-scope deltas with explicit PR disposition.
**Out:** enabling source flags, bypass blocked providers, wholesale PR #617 merge without exact-SHA review, redesign of remote search/filtering, unrelated provider refactors.
**Dependencies:** 01 and quality acceptance contract; 02 before production-like persistence; provider legal accessible detail contract; independent review required for existing candidate.
**Acceptance / verification:**
- `Q3-AC1`: Luxoft expected title and Bucharest from its actual job URL, full description, no share widgets; Stripe title matches detail and multiple authentic locations; no cross-card substitutions.
- `Q3-AC2`: Crossover description/salary/location are independent provider fields; unresolved details marked incomplete rather than invented.
- `Q3-AC3`: Orange description is filled from verified provider detail or reported incomplete; Polish jobs must not be labeled Romania without source-backed evidence.
- `Q3-AC4`: direct URL, identity, date policy, robots/TLS/rate limiting and inactive source flags remain intact; authentic multi-site jobs pass.
**Proof:** `scripts/test_public_boards.py` and provider-specific existing tests with sanitized real fixtures; read-only public detail comparison on selected roles; exact-SHA independent review of PR #617 delta, per-source before/after logs.
**Stop:** source forbids detail access; no authoritative method; candidate includes unapproved extra behavior; unreviewed additional dependencies; source explicit disable.
**Impact:** existing Python collectors and tests, DEV-only; no schema/config/secrets/DB changes.
**Evidence:** `EVD-SDQ-01-03`, policy `ARTIFACT_OR_REPRODUCIBLE`.
**Commit message:** `fix(#87): use verified job-detail fields for affected sources`.

## ATC-SDQ-01-04 — Remaining structural-risk source-family investigation (M2b)

**Status:** PROPOSED as **read-only bounded analysis**, not blanket implementation of 48 parsers.
**Parent:** #87; `SDQ-01..05, SDQ-11`.
**Objective:** verify the remaining adapter-family risks against real per-job provider evidence, classifying actual defects vs correct fields vs provider restrictions; propose narrow follow-on fixes with exact source list.
**Scope:** the 48-risk inventory pinned in [Discovery's 166-row audit](https://github.com/Shosetzel69/job-search-discovery/blob/main/evidence/source-contamination-audit-166-20261112.md); affected families `linked_jobs`, `heading_list`, `rendered_links`, `rendered_heading_list` and existing specialized HTML routes. Read-only bounded probe per eligible source; record individual result, source governance decision, title/detail/description/location/dates and reason for unverifiable status. Maintain separate short evidence record with per-source status.
**Out:** code mutation, wholesale 48-connector replacement, activation of disabled sources, heavy scheduled scraping, claiming sample success certifies a source.
**Dependencies:** approved DTP, API/source access consistent with policy; 01 quality rubric desirable, but read-only analysis may begin independently.
**Acceptance / verification:**
- `Q4-AC1`: each of the 48 inventory entries has a row with evidence source, verdict `CONFIRMED_DEFECT / STRUCTURAL_RISK_ONLY / SAMPLE_OK_NOT_CERTIFIED / BLOCKED / POLICY_DISABLED`; no unsupported PASS.
- `Q4-AC2`: confirmed defects grouped by existing adapter family; minimal affected file and fixture are specified for separate, subsequent ATC or targeted finding, rather than speculative parser rewrites.
- `Q4-AC3`: disabled and access-controlled providers untouched; only ordinary read-only bounded requests.
**Proof:** reproducible source probe transcript or saved evidence with source ID + URL + field comparison + timestamp, archived separately; no code/deploy tests expected.
**Stop:** provider denies access, requires credentials or anti-bot circumvention, risk becomes architecture/material cost change.
**Impact:** documentation/evidence only; no environment/config/DB changes.
**Evidence:** `EVD-SDQ-01-04`, policy `ARTIFACT_REQUIRED`.
**Commit message:** `docs(#87): classify source-family field contamination evidence`.

## ATC-SDQ-01-05 — DEV release and independent acceptance (M4)

**Status:** PROPOSED with **two explicit gates**: (a) candidate acceptance, (b) independent authorized deploy.
**Parent:** #87; `SDQ-01..08, SDQ-10..11`.
**Objective:** demonstrate approved quality, non-degradation and source corrections in the real shared DEV pipeline, without conflating isolated sandbox tests with deployed runtime.
**Scope:** source/package exact-SHA compatibility and CI evidence, independent review record, existing paired DEV Service/Search Job build/deploy scripts, pre/post health and run snapshots, rollback and bounded source E2E. No new deploy operator implementation.
**Out:** TEST/PROD promotion, new infrastructure, feature changes or silent deployment from this ATC alone.
**Dependencies:** 01/02/03 independently reviewed PASS; 04 for final full-scope gate; existing authorized operator/build/deploy permission and explicit rollout approval; provider limits; approved DEV resources.
**Acceptance / verification:**
- `Q5-AC1`: all candidate commits frozen exact SHA, CI and independent review PASS (not executed by implementer alone); Service/Search Job image digest, revision and traffic recorded.
- `Q5-AC2`: rollback to prior exact revision/image tested or documented under existing approved release process.
- `Q5-AC3`: bounded Retrieve produces source-by-source quality outcomes; representative fixed postings verified in source, `source_postings`, `canonical_jobs`, authenticated API and UI.
- `Q5-AC4`: protected source registry unchanged, JobsPipe disabled, no cross-env changes.
**Proof:** Cloud Build/Cloud Run operation IDs, SHA/digest pre/post, CI URLs, independent reviewer comment, sanitized Nile/API/UI comparisons and rollback artifact.
**Stop:** unavailable privileged deploy path; review FAIL; unapproved DB/config mutation, image parity mismatch, source policy change or TEST/PROD boundary.
**Impact:** DEV Service/Search Job deployment only **after separate explicit authorization**. No new env/schema/secrets by default; list per-environment diff explicitly.
**Evidence:** `EVD-SDQ-01-05`, policy `BOTH_REQUIRED`.
**Commit message:** `chore(#87): prepare DEV quality rollout evidence`.

## ATC-SDQ-01-06 — Historical and archived jobs: authorized read-only inventory (M5a)

**Status:** PROPOSED, no user-content read authorized until proper scope is established.
**Parent:** #87; `SDQ-08..10`.
**Objective:** quantify the historic records actually requiring repair, without modifying personal state or shared corpus.
**Scope:** server-authorized tenant-scoped enumeration of archived state plus linked shared postings, canonical projections and available public first-party pages; dry-run per `job_id`/`posting_id` and source field deltas. Use existing Tenant Data Gateway/AuthContext for personal reads; no browser tenant ID as authority.
**Out:** shared or tenant write, background bulk scraping, admin cross-user reads, deletion, schema changes, automatic state reset.
**Dependencies:** authenticated profile scope and explicit authorization for the read-only inventory; SDQ 01/02 quality rubric; verified access rights and data minimization.
**Acceptance / verification:**
- `Q6-AC1`: complete authorized archived-set enumeration, not first page of `/me/jobs`, with counts/deduped IDs and no other-tenant data.
- `Q6-AC2`: every candidate tagged `REPAIR / NO_CHANGE / CANNOT_REPAIR / BLOCKED` with field-level and source provenance; origin no longer available -> no invented data.
- `Q6-AC3`: before/after candidate diff and immutable rollback-oriented baseline prepared; **zero SQL writes**.
- `Q6-AC4`: tenant A vs tenant B access negative tests; no admin bypass, no PII in review artifacts.
**Proof:** redacted SQL/command + tenant-boundary test, query scope, dry-run JSON with checksums and independent security review.
**Stop:** missing authentic tenant access; cross-tenant permission; unsafe query/PII retention; any proposed write.
**Impact:** read-only Nile DEV (shared + personal scoped reads), no env changes, no schema changes; user data permission required.
**Evidence:** `EVD-SDQ-01-06`, policy `BOTH_REQUIRED`.
**Commit message:** `docs(#87): capture tenant-scoped archived repair dry run`.

## ATC-SDQ-01-07 — Historic repairs: controlled, reversible writes (M5b)

**Status:** CONDITIONAL PROPOSAL — **NOT APPROVABLE FOR EXECUTION UNTIL 06 DRY-RUN AND SEPARATE DATA-WRITE DECISION**.
**Parent:** #87; `SDQ-06, SDQ-08..10`.
**Objective:** repair only proven contaminated DEV postings and canonical projections with stable IDs and user-state preservation.
**Scope:** existing authorized shared writer, limited batches from reviewed `Q6` dry-run, transactional/cas or version-fenced updates, idempotent compare, restore/rollback records; scoped tenant-aware state verification by existing gateway, without altering that state.
**Out:** speculative rewriting of disappeared jobs, user state mutation, global tenant admin reads, TEST/PROD backfill, cleaning all archived jobs by heuristic.
**Dependencies:** 01/02/03/05 PASS, 06 exact dry-run PASS, independently approved batch/rollback evidence, **separate explicit owner approval of Nile DEV data writes and exact target set**.
**Acceptance / verification:**
- `Q7-AC1`: exact historical approved posting/job IDs unchanged after first and repeated execution; no duplicates, same source linkage.
- `Q7-AC2`: source/canonical field updates reflect verified provider data, with previously valid data protected.
- `Q7-AC3`: `archived_at`, seen, applied, notes, user profile and other tenants unchanged; negative access tests included.
- `Q7-AC4`: rollback dry-run/restore verified and exact commit/batch evidence separate from the development PR.
- `Q7-AC5`: same posting verified end-to-end Nile → authenticated API → UI; unsupported repair cases left unchanged with honest status.
**Proof:** exact approved change-set hash, permissioned logs, before/after DB counts and hashes, rollback demonstration, redacted UI/API evidence and independent review.
**Stop:** any target outside approved batch, conflicting updates, inability to preserve identity/user state, missing rollback, unauthorized cross-tenant access.
**Impact:** **DEV Nile data writes explicitly required** (not schema migration); TEST/PROD none; no new secrets by default. Approval is distinct from quality/deploy ATC.
**Evidence:** `EVD-SDQ-01-07`, policy `BOTH_REQUIRED`.
**Commit message:** `fix(#87): apply approved idempotent historical posting repairs`.

## AC coverage matrix

| DTP requirement | Proposed executor contract(s) | Before execution |
|---|---|---|
| SDQ-01 | 01, 03, 04 | Candidate PR #617 partial; overall NEIMPLEMENTAT |
| SDQ-02 | 01, 03, 04 | Candidate PR #617 partial |
| SDQ-03 | 01, 03, 04 | Candidate PR #617 partial; Crossover open |
| SDQ-04 | 01, 03, 04 | Existing rules partial |
| SDQ-05 | 01, 02 | NEIMPLEMENTAT |
| SDQ-06 | 02 | NEIMPLEMENTAT |
| SDQ-07 | 02 | Existing limited lifecycle suppression partial |
| SDQ-08 | 02, 06, 07 | NEIMPLEMENTAT for historic repair |
| SDQ-09 | 06, 07 | NEIMPLEMENTAT for historic repair |
| SDQ-10 | 05, 07 | NEIMPLEMENTAT for source quality E2E |
| SDQ-11 | 01, 03, 04, 05 | Existing controls, must be reverified |

## Approval and execution boundary

All of 01–07 are proposals. **No implementation, merge, deploy, Nile write or review PASS is asserted by this file.**

**Next owner gate (recommend starting with 01):** `APPROVE_TASK_CONTRACT ATC-SDQ-01-01`

Later approvals must reference each **exact** ATC reference after its dependencies and independent contract review, e.g. `APPROVE_TASK_CONTRACT ATC-SDQ-01-02`. No approval token for 01 automatically authorizes 02–07. The conditional 07 also requires separate approved historic data-write decision with an exact dry-run target set.
