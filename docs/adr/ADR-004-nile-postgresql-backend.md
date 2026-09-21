# ADR-004 — Nile/PostgreSQL as JSCC persistent backend target

Status: **Accepted**  
Date: 2026-09-21  
Decision owner: Project owner  
Architecture gate: #270  
Implementation analysis: #275

## Context

JSCC currently persists functional/runtime state primarily as versioned JSON in environment-specific GitHub runtime repositories. This model remains operational for the current single-user application, but it is no longer the target persistence architecture because upcoming requirements introduce:

- multiuser identity and tenant/profile ownership;
- transactional personal state;
- scheduler state and concurrency;
- application/audit history;
- growth of operational history beyond comfortable GitHub file semantics.

The project has already prepared and validated a Nile/PostgreSQL backend package in `job-search-discovery#8` and merged Discovery PR #9.

Validated preparation evidence includes:

- separate databases `jobsearch_dev`, `jobsearch_test`, `jobsearch_prod`;
- PostgreSQL 15.19;
- successful DEV/TEST/PROD credential isolation matrix;
- prepared non-secret environment configuration;
- prepared pg_dump -> Cloudflare R2 backup and non-PROD restore package.

A known limitation remains: multiple Nile credentials for the same database map to the same effective PostgreSQL role, so runtime-vs-migration privilege separation is not demonstrated and must be addressed or explicitly accepted.

## Decision

**Nile-managed PostgreSQL is the persistent backend target for JSCC.**

The current React frontend, Cloudflare Worker / Command API, GitHub Actions search engine and connector architecture remain in place.

Persistence must be introduced behind an explicit repository/data-access boundary so application logic is not coupled directly to Nile-specific APIs or provider-specific SQL assumptions.

The migration from GitHub JSON is incremental. The current working single-user application remains supported during migration.

## Ownership direction

Target persistence is expected to separate:

- shared/product data;
- user/profile-owned transactional data;
- operational/search-run history;
- source/configuration/governance data.

The exact data ownership map and schema are defined through #270/#275 before implementation.

## Environment model

The existing environment isolation model is preserved:

- DEV -> `jobsearch_dev`;
- TEST -> `jobsearch_test`;
- PROD -> `jobsearch_prod`.

No cross-environment fallback is permitted.

## Cost constraint

The pilot architecture must remain compatible with the project target of **€0 operating cost**.

Capacity thresholds, alerting and fail-closed behavior before paid overage are part of the implementation analysis.

## Migration principles

- no big-bang migration;
- current PROD must remain usable while backend slices are introduced;
- schema/data migration is promoted through DEV -> TEST -> PROD;
- production migration requires backup/checksum and validated non-PROD restore evidence when destructive or non-reversible changes are involved;
- rollback must not depend on DEV/TEST runtime state.

## Superseded alternatives

The following persistence directions are superseded:

- #2 — SQLite backend direction;
- #44 — Cloudflare D1 persistence proposal.

Functional requirements from older tickets remain valid where they do not depend on the superseded persistence choice.

## Consequences

Positive:

- transactional persistence and concurrency become explicit;
- multiuser/tenant boundaries can be enforced consistently;
- operational history no longer depends on large GitHub JSON files;
- PostgreSQL portability reduces provider exit cost.

Costs/risks:

- introduces a database lifecycle and migration discipline;
- adds connection management from Cloudflare Worker;
- requires tenant-isolation proof;
- requires explicit capacity/cost monitoring;
- privilege separation for migration/runtime remains unresolved.

## Implementation authorization

This ADR approves the **target architecture only**.

It does not authorize schema mutation, migration, deployment or application coding by itself. Implementation proceeds only after #275 reaches an implementation-ready verdict and the resulting task contracts are approved.

## References

- #270 — architecture decision/gate
- #265 — multiuser requirement
- #275 — backend implementation analysis
- `job-search-discovery#8`
- `job-search-discovery PR #9`
- ADR-003 — environment isolation
