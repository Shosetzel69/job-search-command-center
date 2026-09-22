# ADR-005 — Multiuser ownership, isolation and shared collection architecture

Status: **Accepted**  
Date: 2026-09-22  
Decision owner: Project owner  
Architecture gate: #270  
Implementation analysis: #275  
Related: #265, #86, #97-#101, ADR-004

## Context

JSCC is moving from a single-user runtime model toward multiuser operation while preserving the existing source/collection architecture and the project constraint of minimal operating cost.

The critical architectural constraint is that external job retrieval is difficult, heterogeneous, quota-sensitive and operationally fragile. Multiuser support must therefore not multiply source retrieval traffic by the number of users.

Development Analysis #275 identified eight architecture decisions that had to be resolved before implementation task contracts could be finalized.

## Decision

### Identity and profile boundary

Google Identity remains the identity provider.

Canonical identity mapping:

`Google sub -> app_user.user_id -> profile.profile_id`

MVP invariant: one user has exactly one job-search profile, while `user_id` and `profile_id` remain separate identifiers.

MVP roles are exactly:
- `USER`
- `ADMIN`

### Shared collection and personal evaluation

External retrieval is system-owned and shared.

`Sources -> global collection -> shared canonical job corpus -> per-profile eligibility/FIT/state`

User count must not directly multiply provider/source calls.

Profile changes cause personal re-evaluation, not external retrieval.

JSCC remains a controlled-source aggregation and prioritization tool. Collection is best-effort and does not claim exhaustive source monitoring or universal search coverage.

### Scheduler and run admission

There is one global scheduler, system-owned and ADMIN-controlled.

- USER has no manual Run/Search control.
- ADMIN may configure global scheduling and trigger exceptional manual collection.
- only one global heavy collection execution is admitted at a time;
- profile-triggered heavy collection runs do not exist in the target model.

Legacy Package 2B assumptions that scheduling is profile-owned must be rebaselined.

### Data ownership

Three canonical ownership domains exist.

**Shared product data**
- canonical jobs;
- source postings;
- job lifecycle;
- dedup/repost relationships;
- role-family classification;
- Source Registry and source categories;
- shared nomenclatures.

**Personal user data**
- account/profile;
- job-search preferences;
- role-family interests;
- geographic/work-mode/contract/compensation criteria;
- personal exclusions;
- FIT criteria and user-job evaluations;
- seen/archive state;
- applications;
- personal notes;
- UI preferences.

**System / operational data**
- collection policy/configuration;
- global scheduler state/configuration;
- search/collection runs;
- source-run diagnostics;
- collector/provider operational state.

The current `search-config.json` has no 1:1 target. It must split into system/collection configuration and profile-owned job-search preferences.

### Authorization

ADMIN is a USER for its own personal profile plus administrative capabilities.

ADMIN may manage:
- account lifecycle metadata;
- Source Registry and shared nomenclatures;
- system/collection configuration;
- global scheduler;
- manual collection;
- operational diagnostics;
- title-to-role-family mappings.

ADMIN may not access another user's profile, FIT/evaluation, applications, notes or other personal workspace content.

### Tenant isolation

Personal access uses defense in depth:

1. authenticated Google identity is resolved server-side;
2. server resolves `app_user` and `profile_id`;
3. personal repository operations require authenticated profile context;
4. PostgreSQL Row Level Security protects personal tables;
5. `FORCE ROW LEVEL SECURITY` is used where applicable.

Browser-supplied profile identifiers never confer authorization.

ADMIN receives no personal-content RLS bypass.

### Runtime database privileges

Broad Nile DDL privilege may be tolerated temporarily in DEV/TEST and controlled migration work.

Before personal-data/multiuser PROD cutover, runtime CRUD authority must be demonstrably separated from migration/DDL authority.

If the current provider cannot support a verified separation mechanism, the residual risk must return to Architecture for explicit owner review. Compensating controls must not be silently described as equivalent to least privilege.

### Account lifecycle and deletion

Lifecycle:

`ACTIVE <-> DEACTIVATED -> DELETED`

DEACTIVATED:
- access disabled;
- personal data retained;
- reactivation restores retained state.

DELETED:
- irreversible product operation;
- personal domain is hard-deleted;
- shared/canonical product data remains.

Delete includes:
- account identity mapping / Google sub;
- profile/preferences;
- FIT/evaluations and personal job state;
- applications and personal notes;
- personal UI preferences.

No identifiable tombstone is retained.

A minimal non-identifying deletion audit event may be retained for 90 days with only:
- deletion event id;
- event type;
- timestamp;
- initiated_by = SELF | ADMIN;
- result = SUCCESS | FAILED.

It must not retain user/profile identifiers, Google sub, email, name, relinkable hashes or personal content.

A later sign-up after deletion creates a new account/profile.

### Job lifecycle and retention

Shared job lifecycle:

`ACTIVE -> UNCONFIRMED -> INACTIVE`

Absence from an incomplete/failed collection does not prove closure.

Freshness/display windows are separate from lifecycle and deletion.

Inactive shared jobs have a default 90-day retention before physical purge unless a retained personal reference, such as an application, requires the canonical job to remain.

### Job identity and reposts

Use two levels:
- Canonical Job;
- Source Posting.

Source posting identity precedence:
1. `source + external_job_id`;
2. otherwise `source + canonical_url`.

Cross-source canonical matching is conservative. False merge is more harmful than a temporary duplicate.

A confirmed repost remains linked to the same canonical opportunity while preserving occurrence/provenance. A new requisition id is not presumed to be a repost.

### Applications

Application is profile-owned and may optionally reference a canonical `job_id`.

Applications found outside JSCC are supported with `job_id = NULL`.

When linked to a canonical job, retain a minimal application-time snapshot such as company/title/location/reference/source URL.

Application lifecycle is independent of shared job lifecycle.

### FIT and eligibility

FIT is profile-owned, never shared:

`User Profile + Shared Job -> User-Job Evaluation`

Evaluation is incremental and refreshed when:
- a job is new/materially changed;
- profile criteria change;
- FIT algorithm/version changes.

Hard eligibility precedes FIT only when explicit contradictory evidence exists. Missing or unknown data is not negative evidence.

### Role families

Role families are shared lightweight classifications used after retrieval, not provider search terms.

MVP canonical families:
- PROJECT_MANAGEMENT
- DELIVERY
- SERVICE_MANAGEMENT
- SCRUM_AGILE
- PROGRAM_PMO
- UNKNOWN

ADMIN may maintain title-to-family mappings but may not create/delete/redefine canonical families in MVP.

### Cloudflare connectivity

Canonical runtime path:

`Cloudflare Worker -> repository/data-access layer -> node-postgres (pg) -> Cloudflare Hyperdrive -> Nile PostgreSQL`

- standard PostgreSQL driver is used instead of a Nile-specific persistence API;
- Hyperdrive provides connection pooling;
- query caching is initially disabled for JSCC persistence;
- DEV, TEST and PROD use separate static bindings to `jobsearch_dev`, `jobsearch_test`, `jobsearch_prod`;
- request-selected database and cross-environment fallback are prohibited.

### Cost guardrail

Pilot variable infrastructure budget is EUR 0.

- no automatic paid upgrade or paid overage;
- paid capacity requires explicit owner approval;
- 70% of included Nile capacity is the operational warning/gate;
- before PROD multiuser enablement, either paid overage must be impossible without explicit owner action or a verified technical mechanism must stop/degrade non-essential workload before paid consumption;
- otherwise PROD multiuser enablement remains blocked.

### JSON to PostgreSQL migration

Migration is incremental, not big-bang.

Recommended domain order:
1. operational history;
2. shared job corpus;
3. multiuser personal core;
4. global scheduler;
5. remaining shared administration/runtime state.

For each migrated domain:
- one authoritative system of record exists after cutover;
- JSON may remain temporarily for compatibility/export;
- permanent dual-write is prohibited;
- rollback is per-domain/per-slice.

Shared source/category/nomenclature JSON may remain in GitHub until a concrete migration need exists.

## Consequences

Positive:
- user growth is decoupled from external retrieval growth;
- personal data ownership is explicit;
- ADMIN privileges do not weaken privacy boundaries;
- PostgreSQL provides transactional persistence and defense-in-depth tenant isolation;
- scheduler semantics become simpler and global;
- persistence remains portable through standard PostgreSQL/repository contracts;
- cost escalation requires explicit owner action.

Costs / constraints:
- current single-user data/config contracts must be split;
- legacy Package 2B scheduler contracts require rebaseline;
- RLS and profile context must be implemented and tested;
- runtime-vs-migration privilege separation is a PROD multiuser gate;
- migration requires domain-by-domain compatibility and rollback discipline.

## Superseded assumptions

This ADR supersedes any assumption that:
- each user/profile owns an external Full Search schedule;
- user actions directly trigger provider retrieval;
- current `search-config.json` remains a single shared configuration;
- ADMIN can inspect other users' personal workspace content;
- permanent JSON/PostgreSQL dual-write is acceptable.

ADR-004 remains authoritative for the Nile/PostgreSQL backend-provider decision.

## Implementation authorization

This ADR releases the architecture gate only.

It does not authorize implementation by itself.

#275 resumes Development Analysis and must translate this architecture into minimum schema, repository/data-access contracts, connectivity details, migration/task contracts, evidence requirements and downstream rebaseline.

## References

- #270 — Multiuser architecture gate
- #275 — Nile/PostgreSQL implementation readiness analysis
- #265 — Multiuser requirement
- #86 / #97-#101 — Package 2B scheduler work
- ADR-004 — Nile/PostgreSQL backend target
- ADR-003 — environment isolation
