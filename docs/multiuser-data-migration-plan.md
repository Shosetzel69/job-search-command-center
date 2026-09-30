# Multiuser Data Ownership and Migration Plan

Status: **CANONICAL**  
Version: **v1.0**  
Applicability: **CURRENT**  
Applies to: **AGENTFLOW**  
Effective from: **2026-09-30**  
Parent: #265  
Development analysis: #275  
Architecture: ADR-004, ADR-005, ADR-006, ADR-007  
Tracker: #450

## 1. Purpose

Define the authoritative domain split, migration order, rollback rules and release gates for moving JSCC from single-user JSON state to Google-first multiuser PostgreSQL state.

This plan is documentation only until the relevant Agent Task Contracts are explicitly authorized.

## 2. Core migration rules

- migration is incremental, never big-bang;
- each domain has exactly one authoritative read/write system after cutover;
- permanent JSON/PostgreSQL dual-write is prohibited;
- compatibility export/read may exist only inside a declared rollback window;
- no cross-environment data copy is implied by promotion;
- DEV, TEST and PROD migrations are independently applied to their own databases;
- schema/data migration is separated from immutable application promotion evidence;
- PROD remains untouched until full TEST acceptance and explicit PROD gate.

## 3. Canonical ownership domains

### Shared / product

- canonical jobs;
- source postings;
- job lifecycle/repost/dedup relationships;
- role-family classification;
- Source Registry;
- source categories;
- nomenclatures.

### Personal / profile-owned

- profile;
- job-search preferences;
- profile job state;
- eligibility/FIT evaluations;
- applications;
- personal notes;
- server-persisted UI preferences.

### Account / security

- app user;
- external identities;
- sessions;
- roles;
- account lifecycle state.

### System / operational

- collection policy;
- scheduler config/state;
- collection/search runs;
- source-run diagnostics;
- provider/collector operational state;
- non-personal operational audit.

## 4. AS-IS -> target authority matrix

| Domain | AS-IS authority | Target authority | Owner | Initial action |
|---|---|---|---|---|
| account authorization | `ALLOWED_GOOGLE_SUB` | PostgreSQL `app_user + user_identity` | account | bootstrap then auth cutover |
| browser session | Google ID token/current cookie | PostgreSQL-backed JSCC session | account/security | cut over with multiuser auth |
| profile | implicit singleton | PostgreSQL `profile` | personal | create bootstrap profile |
| search preferences | `search-config.json` | PostgreSQL profile preferences | personal | field-level split/import |
| applications | `applications.json` | PostgreSQL applications | personal | deterministic import |
| archive/seen state | browser/local state where applicable | PostgreSQL profile job state | personal | explicit import only where preservation is required |
| FIT/evaluation | embedded/current-user job result | PostgreSQL profile evaluation | personal | split from shared job |
| jobs | `jobs.json` current-user result | PostgreSQL canonical job + source posting | shared | shared corpus migration |
| sources | `sources.json` | GitHub/runtime JSON initially | shared | remain JSON |
| source categories | `source-categories.json` | GitHub/runtime JSON initially | shared | remain JSON |
| nomenclatures | `nomenclatures.json` | GitHub/runtime JSON initially | shared | remain JSON |
| run status/history | runtime JSON/GCS transitional state | PostgreSQL operational history when slice migrates | system | migrate separately |
| scheduler | current/provisional runtime model | global PostgreSQL/system state | system | rebaseline after shared corpus |

## 5. `search-config.json` field ownership

The current file is a mixed transitional contract and has no 1:1 target.

### Profile-owned

- `role_groups`;
- `work_modes.remote|hybrid|onsite`;
- `contract_types`;
- `freshness_hours` when representing user-visible job age/freshness preference;
- `fit_threshold`;
- `keep_reposts`;
- `rate_min_eur_day`;
- `rate_max_eur_day`;
- `immediate_start`;
- `target_regions`;
- `target_country_codes`;
- `excluded_regions`;
- `excluded_country_codes`;
- personal `exclusions`.

### System / collection-owned

- source/provider strategy;
- provider/connector enablement and execution policy;
- global collection freshness/cadence;
- collection budgets/limits;
- JobsPipe/provider transport settings;
- scheduler/run-admission policy.

Where one legacy field combines both meanings, migration must create two explicit target fields instead of preserving ambiguity.

## 6. Minimum profile preference shape

The implementation may normalize values relationally or use bounded JSONB where justified, but the following rules are fixed:
- `profile_id` is the tenant key;
- controlled values reference canonical technical codes;
- profile preference writes trigger no provider retrieval;
- personal configuration is never stored in a global singleton row;
- repository APIs expose typed/domain fields, not an unbounded generic configuration blob to the UI.

## 7. Migration slices

### MU-S0 — Documentation and contract baseline

No runtime mutation.

Outputs:
- ADR-007;
- auth/security contract;
- this migration plan;
- canonical doc updates;
- rebaselined ATCs.

Gate: internal review + independent review.

### MU-S1 — User/profile/identity/RLS foundation

DEV only after explicit ATC approval.

Creates:
- app user;
- external identity;
- profile;
- tenant context;
- RLS policies;
- current owner bootstrap.

Does not:
- enable public multiuser;
- replace current auth boundary yet;
- migrate personal JSON domains.

Rollback:
- application continues using legacy single-user authority;
- additive DB objects may remain unused.

### MU-S2 — Shared canonical job corpus

Creates shared job/source-posting persistence and collection publication boundary.

Does not:
- expose multiple users yet;
- move personal evaluation into shared rows.

Rollback:
- old jobs JSON remains read authority during declared window.

### MU-S3 — Profile preferences and evaluation

Imports current owner personal criteria and separates:
- system collection config;
- profile preferences;
- profile job state/evaluation.

Cutover rule:
- PostgreSQL becomes read/write authority for personal preferences only after parity evidence.

Rollback:
- return read authority to frozen legacy JSON snapshot during rollback window;
- no silent dual authority.

### MU-S4 — Applications

Imports `applications.json` to the bootstrap profile.

Requirements:
- deterministic/idempotent import;
- application belongs to one profile;
- optional shared job link;
- application snapshot survives shared-job change;
- cross-profile RLS tests.

### MU-S5 — Google multiuser auth/session/lifecycle

After MU-S1/S3/S4 are stable:
- replace `ALLOWED_GOOGLE_SUB` authorization with account lookup/provisioning;
- exchange Google credential for JSCC session;
- enable self-service first sign-in;
- enable ACTIVE/DEACTIVATED lifecycle;
- enable ADMIN account lifecycle operations;
- implement hard deletion.

No auth fallback to legacy allowlist after successful cutover.

### MU-S6 — Global scheduler / collection authorization

Rebaseline scheduler to ADR-005:
- one global scheduler;
- ADMIN/system controlled;
- USER cannot trigger provider retrieval;
- profile changes cause personal re-evaluation only.

### MU-S7 — Integrated evidence / TEST candidate

Freeze exact candidate only after:
- tenant isolation passes;
- owner bootstrap parity passes;
- personal-domain authorities are explicit;
- session/account lifecycle passes;
- runtime-vs-DDL privilege gate passes for protected multiuser cutover;
- all relevant CI passes.

Then promote exact immutable candidate to TEST.

### MU-S8 — JSON retirement

Retire migrated JSON write paths one domain at a time after:
- TEST PASS;
- rollback window closes;
- all consumers use PostgreSQL authority.

Shared source/category/nomenclature JSON may remain by design.

## 8. Bootstrap owner migration

The current authorized owner becomes the initial ADMIN.

Inputs:
- current environment `ALLOWED_GOOGLE_SUB`;
- current owner search configuration;
- current applications;
- personal job state only where an authoritative preservation source exists.

Required result:

```text
current Google sub
  -> user_identity(GOOGLE)
  -> app_user(role=ADMIN,status=ACTIVE)
  -> profile
  -> imported personal state
```

Rules:
- idempotent;
- deterministic;
- no second ADMIN/profile on rerun;
- no user data inferred from another environment;
- no PROD bootstrap from DEV/TEST records.

## 9. Authority-switch protocol per domain

Before switch:
1. define source authority;
2. define target schema;
3. run deterministic import in DEV;
4. compare counts/keys/semantic fields;
5. test target read/write;
6. record rollback anchor.

At switch:
1. freeze/record source baseline;
2. target becomes declared write authority;
3. target becomes declared read authority;
4. compatibility output, if any, is one-way derived data only.

After switch:
1. verify no writes continue to old authority;
2. verify reload/new session reads target;
3. keep rollback window explicit;
4. retire compatibility path only after TEST evidence.

## 10. Rollback rules

### Additive schema slices

Rollback may switch application reads back to the previous authority while leaving unused additive DB objects in place.

### Data cutover slices

Rollback is allowed only to a recorded pre-cutover snapshot/authority.

No merge of divergent personal writes is automatic.

If both old and new stores received writes contrary to contract:
- stop the release;
- classify as authority conflict;
- reconcile explicitly before continuing.

### Authentication cutover

Rollback may restore the previous application candidate only while the legacy single-user data contract remains compatible.

There is no runtime behavior:

```text
new session/account lookup failed
 -> silently authorize via ALLOWED_GOOGLE_SUB
```

That path is prohibited.

## 11. Deletion and rollback

User hard deletion is intentionally irreversible at product level.

Before PROD enables deletion:
- deletion transaction/integrity tests must pass in DEV and TEST;
- backup/restore policy for platform disaster recovery must exist;
- product UI/API must communicate irreversibility;
- deletion does not create a recoverable user tombstone.

Operational backup existence does not change the product semantic that DELETE cannot be undone by normal account operations.

## 12. Database privilege gate

Before PROD multiuser:
- routine runtime credential supports only required application DML;
- migration identity owns approved DDL/migration capability;
- runtime cannot CREATE/ALTER/DROP protected schema objects;
- runtime is not superuser and does not have `BYPASSRLS`;
- environment bindings remain independent.

If the PostgreSQL provider cannot demonstrate this, multiuser PROD is blocked and returns to Architecture.

## 13. Connection-pool safety

Cloud Run may scale horizontally.

Requirements:
- use a bounded pool per instance;
- do not size pools as if only one service instance exists;
- tenant context is always transaction-local;
- rollback releases the transaction/connection cleanly;
- no session/tenant context survives pool reuse;
- connection limits must be validated against current Nile capacity before TEST/PROD.

Exact pool numbers are implementation configuration, validated from provider limits and runtime load; they are not embedded as business constants.

## 14. Multiuser TEST matrix

TEST requires separate:
- ADMIN;
- USER_A;
- USER_B.

Mandatory scenarios:
- independent first sign-in;
- simultaneous login;
- conflicting preference values;
- same shared job with different FIT/state;
- independent applications;
- profile/object ID tampering;
- ADMIN lifecycle operations;
- ADMIN personal-content denial;
- deactivation + active-session invalidation;
- reactivation;
- deletion;
- re-signup after deletion;
- pooled connection tenant switch;
- provider-call count unaffected by user count.

## 15. Environment sequence

Current prerequisite:

```text
#439
GCP DEV aligned
 -> GCP TEST equivalent/stable
```

Multiuser sequence after explicit ATC authorization:

```text
DEV implementation
 -> Evidence Bundle
 -> Independent Review
 -> full DEV functional acceptance
 -> immutable candidate freeze
 -> exact candidate to TEST
 -> independent multiuser/security acceptance
 -> release gate
 -> explicit PROD_GO
 -> PROD
```

No Multiuser change is applied directly to TEST or PROD.

## 16. PROD hard gates

All required:
- stable GCP DEV -> TEST promotion path;
- full multiuser TEST PASS;
- runtime/DDL privilege separation PASS;
- RLS negative matrix PASS;
- session revocation/deactivation PASS;
- owner bootstrap/migration parity PASS;
- backup/rollback prerequisites PASS;
- one authority per migrated domain;
- exact candidate identity recorded;
- explicit `PROD_GO`.

## 17. Stage-2 email/password compatibility

Stage 1 must leave:
- `app_user`;
- `profile`;
- RLS;
- application session;
- lifecycle;
- personal/shared ownership

independent of Google.

A later email/password design changes identity establishment only. It does not justify duplicating user/profile rows or building separate personal-data ownership.

## 18. References

- #265
- #275
- #425
- #439
- #450
- ADR-003
- ADR-004
- ADR-005
- ADR-006
- ADR-007
- `docs/multiuser-auth-security-contract.md`
- `docs/software-delivery-lifecycle.md`
