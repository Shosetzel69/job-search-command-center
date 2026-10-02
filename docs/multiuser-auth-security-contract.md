# Multiuser Authentication and Tenant Security Contract

Status: **CANONICAL**  
Version: **v1.2**  
Applicability: **CURRENT**  
Applies to: **AGENTFLOW**  
Effective from: **2026-10-02**  
Parent: #265  
Architecture: ADR-005, ADR-007, ADR-008  
Tracker: #450

## 1. Purpose

Define the implementation contract for Google-first multiuser identity, application sessions, authorization, tenant isolation, account lifecycle and ADMIN privacy.

This document is a target contract. It does not describe the current single-user runtime as already migrated.

## 2. Identity model

### 2.1 Account

`app_user`
- `user_id UUID PRIMARY KEY`;
- `role` constrained to `USER|ADMIN`;
- `status` constrained to `ACTIVE|DEACTIVATED`;
- `created_at`, `updated_at`.

`DELETED` is an irreversible operation, not a retained row state.

### 2.2 External identity

`user_identity`
- `identity_id UUID PRIMARY KEY`;
- `user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE`;
- `provider TEXT NOT NULL`;
- `provider_subject TEXT NOT NULL`;
- `email TEXT NULL`;
- `email_verified BOOLEAN NOT NULL DEFAULT false`;
- `created_at`.

Constraints:
- `UNIQUE(provider, provider_subject)`;
- `UNIQUE(user_id, provider)` for MVP.

Stage 1 supports only `provider=GOOGLE`.

`provider_subject` is Google `sub`. Email is display/account metadata, not an authorization key.

### 2.3 Profile

`profile` is global account/tenant metadata, not a tenant-aware personal-content table:
- `profile_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE`;
- `user_id UUID NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE`;
- timestamps only; no professional profile/preferences/personal workspace payload.

`profile_id` is both the logical JSCC profile identifier and the Nile tenant identifier.

Tenant-aware personal-content tables store physical `tenant_id UUID NOT NULL`, where `tenant_id = AuthContext.profile_id`, and use tenant-qualified keys/foreign keys.

MVP invariant: exactly one profile/tenant per account.

## 3. Authentication flow

### 3.1 Google verification

The server validates the Google credential:
- JWT signature against Google keys;
- issuer;
- audience == environment `GOOGLE_CLIENT_ID`;
- expiration/not-before semantics supported by the JWT library;
- non-empty `sub`.

No authorization decision uses browser-provided email, user id or profile id.

### 3.2 Account resolution

After verification:

```text
GOOGLE/sub
  -> user_identity
  -> app_user
  -> profile
```

If identity exists:
- ACTIVE -> continue;
- DEACTIVATED -> deny.

If identity does not exist, one global transaction:
- allocates `user_id` and `profile_id`;
- creates ACTIVE USER;
- creates GOOGLE identity;
- creates Nile `tenants(id = profile_id, name = <opaque non-PII label>)`;
- creates exactly one global profile mapping with `profile.profile_id = tenants.id`;
- commits only if the full account/tenant unit succeeds.

Concurrent first sign-in must converge to one account through uniqueness constraints and transactional retry/read-after-conflict behavior.

## 3.3 Self-service admission and capacity guard

Stage 1 self-service means any Google identity that passes the configured Google token validation may create a JSCC account; invitation/domain allowlisting is out of MVP scope.

Before PROD multiuser enablement, account creation is also subject to the ADR-005/ATC-275-10 capacity guard:
- no automatic paid capacity;
- at the approved capacity threshold, creation of new accounts is fail-closed/degraded before paid consumption;
- existing authenticated users should remain available where the capacity policy permits;
- account-admission rejection does not create partial user/identity/tenant/profile rows.

The capacity signal is system-owned and cannot be overridden by browser input.

## 4. JSCC application session

`user_session`
- `session_id_hash` primary key;
- `user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE`;
- `created_at`;
- `expires_at`;
- `revoked_at NULL`.

Required indexes:
- `user_id` for revoke-all/delete paths;
- `expires_at` for bounded cleanup.

Rules:
- generate 256 random bits using a CSPRNG;
- raw token only in the browser cookie;
- persist SHA-256 of the token;
- never persist Google ID token;
- absolute lifetime: 60 minutes in Stage 1;
- no session-id reuse across authentication events;
- logout marks session revoked and clears cookie;
- deactivation revokes all sessions for the user;
- delete removes all sessions by cascade.

Cookie:

```text
__Host-jscc_session=<opaque token>; Path=/; Secure; HttpOnly; SameSite=Strict
```

No `Domain`.

## 4.1 Legacy cookie cutover

The current single-user cookie uses the same `__Host-jscc_session` name but contains a Google ID token.

At the multiuser cutover:
- the new runtime never interprets an unrecognized cookie value as a Google credential;
- a cookie with no matching JSCC session row is invalid;
- the auth boundary clears the invalid/legacy cookie and requires Google session establishment again;
- there is no compatibility path that re-authorizes the legacy JWT cookie directly.

This provides a deterministic one-time reauthentication instead of mixed session semantics.

## 5. Auth endpoints

### `GET /auth/config`

Public.

Returns only browser-required environment auth configuration, including Google client ID. No secrets/account information.

### `POST /auth/session`

Two target behaviors:

1. with Google bearer credential:
   - verify Google token;
   - resolve/provision account;
   - create fresh JSCC session;
   - return current account/profile summary;
   - set `__Host-jscc_session`.

2. with only a valid JSCC session cookie:
   - validate existing session;
   - re-check current `app_user.status`;
   - return current account/profile summary;
   - do not extend beyond its absolute expiry.

Session establishment is same-origin only. A request with an explicit `Origin` different from the environment `FRONTEND_ORIGIN` is rejected.

After multiuser cutover, Google bearer credentials are not accepted as direct authorization for ordinary protected application endpoints.

### `POST /auth/logout`

Same-origin only.

- revoke current server session when present;
- clear session cookie;
- idempotent response.

### `GET /me`

Authenticated.

Returns only the authenticated user's own account/profile metadata required by the UI:
- role;
- status;
- email metadata where needed;
- own `profile_id`.

It never accepts a target user/profile identifier.

## 6. AuthContext

Every authenticated application request resolves:

```text
AuthContext {
  user_id,
  profile_id,
  role,
  status
}
```

Rules:
- built server-side from the session/account/profile;
- unavailable for anonymous or invalid sessions;
- every session-authenticated request re-checks account status; DEACTIVATED fails before business-data access;
- repositories receive this context or a derived profile-scoped transaction context;
- Google claims do not flow into business repositories.

## 7. Personal API boundary

Canonical personal endpoints must not require caller-selected tenancy.

Preferred shape:
- `GET/PUT /me/preferences`;
- `GET /applications`;
- `POST /applications`;
- `PUT/DELETE /applications/:application_id`;
- personal job-state operations by shared `job_id`.

Compatibility aliases may exist during migration, but effective `profile_id` is always session-derived.

For object IDs such as `application_id`, repository lookup must also be tenant-scoped. Knowing another user's object UUID must not grant access. Cross-tenant object lookup should normally be indistinguishable from an object that does not exist (for example 404/zero-row semantics) rather than revealing ownership.

## 7.1 Cookie-authenticated mutation protection

For the current same-origin application architecture:
- session cookie uses `SameSite=Strict`;
- every state-changing cookie-authenticated request validates `Origin` when present and permits only the environment `FRONTEND_ORIGIN`;
- CORS does not reflect arbitrary origins;
- authentication/session/logout endpoints follow the same origin contract.

This is the Stage-1 CSRF boundary. If the application later requires cross-site cookies or a cross-origin frontend/API topology, Architecture must re-evaluate and introduce an explicit anti-CSRF token mechanism before that change.

## 8. ADMIN API boundary

ADMIN may access account-lifecycle metadata only.

Target operations:
- list accounts;
- deactivate;
- reactivate;
- delete;
- manage approved shared/system configuration;
- global scheduler/manual collection;
- diagnostics.

ADMIN may not read another user's:
- search preferences;
- FIT/evaluation;
- job state;
- applications;
- notes;
- CV/documents;
- UI workspace preferences.

ADMIN has no cross-user personal tenant bypass.

## 8.1 ADMIN-initiated account deletion mechanism

ADMIN deletion is an **account-domain delete**, not impersonation of the target profile.

Canonical mechanism:
1. ADMIN authorization is checked from the caller's own AuthContext.
2. The dedicated Account Lifecycle Gateway resolves only target account metadata (`user_id`, `profile_id`), never target personal content.
3. In one global transaction it deletes `tenants.id = profile_id`; verified Nile FK/cascade behavior removes all tenant-aware personal rows and the linked global `profile` mapping.
4. It then deletes target `app_user.user_id`; `user_identity` and `user_session` are removed by account cascades.
5. Shared/system rows have no ownership FK that cascades from `app_user`, `profile` or `tenants`.
6. The operation verifies zero tenant/profile/personal/account residue and returns lifecycle metadata only (success/not-found); it never selects or returns target personal content.

Explicit prohibitions:
- ADMIN must not set/assume the target user's Nile tenant context for personal-content access;
- the Account Lifecycle Gateway is the only normal-runtime global path allowed to target a tenant identifier for deletion;
- deletion must not be implemented by reading target personal rows and deleting them one by one through a fabricated tenant session;
- a privileged generic SQL/admin endpoint is prohibited;
- the deleted Nile `tenants` row must not remain as an identifiable tombstone.

The FK cascade path is part of the schema contract and must be integration-tested. If the selected PostgreSQL/provider behavior cannot demonstrate complete cascaded cleanup while preserving the no-read/no-impersonation boundary, implementation stops and returns to Architecture.

## 9. Nile tenant context and Tenant Data Gateway

ADR-008 is authoritative for tenant isolation.

All personal repository operations run inside a profile-scoped DB transaction mediated by the fail-closed Tenant Data Gateway.

Canonical pattern:

```text
authenticated JSCC session
 -> server-derived AuthContext(user_id, profile_id, role, status)
 -> BEGIN
 -> establish transaction-local Nile tenant context using profile_id
 -> personal queries through profile-scoped repositories
 -> COMMIT / ROLLBACK
```

For Multiuser MVP, `profile.profile_id` is the canonical Nile tenant identifier.

Browser input never establishes tenant authority.

Persistent connection-level tenant state is prohibited because pooled connections are reused. Commit, rollback and error paths must leave no tenant state that can affect a later borrower of the connection.

Missing, invalid or inconsistent tenant context must fail closed **at the Tenant Data Gateway before personal SQL is issued**.

Nile global mode itself is not fail-closed: a direct DB connection with no tenant context is cross-tenant capable. This residual capability is governed by ADR-008 compensating controls and explicit owner risk acceptance.

## 10. Tenant isolation contract

Nile tenant-scoped routing/isolation under an established tenant context is mandatory for the Stage-1 personal domain; Nile global mode without context remains cross-tenant capable.

### 10.1 Profile tenancy

The profile/tenant boundary:
- maps `profile.profile_id` to the Nile tenant identifier;
- is resolved only from server-derived AuthContext;
- does not accept caller-selected `user_id`, `profile_id` or tenant id as authority;
- is entered only through the Tenant Data Gateway / profile-scoped repository transaction boundary.

### 10.2 Personal-content tables

Every Stage-1 personal-content table:
- is tenant-aware and stores physical `tenant_id UUID NOT NULL`;
- references Nile `tenants(id)`;
- uses tenant-qualified primary/unique keys where entity identity is tenant-local;
- uses tenant-qualified foreign keys for tenant-local relationships;
- is accessed only under the authenticated profile's Nile tenant context through the Tenant Data Gateway;
- rejects cross-tenant object access, including lookup by known UUID.

The repository boundary maps logical `AuthContext.profile_id` to physical `tenant_id`; a second duplicated ownership column `profile_id` is not introduced in tenant-aware personal tables.

Derived or caller-selected tenant authority is prohibited.

If a future personal table cannot fit the approved tenant-aware profile ownership model, it requires separate Architecture review before implementation.

### 10.3 Runtime and pooling safety

The negative suite must prove:
- profile A cannot read/write/delete profile B personal data through the gateway/repository boundary;
- ADMIN cannot enter B personal tenant context for content access;
- pooled connection reuse A -> B exposes no A data;
- rollback/error after A followed by B exposes no A data;
- missing tenant context is rejected by the Tenant Data Gateway before personal SQL;
- forged browser `profile_id` / tenant id changes no authority;
- runtime modules outside the allowlisted Tenant Data Gateway / Account Lifecycle Gateway cannot execute SQL referencing personal tables or obtain a generic raw DB escape path;
- collection jobs and shared/system repositories have no dependency path to personal repository modules.

Before PROD Multiuser:
- ATC-275-09 proves the strongest demonstrable runtime DML versus migration/DDL privilege separation supported by Nile;
- CI/static personal-table boundary guards pass;
- the project owner explicitly accepts the ADR-008 residual risk that bypassing the application gateway with the runtime DB credential can enter Nile global cross-tenant mode.

Nile tenant-scoped isolation is one layer of defense in depth; the fail-closed Tenant Data Gateway, repository authorization, CI/static boundary guards and server-derived AuthContext are independently mandatory.

## 11. Personal tables in initial scope

At minimum:
- `profile_preferences`;
- `profile_job_state`;
- `profile_job_evaluation`;
- `applications`;
- personal notes if/when persisted;
- server-persisted UI preferences.

Each is profile-owned, tenant-aware and accessible only through the Tenant Data Gateway under transaction-local Nile tenant context.

`profile` is global tenancy/account metadata with no personal workspace payload. `user_session` is account-scoped security data, not profile workspace content.

Shared/system tables remain global/non-tenant unless a separate architecture decision classifies them otherwise.

## 11.1 Mixed shared + personal transaction contract

Operations such as shared canonical job -> profile-owned FIT/evaluation start through the Tenant Data Gateway and establish tenant context first.

Rules:
- shared/global reads are permitted inside the tenant-scoped transaction only if the current Nile backend supports them under tenant context;
- personal reads/writes remain tenant-scoped;
- code must never clear tenant context to switch into global mode within the transaction;
- cross-tenant iteration is prohibited;
- a rollback-only DEV probe must verify `SET LOCAL nile.tenant_id` and the required shared-table visibility before ATC-275-04 implementation.

## 12. Account lifecycle

### ACTIVE

- login/session establishment allowed;
- own profile access allowed;
- permissions derived from role.

### DEACTIVATED

Transactionally:
1. set account status DEACTIVATED;
2. revoke all live sessions.

Effects:
- new session establishment denied;
- old sessions denied/revoked;
- personal data retained;
- shared data unchanged.

### Reactivation

- set status ACTIVE;
- retained personal workspace becomes accessible again;
- old revoked sessions do not become valid again; user authenticates anew.

### DELETE

Irreversible account-domain delete using the FK cascade contract in §8.1:
- deleting `app_user` cascades identity/session/profile rows;
- deleting the profile cascades every personal-content row;
- shared/canonical/system data is preserved;
- ADMIN never assumes the target tenant context and never reads target personal content.

A later Google sign-in creates a fresh account/profile.

## 13. Deletion audit

Optional 90-day non-identifying event:

- deletion event id;
- event type;
- timestamp;
- `initiated_by = SELF|ADMIN`;
- `result = SUCCESS|FAILED`.

Must not contain:
- user/profile id;
- email/name;
- Google sub;
- session identifier;
- relinkable hash;
- personal content.

## 14. Shared collection authorization

ADR-005 remains unchanged:
- USER cannot trigger provider retrieval;
- ADMIN/system may trigger global collection according to policy;
- profile preference changes trigger personal re-evaluation only;
- user count must not multiply source/provider retrieval.

Existing `POST /commands/run` may remain the compatibility endpoint, but target authorization becomes ADMIN-only.

## 15. Environment isolation

Each environment uses:
- its own GCP project/runtime identity;
- its own OAuth client/origin configuration;
- its own `GOOGLE_CLIENT_ID`;
- its own DB binding;
- its own session rows;
- its own secrets.

No DEV/TEST/PROD auth/session fallback.

## 16. Security logging

Allowed structured events include:
- auth success/failure class;
- account created;
- session created/revoked/expired;
- account deactivated/reactivated/deleted;
- ADMIN lifecycle action result.

Do not log:
- Google ID tokens;
- session tokens or hashes;
- Authorization/Cookie headers;
- Google sub unless a narrowly approved diagnostic requires it;
- personal workspace payloads.

Internal `user_id` may be used in restricted operational logs where required for traceability, except the non-identifying deletion audit.

## 16.1 Authentication abuse hardening

Google remains responsible for credential issuance and its own sign-in abuse controls. JSCC still rejects malformed/invalid credentials fail-closed.

For the initial controlled pilot, a new paid WAF/rate-limit service is not introduced solely for Multiuser. Authentication request-rate monitoring is required, and a project-wide rate-limit mechanism becomes a PROD hardening gate if observed traffic/abuse or broader public exposure makes provider-side controls insufficient.

Any future rate limiter must:
- operate without storing raw IP addresses longer than operationally necessary;
- avoid a new paid dependency without owner approval;
- fail safely without turning rate-limit state into an authorization bypass.

## 17. Negative security acceptance matrix

Mandatory cases:
- invalid Google signature -> 401;
- wrong issuer/audience -> 401;
- expired Google credential -> 401;
- unknown valid Google subject below capacity gate -> exactly one new USER + Nile tenant + profile mapping;
- unknown valid Google subject when account-admission capacity gate is closed -> no partial account/identity/tenant/profile and fail-closed response;
- concurrent first sign-in -> exactly one USER/tenant/profile;
- DEACTIVATED -> session establishment denied and an already-issued session is denied even if its row was not yet cleaned up;
- revoked/expired/unrecognized legacy cookie -> 401 + cookie clear where applicable;
- Google bearer used directly on ordinary protected endpoint after cutover -> rejected;
- cross-origin session establishment/mutation -> denied;
- profile-id tampering -> no authority change;
- A reads/writes A -> allowed;
- A reads/writes B -> denied/zero visible rows;
- ADMIN reads own personal data -> allowed as own USER context;
- ADMIN reads B personal data -> denied;
- forged ADMIN field/header/request payload -> no privilege;
- application ID belonging to B used by A -> denied;
- pooled connection reused A -> B -> no tenant leakage;
- missing Nile tenant context -> Tenant Data Gateway rejects the operation before personal SQL; direct Nile global mode is explicitly not a DB-level deny state;
- runtime attempts unauthorized DDL/migration capability -> denied by the strongest demonstrable privilege contract supported by Nile;
- runtime under tenant A cannot read/write tenant B personal data through the approved gateway/repository path;
- ADMIN account deletion returns no personal content, uses only the narrow global Account Lifecycle Gateway, deletes the Nile `tenants` row, and leaves zero tenant/profile/personal/account residue;
- ADMIN cannot use deletion machinery as a read/list/export path.

## 18. Concurrency acceptance

At minimum TEST must prove:
- User A and User B authenticate concurrently;
- each changes preferences without overwrite;
- each maintains independent state for the same shared job;
- each creates/changes applications independently;
- one account deactivation does not affect another;
- first-sign-in race remains idempotent.

## 19. Required TEST identities

For independent multiuser validation:
- one `TEST_ADMIN`;
- one `TEST_USER_A`;
- one `TEST_USER_B`.

They are separate Google identities. Credentials are never provided to AI or stored in repository documentation.

## 20. Stop conditions

Implementation stops if it requires:
- treating missing tenant context as database-level deny when Nile global mode is actually cross-tenant capable;
- bypassing the Tenant Data Gateway for normal personal-data access;
- inability to create/delete the Nile `tenants` row atomically with JSCC account lifecycle;
- inability to prove tenant-aware cascade cleanup on the current Nile backend;
- ADMIN personal-content bypass;
- browser-selected tenant authority;
- direct Google-sub foreign keys in personal domain;
- persistent connection-level tenant context;
- runtime DB authority with an unaccepted DDL/tenant-isolation bypass risk;
- silent fallback to `ALLOWED_GOOGLE_SUB`;
- cross-environment fallback;
- a new identity provider/service not approved for Stage 1;
- permanent JSON/PostgreSQL dual-write.

## 21. References

- ADR-005
- ADR-007
- ADR-008
- #265
- #275
- #450
- `docs/command-api.md`
- `docs/data-contract.md`
- PostgreSQL Row Security
- OWASP Session Management Cheat Sheet
