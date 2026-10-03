# ADR-008 — Nile-native tenant isolation for JSCC Multiuser

Status: **Accepted — residual risk explicitly accepted by owner on 2026-10-02; provider-compatibility amendment incorporated**  
Date: 2026-10-02  
Provider compatibility amendment: 2026-10-04 / #471  
Decision owner: Project owner  
Architecture amendment: #467  
Trigger / evidence: #466, #470  
Builds on: ADR-004, ADR-005, ADR-006, ADR-007  
Supersedes only: the PostgreSQL RLS / FORCE RLS tenant-enforcement mechanism in ADR-005/ADR-007 and dependent contracts

## Context

JSCC uses Nile-managed PostgreSQL as the approved persistent backend.

The approved Multiuser architecture originally required PostgreSQL `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on profile-owned tables.

DEV evidence in #466 reproduced on the actual managed Nile database shows that PostgreSQL-standard `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is not supported in the current Nile backend configuration.

Replacing Nile is not an architectural option for this workstream.

The security outcome remains unchanged: personal data of one JSCC profile must not be accessible or mutable from another profile, and ADMIN must not receive cross-user personal-content access.

## Decision

### 1. Canonical tenant mapping

For Multiuser MVP steady state:

`profile.profile_id == tenants.id == physical tenant_id`

No additional JSCC tenant identifier is introduced.

`user_id` and `profile_id` remain separate application identifiers. Google `sub` remains an external identity subject only.

Physical schema rule:
- Nile built-in `tenants` contains one row per JSCC profile, with `tenants.id = profile.profile_id` and a non-identifying opaque `name` that never contains email, Google subject, person name or other personal content;
- `profile` is **global account/tenant metadata**, not a tenant-aware personal-content table; it stores only the 1:1 account-to-tenant mapping and timestamps;
- `profile.profile_id` is the logical JSCC profile identifier exposed by `AuthContext` and, for a fully provisioned account that is not being deleted, MUST equal the corresponding Nile `tenants.id`; because managed Nile rejects a physical foreign key from the shared/global `profile` table to the built-in tenant table, this equality is an application/provisioning invariant rather than a physical cross-plane FK. A temporary global profile without a tenant row is permitted only while `profile.provisioned_at IS NULL` during provisioning or while `app_user.deletion_started_at IS NOT NULL` during irreversible deletion;
- tenant-aware personal-content tables use a physical `tenant_id UUID NOT NULL` column equal to the logical `profile_id`; they do not duplicate a second `profile_id` ownership column;
- tenant-aware entity tables use tenant-qualified keys such as `PRIMARY KEY (tenant_id, entity_id)` and tenant-qualified foreign keys where relationships are tenant-local.

### 2. Isolation boundary

The former database enforcement path:

`server-derived AuthContext -> PostgreSQL RLS + FORCE RLS`

is replaced by:

`server-derived AuthContext -> fail-closed Tenant Data Gateway -> transaction-local Nile tenant context -> Nile-native tenant isolation`.

Nile-native tenant routing/isolation applies **only after a tenant context is established**. Nile also intentionally supports global cross-tenant queries when no tenant context is set. Therefore the managed database connection is not fail-closed by default.

The canonical JSCC security boundary is composite:

`server-derived AuthContext -> fail-closed Tenant Data Gateway -> SET LOCAL nile.tenant_id -> Nile tenant routing/isolation`.

The Tenant Data Gateway is the fail-closed enforcement point for normal personal-data access. Nile provides isolation inside an established tenant context, but absence of tenant context is a privileged/global database mode rather than a deny state.

This is a material residual-risk difference from the former FORCE-RLS baseline and must not be described as equivalent database-level default-deny.

### 3. Tenant Data Gateway

All profile-owned persistence MUST pass through a narrow Tenant Data Gateway or equivalent profile-scoped repository transaction boundary.

For every personal operation it MUST:

1. receive authenticated, server-derived `AuthContext`;
2. derive `profile_id` / tenant authority only from that context;
3. start or join the approved profile-scoped transaction;
4. establish Nile tenant context transaction-locally before personal SQL;
5. execute only tenant-scoped personal repository operations;
6. fail closed if authenticated tenant context is absent, invalid or inconsistent;
7. clear tenant context by transaction commit/rollback;
8. never treat browser-supplied `profile_id`, `user_id` or tenant id as authority.

A generic unscoped personal-table query API is prohibited.

### 3.1 Mandatory compensating controls for the global-mode risk

Because the same managed Nile runtime credential can execute cross-tenant queries when no tenant context is established, the following controls are normative:

1. **Personal-table registry.** The canonical list of tenant-aware personal tables is declared centrally and versioned.
2. **Gateway-only SQL.** Runtime SQL that references a personal table is permitted only inside the Tenant Data Gateway, except the narrow Account Lifecycle Gateway defined below, the aggregate-only Cross-Tenant Reference Guard defined in §5.4, and migration code. Global account/tenant metadata writes for first-sign-in/bootstrap are permitted only inside the narrow Account Provisioning Gateway.
3. **No raw DB escape hatch.** Business/domain modules, HTTP handlers, shared/system repositories and collection jobs must not receive or export a raw `pg` pool/client or generic SQL executor.
4. **Static/CI guard.** CI must fail if runtime code outside the allowlisted Tenant Data Gateway, Account Provisioning Gateway and Account Lifecycle Gateway references tenant-management primitives; runtime code outside Tenant Data Gateway/Account Lifecycle Gateway must not reference personal-table identifiers. Generic raw-query escape paths are prohibited. Migration/test fixtures are explicitly scoped exceptions.
5. **Shared/system repository boundary.** Global/shared repositories and collection jobs may use global DB context only for tables classified shared/system. They must not import personal repository modules.
6. **Dedicated account-lifecycle path.** Cross-tenant account deletion is implemented only by a narrow Account Lifecycle Gateway with allowlisted statements and no personal-content SELECT/list/export capability.
7. **Negative architectural tests.** The suite must prove that normal non-gateway runtime paths cannot obtain a personal repository handle or execute personal-table SQL.

These controls mitigate accidental bypass. They do not remove the underlying credential capability to query cross-tenant in Nile global mode; that capability is the residual risk requiring explicit owner acceptance before this ADR can become fully accepted for PROD Multiuser.

### 4. Pooling safety

Tenant state must not persist on a pooled connection after a transaction ends.

Persistent connection-level tenant state is prohibited.

Acceptance evidence must prove at minimum:

- tenant A transaction -> release connection;
- tenant B transaction on a reused connection -> no A visibility;
- failed/rolled-back A transaction -> later B transaction -> no A visibility;
- missing tenant context -> the **Tenant Data Gateway** fails closed before personal SQL; a direct/global Nile connection without tenant context remains cross-tenant capable and is not treated as a deny state.

### 4.1 Mixed personal + shared transactions

Transactions that combine shared reads with personal writes (for example shared canonical job -> profile-owned FIT/evaluation) must start through the Tenant Data Gateway and establish the authenticated tenant context first.

Inside that tenant-scoped transaction:
- shared/global tables may be read under tenant context;
- shared/global tables MUST NOT be written in a transaction that also writes tenant-aware data;
- personal reads/writes remain tenant-scoped;
- the transaction must never clear tenant context to switch into global mode;
- cross-tenant iteration is prohibited.

Official Nile documentation and the official Nile testing container are the pre-managed-DEV compatibility authority for this contract. Provider evidence in #470 proves shared-read + tenant-write succeeds and shared-write + tenant-write is rejected. Stock PostgreSQL CI is portability evidence only and is not sufficient Nile compatibility evidence.

### 5. Personal versus shared data

Personal-content/profile-owned domains remain as defined by ADR-005 and ADR-007. Their physical storage is tenant-aware. The minimal global `profile` mapping itself is account/tenant metadata, not personal-content storage.

Shared product and approved system/operational domains remain global/non-tenant, including:

- canonical jobs;
- source postings;
- Source Registry / source categories;
- shared nomenclatures;
- global collection policy and scheduler state;
- collection runs and source diagnostics where already classified as system-owned.

User count must not multiply provider retrieval.

### 5.1 Nile tenant lifecycle and provisioning

Self-service provisioning and owner bootstrap run only through the **Account Provisioning Gateway**, the narrowly allowlisted global account/tenant-metadata write path. It has no personal-content SELECT/list/export capability.

Managed Nile rejects writes to tenant-control/tenant-aware and shared tables in the same transaction. Provisioning therefore remains one logical Account Provisioning Gateway operation but uses idempotent, fail-closed transaction boundaries:

1. allocate `user_id` and `profile_id`;
2. in a shared-only transaction, perform admission/concurrency checks and create `app_user`, `user_identity` and global `profile(profile_id, user_id, provisioned_at=NULL)`; `profile_id` is the intended tenant id but has no physical FK to `tenants`;
3. in a tenant-control transaction, create Nile `tenants(id = profile_id, name = <opaque non-PII label>)`;
4. in a tenant-scoped transaction, establish tenant context and create required personal defaults/bootstrap data;
5. in a shared-only transaction, persist any required shared bootstrap/system markers or collection policy imported from the legacy owner configuration and set `profile.provisioned_at` once every required prior step is verified complete;
6. only a profile with non-null `provisioned_at`, null `deletion_started_at`, and a provider-safe verification that the corresponding Nile tenant exists may be returned as a provisioned AuthContext or receive a JSCC session. Missing/mismatched tenant state fails closed into provisioning repair or lifecycle reconciliation; it never issues a session.

Each step MUST be idempotent. `profile.provisioned_at` is internal readiness metadata, not a new product lifecycle state. If a process fails after shared account metadata exists but before tenant/personal initialization completes, a later first-sign-in attempt sees `provisioned_at IS NULL`, resumes the missing steps using the persisted `profile_id`, and must not create a second identity/profile or issue a session against an incomplete personal domain. No new user count/provider retrieval is triggered by retry.

### 5.2 Tenant-aware personal schema

For each personal-content table:
- physical ownership column is `tenant_id UUID NOT NULL`;
- `tenant_id` references Nile `tenants(id)`;
- primary/unique keys are tenant-qualified where entity identity is tenant-local;
- tenant-local foreign keys carry `tenant_id` in the relationship;
- repositories translate logical `AuthContext.profile_id` to physical `tenant_id` internally.

Nile does not support a physical foreign key from a tenant-aware table to a shared table. Therefore profile-owned `job_id` columns that refer to shared `canonical_jobs(job_id)` remain logical shared references without a physical FK. User-originated writes MUST validate the referenced shared job with a shared read under the authenticated tenant transaction before persisting the tenant row. Evaluation/state writes derived directly from a selected shared canonical row satisfy the same contract. Physical purge of a shared canonical job remains disabled until a retained-reference guard can prove no personal logical reference requires retention.

The global `profile` table is not a personal-content store. Professional profile details, preferences, FIT criteria, notes, applications, UI preferences and other user workspace content live in tenant-aware personal tables.

### 5.3 Hard-delete lifecycle

Managed Nile rejects tenant deletion and shared account deletion in the same transaction. The Account Lifecycle Gateway preserves the existing irreversible hard-delete outcome through fail-closed, idempotent transaction boundaries:

1. authorize the caller from the ADMIN/self account boundary and resolve only target account metadata needed for deletion (`user_id`, `profile_id`), never target personal content;
2. in a shared-only transaction, set `app_user.deletion_started_at = COALESCE(deletion_started_at, now())`, persist the original `deletion_initiated_by = SELF|ADMIN` if not already present, set the account to `DEACTIVATED`, and revoke all live sessions before destructive tenant work;
3. in a tenant-control transaction, delete `tenants.id = profile_id`; verified `ON DELETE CASCADE` from tenant-aware personal tables removes the personal domain;
4. in a shared-only transaction, delete `app_user`; approved shared-account cascades remove `user_identity`, `user_session` and the global `profile` mapping through its `user_id` relationship, then persist the allowed non-identifying deletion audit using the original persisted `deletion_initiated_by`;
5. verify zero tenant/profile/personal/account residue.

Each step MUST be retry-safe. `deletion_started_at` and `deletion_initiated_by` are internal lifecycle-progress metadata, not a retained `DELETED` product status. Once non-null, reactivation is prohibited and authentication/session establishment must fail closed; the Account Lifecycle Gateway or an internal reconciliation path may resume the remaining delete steps without impersonating the target tenant. A missing tenant during retry is treated as an already-completed tenant-delete step, not as permission to recreate the tenant. Final shared account deletion removes the marker with the account row.

Deletion must remove the Nile `tenants` row itself. A successfully deleted account leaves no tenant row, profile row, personal row, identity/session row, email, Google subject or relinkable tombstone. A later signup creates a new `user_id`, `profile_id` and tenant row.

The tenant-delete cascade is provider evidence, not an excuse for application-side row-by-row personal-content deletion; if that cascade stops being demonstrable, implementation returns to Architecture.

### 5.4 Cross-Tenant Reference Guard

Nile does not support the PostgreSQL user-defined function used by the earlier nomenclature-reference design. Cross-profile nomenclature usage checks therefore use a narrow application-level **Cross-Tenant Reference Guard** in intentional Nile global mode.

The guard:
- is allowlisted separately from normal personal repositories;
- executes only predefined aggregate/exists queries needed to enforce shared nomenclature integrity;
- returns only integer/boolean reference evidence;
- MUST NOT return tenant ids, profile ids, emails, identity subjects, application rows, preferences or other personal payload;
- cannot be used as a general cross-tenant query API.

This is an intentional bounded use of the already accepted Nile global-mode capability and is covered by the same static boundary and Independent Review requirements.

### 6. ADMIN privacy

ADMIN is a USER for its own profile plus approved administrative capabilities.

ADMIN receives no generic ability to select or assume another user's personal tenant context.

Account lifecycle operations must use narrow account-domain operations that do not expose target personal content.

Any future support, audit, impersonation or delegated cross-user personal access requires a separate approved requirement and architecture decision.

### 7. Runtime versus migration authority

Runtime CRUD versus migration/DDL separation remains a PROD Multiuser gate where Nile supports a demonstrable mechanism.

Provider-specific privilege limitations may be accepted only through explicit Architecture review if they create residual security risk.

Privilege controls are additive. They do not replace correct tenant scoping.

### 8. Portability boundary

Provider-specific tenant mechanics are confined to the Tenant Data Gateway / repository infrastructure boundary.

Business logic, API contracts and frontend code consume JSCC `AuthContext` and profile-scoped repository interfaces; they do not depend on Nile tenant APIs directly.

This limits provider lock-in to the persistence adapter.

## Required security evidence

Before any managed Nile DEV schema/runtime mutation for Multiuser:

- current official Nile documentation relevant to the change is reviewed;
- the exact schema/transaction contract passes against `ghcr.io/niledatabase/testingcontainer:latest`;
- generic PostgreSQL CI is treated only as portability/regression evidence.

Before Multiuser DEV acceptance:

- migrations pass on the official Nile testing container and then on managed DEV;
- two distinct profiles/tenants exist;
- A cannot read, insert, update or delete B personal rows;
- B cannot access A personal rows;
- forged/browser-selected profile or tenant identifiers confer no authority;
- missing tenant context fails closed at the Tenant Data Gateway before personal SQL; direct Nile global mode is explicitly expected to remain cross-tenant capable;
- pooled connection reuse does not leak tenant state;
- rollback/error paths do not leak tenant state;
- ADMIN cannot read another user's personal content;
- object-ID probing is tenant-scoped and does not reveal ownership;
- concurrent A/B operations do not overwrite or expose each other's personal state;
- shared canonical data remains available according to its global authorization contract.

Before PROD Multiuser:

- the mandatory gateway/CI/non-gateway isolation controls pass;
- runtime/migration privilege separation is proven to the strongest capability Nile supports;
- the owner explicitly accepts the residual risk that the managed runtime DB credential remains cross-tenant capable in Nile global mode if the Tenant Data Gateway is bypassed;
- normal release, backup/rollback, cost and TEST gates remain satisfied.

## Residual risk decision

**State: ACCEPTED BY OWNER — 2026-10-02.**

Verified Nile behavior permits cross-tenant queries when no tenant context is set. The compensating controls in this ADR reduce accidental bypass but do not recreate FORCE-RLS-style database default-deny for the runtime credential.

The project owner explicitly accepted this residual risk for PR #468 candidate lineage on 2026-10-02. This acceptance is architecture-specific and does not waive implementation, TEST, PROD, security-evidence or release gates.

If future implementation evidence materially increases this risk beyond the documented no-tenant/global-mode capability, the matter returns to Architecture for a new owner decision.

## Consequences

Positive:

- Nile remains the approved persistence provider;
- tenant-scoped operations use the provider's native virtual-tenant model instead of unsupported PostgreSQL RLS DDL;
- application code retains a provider-neutral authorization model;
- pooled connection leakage becomes an explicit security acceptance criterion;
- ADMIN privacy and personal/shared ownership semantics remain unchanged.

Costs / constraints:

- profile-owned tables and repositories must be adapted to Nile tenant-aware semantics;
- provisioning and hard-delete are one logical operation each but use provider-required idempotent transaction boundaries rather than unsupported cross-plane atomic writes;
- the Tenant Data Gateway, Account Provisioning Gateway, Account Lifecycle Gateway and Cross-Tenant Reference Guard become security-critical infrastructure boundaries;
- Nile global mode remains cross-tenant capable under the runtime credential, so database default-deny is weaker than the superseded FORCE-RLS baseline;
- previous RLS-specific migrations/tests/contracts must be rewritten;
- standard PostgreSQL portability is preserved above the repository boundary, but the tenant adapter is Nile-specific.

## Superseded statements

Where ADR-005, ADR-007 or dependent contracts require any of the following for JSCC personal-table isolation, ADR-008 is authoritative:

- PostgreSQL `ENABLE ROW LEVEL SECURITY`;
- PostgreSQL `FORCE ROW LEVEL SECURITY`;
- `BYPASSRLS` as the relevant tenant-isolation bypass model;
- `jscc.user_id` / `jscc.profile_id` PostgreSQL session settings as the canonical isolation mechanism;
- RLS-policy-specific acceptance tests.

Historical evidence and archived documents are not rewritten.

## Unchanged decisions

ADR-008 does not reopen:

- Nile/PostgreSQL provider selection;
- Google-first authentication and JSCC-owned sessions;
- one profile per user in MVP;
- USER/ADMIN role model;
- shared collection + per-profile evaluation;
- global ADMIN-controlled scheduler;
- personal hard-delete semantics;
- incremental JSON -> PostgreSQL migration;
- GCP runtime architecture;
- DEV/TEST/PROD isolation;
- EUR 0 pilot cost guardrail.

## References

- #466 — DEV proof that PostgreSQL RLS DDL is unsupported by the current managed Nile backend
- #467 — Architecture amendment tracker
- #470 — Nile technical due diligence and official-container provider evidence
- #471 — minimal ADR-008 provider-compatibility amendment
- #265 — IDEA-022 Multiuser
- #270 — original Multiuser architecture decision
- #275 — backend implementation analysis/task contracts
- #450 — Multiuser architecture/implementation tracker
- ADR-004 — Nile/PostgreSQL backend
- ADR-005 — Multiuser ownership/isolation/shared collection
- ADR-006 — Google Cloud runtime
- ADR-007 — Google-first identity/session boundary

## Provider evidence used by this amendment

- Nile documents that tenant context can be set for tenant-scoped access and that shared tables remain readable under tenant context.
- Nile documents a distinct global/no-tenant mode that can query across tenant-aware data.
- Nile tenant-aware schema examples use a built-in `tenants` row, a `tenant_id` column, tenant-qualified primary keys and tenant-local foreign keys.
- Nile explicitly documents that transactional writes between tenant-aware and shared tables are unsupported.
- Nile explicitly documents that foreign keys from tenant-aware tables to shared tables are unsupported.
- Nile explicitly documents that user-defined `CREATE FUNCTION` and PostgreSQL `CREATE ROLE`/`CREATE USER` are unsupported.
- Official testing-container evidence in #470 additionally proves for the current provider build: shared `profile -> tenants` FK is rejected; tenant creation + shared account write in one transaction is rejected; separate tenant initialization succeeds; shared-read + tenant-write succeeds; mixed shared-write + tenant-write is rejected; tenant delete + shared account delete in one transaction is rejected; tenant deletion cascades tenant-aware personal rows.

These facts MUST be revalidated first in the official Nile testing container before future managed-DEV execution when provider behavior or the affected contract changes.
