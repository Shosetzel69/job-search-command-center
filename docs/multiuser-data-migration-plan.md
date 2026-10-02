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

## 5. `search-config.json` exhaustive field ownership

The current file is a mixed transitional contract and has no 1:1 target. Every current top-level key has exactly one target disposition:

| Legacy top-level key | Disposition | Explicit target | Rationale |
|---|---|---|---|
| `schema_version` | retired | none; target DB/contracts carry their own schema/migration versions | legacy JSON envelope metadata |
| `role_groups` | profile | `profile_preferences.role_groups` | personal target-role choice |
| `work_modes` | profile | `profile_preferences.work_modes` | personal work-mode eligibility |
| `contract_types` | profile | `profile_preferences.contract_types` | personal contract preference |
| `freshness_hours` | profile | `profile_preferences.display_freshness_hours` | user-visible job-age preference |
| `collection_freshness_hours` | system | `collection_policy.collection_freshness_hours` | provider retrieval lookback, independent of profile |
| `fit_threshold` | profile | `profile_preferences.fit_threshold` | personal evaluation/display threshold |
| `keep_reposts` | profile | `profile_preferences.keep_reposts` | personal presentation/evaluation preference |
| `rate_min_eur_day` | profile | `profile_preferences.rate_min_eur_day` | personal compensation constraint |
| `rate_max_eur_day` | profile | `profile_preferences.rate_max_eur_day` | personal compensation constraint |
| `immediate_start` | profile | `profile_preferences.immediate_start` | personal availability criterion |
| `target_regions` | profile | `profile_preferences.target_regions` | personal target geography |
| `target_country_codes` | profile | `profile_preferences.target_country_codes` | personal explicit target countries |
| `excluded_regions` | profile | `profile_preferences.excluded_regions` | personal geographic exclusion |
| `excluded_country_codes` | profile | `profile_preferences.excluded_country_codes` | personal geographic exclusion |
| `search_country_codes` | derived then retired | compatibility projection of `profile_preferences.target_country_codes` during rollback window only | legacy fallback alias; never a second authority |
| `eligible_remote_country_codes` | profile | `profile_preferences.remote_eligible_country_codes` | personal remote-eligibility geography, distinct from search-target geography |
| `work_mode_priority` | profile | `profile_preferences.work_mode_priority` | personal ordering preference |
| `source_strategy` | system | `collection_policy.source_strategy` | shared provider/source collection policy |
| `web_browser_fallback_enabled` | system | `collection_policy.web_browser_fallback_enabled` | shared connector transport behavior |
| `jobspipe_credit_budget_per_run` | system | `collection_policy.jobspipe_credit_budget_per_run` | shared provider budget |
| `jobspipe_monthly_credit_guard` | system | `collection_policy.jobspipe_monthly_credit_guard` | shared cost/capacity guard |
| `jobspipe_incremental_overlap_minutes` | system | `collection_policy.jobspipe_incremental_overlap_minutes` | shared provider incremental-fetch policy |
| `exclusions` | profile | `profile_preferences.exclusions` | human-readable personal exclusion rules |
| `excluded_company_patterns` | profile | `profile_preferences.excluded_company_patterns` | current values encode profile-specific company exclusions; system-wide bans require a separate system policy |
| `excluded_role_keywords` | profile | `profile_preferences.excluded_role_keywords` | current values encode profile-specific role exclusions; not shared source governance |
| `deep_erp_terms` | profile | `profile_preferences.deep_erp_terms` | profile-specific exclusion evidence for deep ERP roles |
| `jobspipe_mode` | system | `collection_policy.jobspipe_mode` | provider transport/enablement policy |
| `jobspipe_apify_max_items_per_run` | system | `collection_policy.jobspipe_apify_max_items_per_run` | shared provider execution limit |

### 5.1 Dual-meaning separation invariants

Legacy fields that previously affected both collection and presentation are split explicitly:
- `freshness_hours` -> `profile_preferences.display_freshness_hours`;
- `collection_freshness_hours` -> `collection_policy.collection_freshness_hours`.

Geography remains semantically distinct:
- `target_country_codes` / `target_regions` define what the profile searches/evaluates for;
- `remote_eligible_country_codes` defines where a remote role may be acceptable to that profile;
- `search_country_codes` is compatibility-only and is retired after rollback compatibility ends.

Machine exclusion fields remain profile-owned in Stage 1 because their current semantics implement the user's personal job-fit exclusions. A future global compliance/policy exclusion must use a separately named system-owned contract and must not overload these profile fields.

No target implementation may recreate the legacy mixed singleton as an authoritative JSON/JSONB blob.

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

### MU-S1 — User/profile/identity/Nile tenant-isolation foundation

DEV only after explicit ATC approval.

Creates:
- app user;
- external identity;
- profile;
- transaction-local Nile tenant context;
- fail-closed Tenant Data Gateway / tenant-aware personal persistence;
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

Authority during this slice:
- PostgreSQL is the target authority for the new shared canonical-job/source-posting domain once the slice is accepted;
- persistence succeeds before the legacy single-user jobs snapshot may be published;
- `data/jobs.json` remains the legacy personal/current-user view until MU-S3 and is not treated as a second shared-corpus authority;
- no profile FIT/status/pros/risks are stored in shared rows;
- current usable jobs may be seeded idempotently with deterministic shared IDs; this is a bounded seed, not a claim of exhaustive historical recovery;
- `retention_until` is recorded in S2, while physical purge stays disabled until retained personal references can be checked safely.

Does not:
- expose multiple users yet;
- move personal evaluation into shared rows.

Rollback:
- old jobs JSON remains read authority for the legacy single-user view during the declared rollback window;
- the additive shared tables may remain unused if S2 is rolled back before downstream profile cutover.

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
- cross-profile Nile tenant-isolation tests, including missing-context and pooled-connection reuse.

### MU-S5 — Google multiuser auth/session/lifecycle

After MU-S1/S3/S4 are stable:
- replace `ALLOWED_GOOGLE_SUB` authorization with account lookup/provisioning;
- clear/reject legacy Google-JWT session cookies and require one-time Google reauthentication into the new JSCC session model;
- exchange Google credential for JSCC session;
- enable self-service first sign-in subject to the approved account-admission/capacity guard;
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

## 11.1 ADMIN delete implementation contract

The target deletion path is schema-driven and does not require ADMIN to enter the target tenant context.

Required foreign keys:
- `user_identity.user_id -> app_user(user_id) ON DELETE CASCADE`;
- `user_session.user_id -> app_user(user_id) ON DELETE CASCADE`;
- `profile.user_id -> app_user(user_id) ON DELETE CASCADE`;
- every profile-owned personal-content row: `profile_id -> profile(profile_id) ON DELETE CASCADE`.

ADMIN performs a narrow AccountRepository delete of the target `app_user` after role/lifecycle authorization. The operation:
- must not select/export target personal rows;
- must not assume/select the target user's Nile tenant context;
- must not receive a generic cross-user personal tenant capability;
- returns only lifecycle result metadata;
- leaves shared/system data unchanged.

DEV and TEST integration evidence must prove zero personal residue after cascade and no personal-content exposure during the operation.

## 12. Database privilege gate

Before PROD multiuser:
- account-admission/capacity guard prevents new self-service accounts from causing automatic paid capacity consumption;
- account/profile tenant ownership uses ADR-008 Nile-native tenant isolation;
- `profile.profile_id` is the canonical Nile tenant identifier for Multiuser MVP;
- every Stage-1 personal-content table is profile-owned and tenant-aware;
- all personal persistence passes through the fail-closed Tenant Data Gateway with transaction-local Nile tenant context;
- routine runtime credential supports only required application DML to the strongest demonstrable extent supported by Nile;
- migration identity owns approved DDL/migration capability where separable;
- runtime DDL negative evidence is required where the provider exposes separable privileges;
- environment bindings remain independent.

If Nile cannot provide the required tenant isolation, or leaves a material runtime privilege risk that cannot be bounded by the approved adapter/credential model, multiuser PROD is blocked and returns to Architecture.

## 13. Connection-pool safety

Cloud Run may scale horizontally.

Requirements:
- use a bounded pool per instance;
- do not size pools as if only one service instance exists;
- Nile tenant context is always transaction-local;
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
- tenant-isolation negative matrix PASS, including A/B cross-tenant denial, missing-context fail-closed, rollback cleanup and pooled-connection reuse;
- ADMIN cascade-delete/no-impersonation/no-personal-read PASS;
- session revocation/deactivation PASS;
- legacy-cookie cutover / forced reauthentication PASS;
- new-account capacity admission guard PASS;
- owner bootstrap/migration parity PASS;
- backup/rollback prerequisites PASS;
- one authority per migrated domain;
- exact candidate identity recorded;
- explicit `PROD_GO`.

## 17. Stage-2 email/password compatibility

Stage 1 must leave:
- `app_user`;
- `profile`;
- ADR-008 Nile-native tenant isolation;
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
