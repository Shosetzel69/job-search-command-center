# ADR-008 — Nile-native tenant isolation for JSCC Multiuser

Status: **Accepted — owner decision 2026-10-02**  
Date: 2026-10-02  
Decision owner: Project owner  
Architecture amendment: #467  
Trigger / evidence: #466  
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

For Multiuser MVP:

`profile.profile_id == Nile tenant_id`

No additional JSCC tenant identifier is introduced.

`user_id` and `profile_id` remain separate application identifiers. Google `sub` remains an external identity subject only.

### 2. Isolation boundary

The former database enforcement path:

`server-derived AuthContext -> PostgreSQL RLS + FORCE RLS`

is replaced by:

`server-derived AuthContext -> fail-closed Tenant Data Gateway -> transaction-local Nile tenant context -> Nile-native tenant isolation`.

Nile-native tenant isolation is the primary database tenant boundary for profile-owned personal data.

Application authorization remains independently mandatory defense in depth.

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

### 4. Pooling safety

Tenant state must not persist on a pooled connection after a transaction ends.

Persistent connection-level tenant state is prohibited.

Acceptance evidence must prove at minimum:

- tenant A transaction -> release connection;
- tenant B transaction on a reused connection -> no A visibility;
- failed/rolled-back A transaction -> later B transaction -> no A visibility;
- missing tenant context -> personal operation fails closed.

### 5. Personal versus shared data

Personal/profile-owned domains remain as defined by ADR-005 and ADR-007. They are tenant-aware.

Shared product and approved system/operational domains remain global/non-tenant, including:

- canonical jobs;
- source postings;
- Source Registry / source categories;
- shared nomenclatures;
- global collection policy and scheduler state;
- collection runs and source diagnostics where already classified as system-owned.

User count must not multiply provider retrieval.

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

Before Multiuser DEV acceptance:

- two distinct profiles/tenants exist;
- A cannot read, insert, update or delete B personal rows;
- B cannot access A personal rows;
- forged/browser-selected profile or tenant identifiers confer no authority;
- missing tenant context fails closed;
- pooled connection reuse does not leak tenant state;
- rollback/error paths do not leak tenant state;
- ADMIN cannot read another user's personal content;
- object-ID probing is tenant-scoped and does not reveal ownership;
- concurrent A/B operations do not overwrite or expose each other's personal state;
- shared canonical data remains available according to its global authorization contract.

Before PROD Multiuser:

- runtime/migration privilege gate passes or an explicit Architecture residual-risk decision exists;
- normal release, backup/rollback, cost and TEST gates remain satisfied.

## Consequences

Positive:

- Nile remains the approved persistence provider;
- tenant isolation uses the provider's native multi-tenant model instead of unsupported PostgreSQL DDL;
- application code retains a provider-neutral authorization model;
- pooled connection leakage becomes an explicit security acceptance criterion;
- ADMIN privacy and personal/shared ownership semantics remain unchanged.

Costs / constraints:

- profile-owned tables and repositories must be adapted to Nile tenant-aware semantics;
- the Tenant Data Gateway becomes a security-critical infrastructure boundary;
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
- #265 — IDEA-022 Multiuser
- #270 — original Multiuser architecture decision
- #275 — backend implementation analysis/task contracts
- #450 — Multiuser architecture/implementation tracker
- ADR-004 — Nile/PostgreSQL backend
- ADR-005 — Multiuser ownership/isolation/shared collection
- ADR-006 — Google Cloud runtime
- ADR-007 — Google-first identity/session boundary
