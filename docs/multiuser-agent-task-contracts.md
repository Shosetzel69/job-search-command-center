# Multiuser Agent Task Contracts — Google-first Stage 1

Status: **WORKING**  
Version: **v1.3**  
Applicability: **CURRENT**  
Applies to: **AGENTFLOW**  
Phase: **TASK_CONTRACT**  
Workflow status: **TASK_CONTRACT_PROPOSED**  
Parent requirement: #265  
Development Analysis: #275  
Architecture tracker: #450  
Architecture: ADR-005, ADR-006, ADR-007, ADR-008

## 1. Purpose

Persist the proposed Multiuser Agent Task Contracts in the repository so implementation scope, acceptance and evidence can be independently reviewed from an exact candidate SHA.

These contracts are **not executable** until the owner issues the exact AgentFlow token:

`APPROVE_TASK_CONTRACT <ATC-ref>`

No contract below authorizes code, schema/data mutation, deploy, DEV/TEST/PROD change or release promotion by its existence.

### ATC authority note

This repository document is authoritative for the ADR-008-affected contracts `ATC-275-04/05/06/07A/07B/08/09/11`. Unaffected `ATC-275-01/02/03/10` remain canonically defined in #275 until separately persisted/revised; before execution they must be checked for compatibility with ADR-008 and must not reintroduce RLS assumptions.

## 2. Shared constraints

All Multiuser ATCs preserve:
- Google Identity Services as Stage-1 IdP;
- `Google sub -> user_identity -> app_user -> profile`;
- exactly one profile per user in MVP;
- USER and ADMIN roles only;
- shared/system-owned external collection;
- profile-owned preference/FIT/state/application data;
- server-derived AuthContext;
- mandatory ADR-008 Nile-native tenant isolation through the fail-closed Tenant Data Gateway for profile/personal tables;
- no ADMIN personal-content bypass;
- no permanent JSON/PostgreSQL dual-write;
- ADR-006 Cloud Run/Nile runtime boundary;
- no cross-environment fallback;
- no PROD execution without canonical release gates;
- provider-sensitive schema/transaction behavior requires current Nile documentation review + official Nile testing-container PASS before managed DEV mutation; generic PostgreSQL CI is portability evidence only.

# ATC-275-04 v2 — User / external identity / profile core + tenant isolation

## Objective

Establish the multiuser tenancy foundation without opening public multiuser access.

## Scope

- create `app_user` with opaque UUID `user_id`;
- role constraint `USER|ADMIN`;
- lifecycle state `ACTIVE|DEACTIVATED`; nullable internal `deletion_started_at` is permitted solely as irreversible-delete progress metadata and is not a third business status;
- create `user_identity`;
- Stage-1 provider `GOOGLE`;
- store Google `sub` only as `provider_subject`;
- optional account email/email_verified metadata;
- allocate separate opaque UUID `profile_id` and create Nile `tenants(id = profile_id, name = <opaque non-PII label>)`;
- create global `profile(profile_id, user_id -> app_user, provisioned_at NULL)` mapping with exactly one profile/tenant per user MVP; `profile_id == tenants.id` is a logical provisioning invariant and no physical shared->tenant FK is used; `provisioned_at` becomes non-null only after required tenant/personal initialization succeeds;
- introduce the narrow Account Provisioning Gateway for self-service/bootstrap global account+tenant metadata writes; it has no personal-content SELECT/list/export capability;
- bootstrap current owner as ADMIN + GOOGLE identity + Nile tenant + profile mapping through provider-compatible idempotent shared / tenant-control / tenant-data transaction boundaries;
- tenant-aware personal tables use physical `tenant_id = profile_id`, tenant-qualified primary/unique keys and required FK to `tenants(id)`;
- introduce server-derived tenant context:
  - tenant authority comes only from authenticated `AuthContext.profile_id`;
  - Nile global mode without tenant context is explicitly cross-tenant capable and is not a DB-level deny state;
- introduce the fail-closed Tenant Data Gateway / profile-scoped transaction boundary;
- establish `SET LOCAL nile.tenant_id` transaction-locally before personal SQL; provider-sensitive schema/transaction contracts must pass the official Nile testing container before managed DEV execution;
- add canonical personal-table registry plus CI/static guard preventing personal-table SQL/raw-query escape outside the Tenant Data Gateway, Account Lifecycle Gateway, migrations and scoped tests; tenant-management primitives are additionally allowlisted only for Account Provisioning Gateway / Account Lifecycle Gateway / migrations/tests;
- ensure shared/system repositories and collection jobs have no dependency path to personal repositories;
- negative tenant-isolation tests including pooled-connection reuse, rollback, missing-context gateway rejection and non-gateway boundary checks.

## Out of scope

- public self-service sign-up;
- JSCC application-session cutover;
- preferences/FIT implementation;
- applications migration;
- account deletion API/UI;
- multiple profiles;
- email/password.

## Dependencies

- ATC-275-01 PostgreSQL repository foundation complete;
- ADR-005/006/007/008;
- #439 environment lifecycle stable before execution begins.

## Constraints

- `Google sub` cannot be application PK/FK;
- browser user/profile IDs cannot establish tenant authority;
- Stage-1 personal tables use physical `tenant_id`; logical `profile_id` is mapped at the repository boundary and is not duplicated as a second ownership column;
- runtime code receives repository/AuthContext interfaces, not generic SQL;
- ADMIN receives no cross-user personal tenant bypass.

## Acceptance criteria

- `UNIQUE(user_identity.provider, user_identity.provider_subject)`;
- `UNIQUE(user_identity.user_id, user_identity.provider)`;
- `UNIQUE(profile.user_id)`;
- `profile.profile_id = tenants.id` and the tenant row has no PII name/content;
- owner bootstrap converges deterministically/idempotently across provider-compatible transaction boundaries, produces one user/identity/profile/tenant, and is not considered complete until required tenant-aware initialization succeeds and `profile.provisioned_at` is non-null;
- official Nile testing-container evidence proves tenant isolation, shared-read + tenant-write, rejection of mixed shared-write + tenant-write, required tenant cascade behavior and all provider-sensitive schema constraints before managed DEV;
- missing tenant context is rejected by the Tenant Data Gateway before personal SQL; direct Nile global mode is explicitly cross-tenant capable;
- profile A cannot read/write profile B through the approved gateway/repository path;
- ADMIN test principal cannot read/write B personal rows;
- pooled connection A -> B and rollback A -> B carry no A context;
- CI/static guard rejects personal-table SQL or generic raw DB escape outside allowlisted gateway/migration/test modules and rejects tenant-management writes outside Account Provisioning/Lifecycle Gateway or migrations/tests;
- collection/shared-system paths cannot import/use personal repositories;
- runtime operating under tenant A cannot read/write tenant B personal data through the approved gateway/repository path;
- no environment fallback.

## Retry limit

2 implementation approaches. Then `IMPLEMENTATION_BLOCKED`.

## Stop conditions

- Nile cannot provide tenant-scoped isolation once tenant context is set;
- provider-compatible idempotent account/profile/tenant provisioning cannot converge fail-closed without duplicate identity/profile/tenant state;
- tenant context, required shared-read + tenant-write behavior, or required tenant-delete cascade is unsupported on the current backend;
- normal personal operations require bypass of the Tenant Data Gateway;
- tenant context must be browser-selected rather than server-derived;
- new identity provider/service is required.

## Evidence Bundle

- migration/schema;
- role/constraint matrix;
- tenant-aware schema including `tenants` lifecycle, physical `tenant_id` keys/FKs, Tenant Data Gateway and Nile tenant-context implementation;
- exact tenant-context implementation;
- owner bootstrap evidence;
- negative matrix including A/B cross-tenant denial, gateway missing-context rejection before SQL, rollback cleanup, pool-reuse and non-gateway CI/static boundary tests;
- pool-reuse isolation proof;
- exact PR/SHA and tests;
- official Nile testing-container run/result for provider-sensitive contracts.

# ATC-275-05 v2 — Profile preferences, personal job state and FIT

## Objective

Split the current singleton `search-config.json` into profile-owned preferences and shared/system collection policy, then make job state/evaluation profile-owned.

## Scope

Implement the exhaustive mapping in `docs/multiuser-data-migration-plan.md` and `docs/data-contract.md`.

Profile-owned target includes:
- role groups;
- work modes and work-mode priority;
- contract types;
- display freshness;
- FIT threshold;
- repost preference;
- compensation;
- immediate-start preference;
- target/excluded geography;
- remote-eligible geography;
- human and machine personal exclusions.

System/collection target includes:
- collection freshness;
- source strategy;
- browser fallback;
- JobsPipe mode/budgets/guards/overlap/item limits.

Also:
- profile job seen/review/archive state;
- profile eligibility/FIT evaluation;
- evaluation versioning;
- current-owner deterministic import;
- rollback compatibility projection only inside defined window.

## Out of scope

- application history;
- new FIT algorithm semantics;
- external collection scheduler implementation;
- global compliance exclusions not already approved;
- email/password.

## Dependencies

- ATC-275-03 shared canonical job corpus;
- ATC-275-04 v2.

## Constraints

- `search_country_codes` is compatibility-derived then retired;
- profile target geography and remote-eligibility geography remain distinct;
- preference save never triggers provider retrieval;
- no mixed global singleton target;
- no permanent dual-write;
- shared reads may occur in the tenant-scoped transaction, but shared writes must not be mixed transactionally with tenant-aware writes;
- personal `job_id` references to shared canonical jobs are logical references without a physical cross-plane FK.

## Acceptance criteria

- mixed shared-job read + personal FIT/evaluation write uses one Tenant Data Gateway transaction with tenant context established first; official Nile-container evidence proves shared-read + tenant-write is supported while shared-write + tenant-write is rejected;
- every current top-level `search-config.json` key has exactly one disposition: profile/system/derived/retired;
- mapping is identical to canonical data/migration docs;
- two profiles may hold contradictory preferences without overwrite;
- same shared job may have different state/FIT by profile;
- profile change produces zero provider calls;
- old personal config is no longer system authority after cutover;
- rollback authority and window documented;
- no stale compatibility write remains after target authority switch.

## Retry limit

2.

## Stop conditions

- field cannot be classified without new product semantics;
- implementation recreates mixed singleton authority;
- provider retrieval becomes profile-triggered.

## Evidence Bundle

- legacy->target field matrix;
- import parity;
- profile A/B preference isolation;
- same-job/different-FIT proof;
- zero-provider-call proof;
- read/write authority statement;
- rollback evidence.

# ATC-275-06 v2 — Profile-owned applications

## Objective

Move application history into the personal tenant domain without coupling it to shared-job lifecycle.

## Scope

- `applications` with physical `tenant_id = logical profile_id`;
- mandatory ADR-008 tenant-aware persistence through the Tenant Data Gateway;
- `tenant_id -> tenants(id)` with tenant-qualified application key;
- optional canonical `job_id` stored as a logical shared reference without a physical tenant-aware->shared FK;
- external application with `job_id = NULL`;
- application-time snapshot fields;
- canonical application-status validation;
- current owner import;
- tenant-scoped object lookup/update/delete.

## Out of scope

- recruitment-email ingestion;
- CV/ATS functionality;
- new application workflow statuses;
- shared job lifecycle changes.

## Dependencies

- ATC-275-03;
- ATC-275-04 v2.

## Constraints

- application belongs to exactly one profile;
- shared job deletion/inactivation cannot erase application history;
- non-null `job_id` supplied by a user write is validated through a shared canonical-job read under the authenticated tenant transaction;
- cross-tenant object probing must not disclose ownership.

## Acceptance criteria

- deterministic/idempotent import;
- A can read/write A application;
- A using B application UUID receives not-found-equivalent result;
- ADMIN cannot read B applications;
- A/B cross-tenant and pooled-connection tenant-isolation negative tests pass;
- external application works with NULL `job_id`;
- snapshot survives shared job changes;
- invalid/nonexistent non-null shared `job_id` is rejected before tenant application persistence;
- deleting the Nile tenant removes the application through verified tenant FK/cascade behavior.

## Retry limit

2.

## Stop conditions

- requires ADMIN personal-content bypass;
- requires shared job to own application lifecycle;
- cannot preserve current owner history deterministically.

## Evidence Bundle

- schema/migration;
- import parity;
- tenant-isolation/IDOR tests;
- lifecycle/cascade tests;
- exact candidate.

# ATC-275-07A — Google authentication + JSCC application sessions + self-service provisioning

## Objective

Replace the single `ALLOWED_GOOGLE_SUB` authorization boundary with Google-first account resolution and revocable JSCC application sessions.

## Scope

- Google token verification server-side;
- resolve `GOOGLE/sub -> user_identity -> app_user -> profile`;
- first valid unknown Google identity provisions ACTIVE USER + GOOGLE identity + global profile mapping, Nile tenant and required tenant initialization through the ADR-008 idempotent provider-compatible transaction sequence;
- capacity/admission guard applies before provisioning;
- 256-bit CSPRNG opaque session token;
- persist SHA-256 token hash only;
- `__Host-jscc_session; Secure; HttpOnly; SameSite=Strict; Path=/`;
- absolute Stage-1 session lifetime 60 minutes;
- fresh session after authentication;
- session/account status checked for protected requests;
- logout revokes session and clears cookie;
- server-derived `AuthContext(user_id,profile_id,role,status)`;
- after cutover, normal protected browser endpoints authenticate via JSCC session;
- Google bearer remains session-establishment credential only;
- legacy cookie containing Google JWT is rejected/cleared and user reauthenticates once;
- remove `ALLOWED_GOOGLE_SUB` as authorization authority at cutover;
- same-origin/`FRONTEND_ORIGIN` validation for session establishment and cookie-auth mutations.

## Out of scope

- email/password;
- account ADMIN lifecycle/delete;
- multiple profiles;
- identity linking between providers.

## Dependencies

- ATC-275-04 v2;
- account-admission/capacity contract from ATC-275-10 for PROD enablement;
- #439 before DEV execution.

## Constraints

- no token in browser Web Storage;
- no raw session token or Google ID token in DB/logs;
- no Google-bearer fallback for protected resources;
- no legacy allowlist fallback;
- invalid capacity admission is rejected before provisioning mutation; an interrupted admitted provisioning sequence is not session-usable and must resume idempotently without duplicate account/profile/tenant state.

## Acceptance criteria

- valid existing Google identity -> fresh JSCC session only when `profile.provisioned_at` is non-null and `deletion_started_at` is null; incomplete provisioning is resumed instead of issuing a session;
- valid unknown identity -> exactly one USER + Nile tenant + profile mapping when capacity gate open, with session issued only after required tenant initialization completes;
- concurrent first sign-in -> one account/tenant/profile;
- capacity gate closed -> no user/identity/profile/tenant mutation;
- bad signature/issuer/audience/expiry -> 401;
- revoked/expired session -> 401;
- DEACTIVATED account is denied even if stale session row remains;
- legacy Google-JWT cookie is not reinterpreted as application session;
- Google bearer direct to ordinary protected endpoint after cutover is rejected;
- cross-origin session establishment/mutation denied;
- no secrets/tokens in logs/storage.

## Retry limit

2.

## Stop conditions

- requires direct bearer bypass;
- requires email as identity key;
- requires a new auth provider;
- requires paid service without owner decision.

## Evidence Bundle

- auth flow tests;
- first-sign-in race/retry test including convergence of separated shared/tenant transaction boundaries;
- session persistence/revocation tests;
- legacy-cookie cutover proof;
- origin/CORS evidence;
- token/secret log scan;
- exact PR/SHA.

# ATC-275-07B — Account lifecycle, ADMIN boundary and irreversible deletion

## Objective

Implement account lifecycle over the approved identity/session foundation without granting ADMIN access to personal content.

## Scope

- ACTIVE <-> DEACTIVATED;
- deactivation revokes all live sessions; reactivation is prohibited when `deletion_started_at` is non-null;
- reactivation restores retained data but not old sessions;
- ADMIN lifecycle endpoints;
- ADMIN remains USER for own profile only;
- hard-delete through the narrow Account Lifecycle Gateway using provider-compatible idempotent transaction boundaries;
- shared-only phase persists `deletion_started_at`, deactivates the account and revokes sessions;
- tenant-control phase deletes `tenants.id = profile_id` and removes tenant-aware personal rows through verified cascade;
- shared-only final phase deletes `app_user`, removing identity/session/profile metadata through shared-account cascades and writing the allowed non-identifying audit;
- preserve shared/system data;
- optional 90-day non-identifying deletion event;
- re-signup after delete creates new account/profile.

## Out of scope

- support impersonation;
- delegated personal access;
- generic admin SQL;
- password reset;
- recoverable product tombstone.

## Dependencies

- ATC-275-04 v2;
- ATC-275-05 v2;
- ATC-275-06 v2;
- ATC-275-07A.

## Constraints

- ADMIN does not assume/select the target user's Nile tenant context;
- ADMIN does not get generic cross-user personal tenant authority;
- delete does not read/export target personal rows;
- shared/system product tables have no ownership cascade from user/profile/tenant; the global `profile` mapping is account metadata and is removed through `app_user` cascade, not tenant cascade.

## Acceptance criteria

- ACTIVE -> DEACTIVATED immediately denies current sessions;
- reactivation requires fresh auth and restores retained workspace only when `deletion_started_at` is null;
- ADMIN delete returns lifecycle metadata only; crash/retry after deletion starts cannot reactivate the account and resumes from persisted `deletion_started_at`;
- deleting account leaves zero Nile tenant/profile/personal/identity/session rows after all idempotent phases complete;
- shared canonical jobs/sources/system state remain;
- ADMIN cannot read B personal data before/during/after deletion;
- deletion mechanism cannot be reused as list/export path;
- optional deletion event contains no identifier/email/sub/relinkable hash/content;
- re-signup after deletion creates different user/profile IDs.

## Retry limit

2.

## Stop conditions

- Nile tenant/personal cascade cannot be proven complete;
- implementation requires target tenant impersonation;
- implementation requires cross-user personal tenant bypass;
- delete requires returning personal payload.

## Evidence Bundle

- tenant/account schema, tenant-aware cascade proof and staged deletion/retry proof;
- deactivation/session proof;
- ADMIN negative privacy matrix;
- deletion before/after counts without personal payload;
- audit sample;
- re-signup proof;
- exact candidate.

# ATC-275-08 v2 — Global ADMIN scheduler and collection authorization

## Objective

Implement the ADR-005 global collection/scheduler model using application authorization rather than single-user Google claims.

## Scope

- one global automation configuration/state;
- ADMIN/system-controlled scheduled collection;
- ADMIN-only exceptional manual collection;
- USER has no Run/Search provider retrieval capability;
- one heavy collection admitted at a time per environment;
- observable scheduled/manual origin;
- profile preference changes cause personal re-evaluation only;
- rebaseline legacy #86/#97-#101 semantics.

## Out of scope

- per-user scheduler;
- profile-triggered provider retrieval;
- multiple heavy collections;
- connector redesign.

## Dependencies

- ATC-275-01;
- ATC-275-02;
- ATC-275-03;
- ATC-275-07A AuthContext.

## Constraints

- authorization uses `AuthContext.role`, never Google sub/email;
- user count does not multiply provider traffic.

## Acceptance criteria

- USER cannot trigger provider retrieval;
- ADMIN/system may trigger according to policy;
- at most one heavy collection admitted;
- no-op scheduler tick has zero provider calls;
- preference update has zero provider calls;
- output lands in shared corpus;
- obsolete profile-owned scheduler assumptions explicitly removed/reframed.

## Retry limit

2.

## Stop conditions

- user-owned provider retrieval required;
- per-profile external scheduler reintroduced;
- new orchestration architecture required.

## Evidence Bundle

- scheduler authorization tests;
- admission/concurrency evidence;
- provider-call invariance;
- mapping of superseded legacy scheduler tickets;
- exact candidate.

# ATC-275-09 v2 — Runtime privilege evidence + compensating isolation controls

## Objective

Prove the strongest database privilege separation Nile supports and the mandatory compensating controls required because the runtime credential remains cross-tenant capable in Nile global mode.

## Scope

- environment-specific Cloud Run runtime identity;
- Secret Manager runtime DB credential;
- runtime credential supports required repository DML to the strongest demonstrable Nile capability;
- migration identity can apply approved DDL where separable;
- runtime DDL negative evidence is collected where the provider exposes separable privileges;
- runtime is not superuser where this is inspectable;
- explicitly record that no-tenant Nile global mode remains cross-tenant capable under the runtime DB credential;
- implement/verify personal-table registry, gateway-only SQL guard, no raw DB escape, shared/system-to-personal dependency prohibition, narrow Account Lifecycle Gateway and aggregate-only Cross-Tenant Reference Guard;
- DEV first, then TEST proof;
- explicit owner acceptance of the documented global-mode residual risk is required before PROD Multiuser.

## Out of scope

- describing compensating controls as equivalent to database default-deny;
- PROD cutover without proof;
- auth/tenant-isolation redesign.

## Dependencies

- ATC-275-01.

## Constraints

- ADR-006 path: `Cloud Run -> repository/data-access -> pg -> Nile`;
- no cross-environment credential reuse/fallback.

## Acceptance criteria

- runtime CRUD required by application works;
- strongest demonstrable runtime-vs-migration privilege separation is documented and tested;
- migration identity applies migration where separately supported;
- Nile-native A/B tenant-isolation negative tests pass when tenant context is set;
- gateway rejects missing context before personal SQL;
- CI/static guard rejects non-gateway personal-table SQL/raw DB escape and collection/shared-system dependency on personal repositories, except the separately allowlisted aggregate-only Cross-Tenant Reference Guard;
- Account Lifecycle Gateway is the only allowlisted normal-runtime global personal-domain mutation path and exposes no personal read/list/export; Cross-Tenant Reference Guard is read-only aggregate evidence only;
- explicit owner residual-risk acceptance is recorded for the exact reviewed architecture candidate;
- DEV and TEST binding evidence contains no secrets.

## Retry limit

2 technical approaches, then `IMPLEMENTATION_BLOCKED`.

## Stop conditions

- Nile cannot provide any meaningful privilege separation and the residual risk exceeds the explicitly accepted architecture risk;
- separation requires unsupported paid architecture without decision.

## Evidence Bundle

- role/privilege matrix including explicit Nile global-mode cross-tenant capability;
- negative DDL tests where supported;
- privilege-separation, CI/static guard and tenant-adapter evidence;
- environment binding evidence;
- provider limitation evidence if blocked.

# ATC-275-11 v2 — Integrated Multiuser evidence and independent TEST contract

## Objective

Prove all implemented Multiuser slices work together and produce an exact immutable candidate for independent TEST.

## Scope

- integrated regression across migrated domains;
- authority declaration per domain;
- rollback-window verification;
- three-identity multiuser matrix;
- shared collection/provider-call invariance;
- ADMIN privacy;
- account lifecycle/deletion;
- session revocation/legacy-cookie cutover;
- pooled-connection tenant isolation;
- runtime privilege evidence;
- migration versions;
- TEST contract for exact ADR-006 candidate.

## Out of scope

- new features;
- architecture changes;
- PROD GO/deploy;
- fixing TEST/PROD directly.

## Dependencies

- relevant completed ATC-275-01..08 slices;
- ATC-275-09 PASS before Multiuser PROD candidate;
- ATC-275-10 PASS before irreversible PROD migration/Multiuser enablement;
- #439 stable DEV->TEST lifecycle.

## Constraints

TEST identities:
- TEST_ADMIN;
- TEST_USER_A;
- TEST_USER_B.

No credentials are stored in repository/evidence.

## Acceptance criteria

- every migrated domain has exactly one authority;
- no permanent dual-write;
- A/B concurrent sessions PASS;
- conflicting profile preferences do not overwrite;
- same shared job has independent A/B state/FIT;
- applications independent;
- IDOR/object probing negative tests PASS;
- ADMIN cannot read another user's personal content;
- ADMIN cascade-delete/no-impersonation/no-personal-read PASS;
- deactivation invalidates live session;
- reactivation requires fresh auth and restores retained data;
- tenant-row deletion + zero-residue + re-signup with new tenant/profile IDs PASS;
- runtime A/B cross-tenant denial with tenant context PASS;
- pooled A->B and rollback A->B connection has no tenant leakage;
- missing tenant context is rejected by Tenant Data Gateway before personal SQL;
- CI/static non-gateway personal-table/raw-query boundary PASS;
- legacy-cookie forced reauthentication PASS;
- account-admission capacity guard PASS;
- user count does not multiply provider calls;
- full relevant CI green, including official Nile testing-container compatibility for provider-sensitive contracts;
- full DEV functional acceptance suite passes before candidate freeze;
- exact SHA/image digest preserved into TEST contract.

## Retry limit

1 integration correction cycle, then `IMPLEMENTATION_BLOCKED`.

## Stop conditions

- any architecture invariant above requires change;
- required security/privilege evidence unavailable;
- mandatory environment suite has FAIL/BLOCKED;
- exact candidate identity cannot be preserved.

## Evidence Bundle

- full AC matrix;
- exact PR/SHA/image digest;
- migration versions per environment;
- authority matrix;
- tenant-isolation/IDOR/concurrency results;
- account/session lifecycle results;
- privilege/compensating-control/residual-risk gate results;
- provider-call invariance;
- rollback anchors;
- known limitations;
- independent TEST handoff.

## 3. Dependency spine

```text
ATC-275-01
   ├─> ATC-275-03 shared corpus
   ├─> ATC-275-04 v2 identity/profile/Nile tenant isolation
   ├─> ATC-275-09 v2 privilege gate
   └─> ATC-275-10 backup/capacity

ATC-275-03 + ATC-275-04 v2
   ├─> ATC-275-05 v2 preferences/FIT
   └─> ATC-275-06 v2 applications

04 + 05 + 06
   -> ATC-275-07A auth/session

07A + 05 + 06
   -> ATC-275-07B lifecycle/admin/delete

01 + 02 + 03 + 07A
   -> ATC-275-08 v2 scheduler

completed relevant slices + 09 security gate
   -> ATC-275-11 v2 integrated evidence / TEST contract
```

## 4. Current execution state

All contracts in this document are `TASK_CONTRACT_PROPOSED`.

Architecture approval does **not** authorize their execution.

The first implementation step remains blocked until:
1. documentation/remediation review passes;
2. #439 establishes the stable DEV->TEST lifecycle;
3. the owner issues the exact `APPROVE_TASK_CONTRACT <ATC-ref>` token for the selected first contract.
