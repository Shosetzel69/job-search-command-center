# #520 / #521 / #87 / #530 — integrated Retrieve DEV release preparation

Owner authorization: `APPROVE_RETRIEVE_DEV_RELEASE_PREPARATION_WITH_NILE_011` (2026-11-14).
Scope: preparation only; no merge, image publication, Cloud Run update, managed Nile mutation, live Retrieve, TEST/PROD, historical repair, IAM, credential or registry changes. No extra infrastructure. Existing #541 exit-86 controls and historic GOV85 exception remain intact. D1–D4 candidate coverage 34/46; 12 remaining criteria need live evidence and/or follow-up. No DEV acceptance yet.

## Gate 1 — immutable candidate and build-only route

- Require all exact-head mandatory PR CI jobs successful, including native Nile 010→011 transition, guarded apply/retry, tenant isolation and existing security checks. Freeze the exact head; reject any drift. Record base/head, tree, CI run IDs, owner decision and risk disposition. Do not infer a REVIEW_PASS; retain any explicit applicable owner review waiver separately.
- Request owner authorization for exact-head squash merge and image-only build; verify merged tree and no additional scope, bind the final main SHA to both image builds. If any CI or tree evidence is absent, stop.
- Existing Cloud Build recipes `cloudbuild.yaml` and `cloudbuild.service.yaml` already require exact matching source/COMMIT_SHA and immutable Artifact Registry tags; use these build-only recipes with the existing Cloud Build SA, through an explicitly authorized one-time DEV route. Do not use frozen legacy promotion, old 121f88-only GOV85 exception, mutable tags, or ad hoc source substitution. Verify current trigger identity and no downstream deploy before dispatch; if unavailable stop. Build only both fixed images at that SHA once. Require both immutable digests and trustworthy build/source provenance, or stop. No partial pair.
- Current connector exposes GitHub writes and read-only typed DEV observation, not a verified app image build/Cloud Run mutation or direct Nile SQL action. No claim that route is executable automatically. An approved execution channel and actual existing trigger/WIF capability must be verified before any provider call; no new IAM.

## Gate 2 — preflight and quiescence (separate authorization for mutation)

Read-only live prerequisites before release: effective serving revision/digest (not latest template alone); both Job templates and digests, source identity, existing configuration and secret bindings pinned v1; current runtime bucket and source catalog generation; latest execution terminal state, active/lock markers, scheduler/dispatch origin; existing migration Job command/args and permissions. Record redacted runtime evidence (never print raw environment, credentials, user contents). Serving API was observed 2026-11-14 at revision `jscc-command-api-dev-00060-jdl` / 100% traffic / digest `sha256:03e0e979c4499d32bd68109031128ed877e5d28ad787a0010f4ae67fdd94dffd`; source SHA UNKNOWN. Re-observe before releasing. Current Search and Migration Job baselines not established. Require confirmed existing operator/permissions without IAM changes. Capture exact prior deployed source identity and images/configuration for rollback.
 
During an expressly approved DEV release window:
1. Stop new heavy dispatch with canonical `locks/heavy-search.lock` conditional creation (ifGenerationMatch=0); use a release sentinel that cannot be mistaken for a genuine run. Confirm no current execution, re-read after acquiring lock; no direct manual gcloud execution during window. Never delete another owner's marker, never override genuine active/unknown lock. Use generation-match deletion of the exact sentinel only. If scheduler/manual paths cannot be made quiescent, stop. No scheduler policy change by default.
2. Use the existing `jscc-db-migrate-dev` Job only, existing SA, existing secret v1 and candidate Service image digest. Snapshot prior template; verify actual immutable digest and build identity, project jscc-dev, europe-west1, app env DEV, expected database jobsearch_dev. No image/command change without approved release. Default template must continue to refuse migration; execute with explicit one-execution overrides only, no persistent apply gate.
3. Invoke candidate `node command-api/scripts/db-retrieve-migrate-011.mjs` in inspect mode with `RETRIEVE011_MODE=inspect` and no owner gate. Verify known ledger prefix 001–010 or exact 011 already applied; no untracked table/index. If 010, request explicit `APPROVE_RETRIEVE_DEV_NILE_011_<full_final_main_SHA>` and verify release caller/image digest binding before apply. For apply use `RETRIEVE011_MODE=apply`, `RETRIEVE011_OWNER_GATE=APPROVE_RETRIEVE_DEV_NILE_011_<full_final_main_SHA>`, `SOURCE_SHA=<full_final_main_SHA>`. Script checks generated immutable image identity, exact DEV job, database binding both URL and actual DB, advisory lock, all migration checksums/names, only 011 DDL+ledger write in one transaction, idempotent replay, sanitized failure. Never invoke legacy db:migrate, unapproved generic migrate/backfills or GRANT/REVOKE. Native CI must pass; if ledger or schema drift, no force. If actual runtime role lacks required access, stop—no role changes. Confirm schema and privileges using existing candidate read-only readiness after commit, and prove ledger exact 011. Restore migration Job refuse/default execution behavior.
4. Update both existing DEV Search Job and Service to digest-pinned same candidate; preserve SA, secrets, policies, source catalog and image-only configuration scope plus required source identity env fields. No changes to TEST/PROD. Stage Service with no traffic first where supported, verify health/auth/readiness and exact job image, then cut Service to 100% target revision; verify both. If any mismatch or failing health, roll back before releasing sentinel. Do not execute Retrieve until separate explicit DEV live acceptance permission. Previous operational block is lifted only for this controlled acceptance run.
5. Release only owned sentinel generation after matched pair/configuration, no active execution and explicit authorization to resume. Recheck no direct execution race. 

## Rollback

- Before migration commit: transaction rolls back on error; do not proceed. Ambiguous commit requires read-only exact-ledger inspection, not blind retry.
- After migration commit: preserve additive 011 (no DROP, no ledger edit, no historical cleanup). Roll back application pair using captured *effective* old Service revision/traffic and exact old Search image/template, restore migration Job refused default. Recheck /health and correct job/database binding, previous application behavior/tenant cascade compatibility; old 010-only migration readiness is not valid for an expanded ledger, do not run it as a rollback. Native check of previous application compatibility with additive 011 remains required before actual release; if cannot prove, stop before any migration. Keep sentinel if rollback or quiescence uncertain.
- Retain evidence and record DEV release failure, no TEST/PROD promotion. D6 historical repair remains separate explicit write authorization.

## Gate 3 — DEV acceptance

After deployment and explicit acceptance run authorization, verify EFA and D1–D4 runtime criteria: real USER/ADMIN requests, new postings with same current Coverage, equivalent/incompatible concurrency and one Run identity, provider scope evidence and request budget, actual provider comparison, confirmed Luxoft/Stripe/Crossover/Orange/NTT cases and all 48 risk dispositions, original→Nile→API→UI, canonical per-source counters/attribution vs UI-visible profile opportunities, request/tenant isolation and terminal history. Report PASS/FAIL/BLOCKED by criterion; never infer PASS on a source failure or unknown detail. Preserve original failure verdict until new evidence. D5 and D6 completion require actual acceptance evidence, not these preparations.

## Scope exclusions and stop conditions

No changes to selection/fit, source activation/replacement, historical writes, new resources, quota/permissions, TEST/PROD or shared governance. Existing legacy controls remain frozen. This runbook is **not** a dispatch credential or release authorization. If connector is limited or existing execution route cannot be proven, stop rather than improvise. Next owner decision is exact-head merge plus paired build-only; separate apply and deploy gates after preflight. All decisions are to be recorded on #520 and #633.

## 2026-11-15 correction: DEV migration collision
Managed DEV ledger 011 is already `011_profile_job_count_snapshots.sql` (SHA-256 `c6cb6ac52c9a717a5dc452b38fb0874be51896190dc24beab01babfafe623f0e`), recovered byte-for-byte from draft PR #591 @0ad953f30bd3fa1717d2b9974dcff12fccdc1c2d. Only the historical SQL is restored; no #591 application code is imported. The new request-mapping migration is `012_refresh_requests.sql`. This supersedes all earlier 011 Retrieve instructions/approval tokens in this historical runbook. Use `db-retrieve-migrate-012.mjs`, `RETRIEVE012_MODE=inspect` or the separately approved `RETRIEVE012_MODE=apply` with `RETRIEVE012_OWNER_GATE=APPROVE_RETRIEVE_DEV_NILE_012_<new_exact_candidate_SHA>`. Admissible ledger is exact 001–011 (pending 012) or exact 001–012; inspect historical 011 schema before applying anything. No ledger repair, no historical DDL replay against managed DEV, no old image release or reuse of #636 candidate-specific preflight. New paired build and fresh preflight must bind the corrected commit; native 011→012 and old-runtime rollback compatibility remain gates. No TEST/PROD changes authorized.

## #589 dedicated managed 013 release adapter (source only)

`scripts/gcp/remote_executor_dev_nile_013.mjs` reuses the existing
`jscc-db-migrate-dev` release procedure recorded in #535 comment 6951698590.
Requires an independently admitted release identity (no default credentials),
exact external evidence pin, pre-staged immutable candidate Job template with
refuse default, v1 secret references, exact build/tag, reviewed script hash
and owned GOV85 sentinel/catalog generation. All Search and migration
executions must be terminal; active.json absent. The adapter consumes one
approval in the existing GCS CAS store under control/v1/migrations before a
single etag-bound run with fixed inspect/apply override; verifies script
and migration SQL hashes inside the image. Apply requires separate prior inspect evidence and
owner/review/rollback authority, plus the exact protected inspect claim/receipt
and externally verified PENDING_013 evidence. Already-applied inspection cannot authorize apply. It does not stage or restore the Job, release
the sentinel, interpret SQL logs or certify a managed migration outcome.
Uncertain receipt retains claim; no replay. The existing independently
reviewed release authority must stage/restore the exact Job and correlate
execution/logs/ledger; read-only reconciliation of the protected receipt
and exact execution is implemented, never a SQL PASS inference. The generic
operator has no runWithOverrides grant.
013 was already applied historically; do not reapply. No live mutation,
new IAM grant, generic migration reactivation or managed backup/restore.

## #589 guarded product Job stage/restore (source only)

The existing guarded release procedure gains a dedicated adapter
`scripts/gcp/remote_executor_dev_job_release.mjs`. It reuses the exact GOV85
sentinel/catalog and bounded all-page quiescence checks from the 013 adapter.
Only the canonical DEV Search/Migration Jobs, existing identity, immutable
image and SOURCE_SHA may change; prior/next exact template hashes are pinned.
Migration retains refuse default and command/secret references. Search stage
requires the candidate Service zero-traffic tagged revision, restoration
requires prior Service serving again. Independent authority must verify
staged health, signed dispatch exclusion and rollback compatibility. One
claim per approval, validateOnly + etag + actual update + readback; unknown
receipt retains claim and lock. Read-only reconciliation reports exact prior,
target or drift, even after approval expiry; never authorizes replay.
No Job execute/cancel, schema change, lock
write, automatic retry, new product route or generic operator grant. Actual
release identity, provider shape, immutable build results and live acceptance
remain prerequisites. The protected product-job-steps prefix needs scoped IAM.

## #589 signed Search cancellation (source only)

The existing release-side adapter also admits exact signed manual/admin Search cancellation, not launch. The independent authority pins the actor/recovery plan, immutable execution UID/image/source, run ID, request signature, scope hash and both live marker generations/descriptor hash. Verify the same scope in execution overrides and marker payloads, create one protected claim, re-read markers and etag, submit cancellation once and observe the exact execution. Terminal state is not a database rollback claim. No marker deletion, automatic retry, generic operator permission or resume approval. The existing authorized application Retrieve endpoint remains the sole launch route. Provider cancellation permission and functional recovery acceptance remain live gates.

## #589 compatible Service-only release handoff (source only)

For an independently reviewed release needing no managed schema change, the existing GitDeploy/GCloudDeploy Service engine may finish first while the owned Retrieve sentinel excludes all dispatch. A separate approved Search `align` step requires exact serving candidate revision, product Service/Search build IDs and immutable digests, external release evidence and explicit `schema_change_required=false`. It does not relax the zero-traffic `stage` gate for migration-required releases. `observeCompatibleProductDelivery` binds the exact alignment approval, refusal-only migration template, independently verified schema/health references and durable claim/receipt to repeated live observations, reporting pending alignment, recovery or independent acceptance required. Never launches Service deployment, migration or Search; no lock release authority. Existing Service-only release and protected identities remain unchanged.

## #589 migration-required release progression (source only)

`advanceMigrationProductDelivery` reuses the separately approved migration Job stage, 013 inspect, conditional apply, restoration and Search stage adapters, with the same exact source, lock, catalog and candidate digest bindings. An explicit requested next step may execute only through the existing release authority; otherwise the function observes and reports the next gate. Each step requires its own original approval; existing receipts are checked, unknown outcomes stop, and independently verified ALREADY_APPLIED inspection skips apply. Managed SQL success is not inferred from execution success. Staged Service health and migration evidence must be authenticated by the independent authority. The function stops before the existing Service cutover approval; it cannot cut traffic, release the lock or start Retrieve. No additional release identity or endpoint is created.
