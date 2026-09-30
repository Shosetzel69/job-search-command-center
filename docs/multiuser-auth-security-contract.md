# Multiuser Authentication and Tenant Security Contract

Status: **CANONICAL**  
Version: **v1.0**  
Applicability: **CURRENT**  
Applies to: **AGENTFLOW**  
Effective from: **2026-09-30**  
Parent: #265  
Architecture: ADR-005, ADR-007  
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

`profile`
- `profile_id UUID PRIMARY KEY`;
- `user_id UUID NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE`;
- timestamps.

MVP invariant: exactly one profile per account.

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

If identity does not exist:
- create ACTIVE USER;
- create GOOGLE identity;
- create exactly one profile;
- all in one transaction.

Concurrent first sign-in must converge to one account through uniqueness constraints and transactional retry/read-after-conflict behavior.

## 4. JSCC application session

`user_session`
- `session_id_hash` primary key;
- `user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE`;
- `created_at`;
- `expires_at`;
- `revoked_at NULL`.

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
   - return current account/profile summary;
   - do not extend beyond its absolute expiry.

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
- DEACTIVATED status fails before business-data access;
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

For object IDs such as `application_id`, repository lookup must also be tenant-scoped. Knowing another user's object UUID must not grant access.

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

ADMIN has no personal-table RLS bypass.

## 9. PostgreSQL tenant context

All personal repository operations run in a DB transaction.

Canonical pattern:

```text
BEGIN
 -> SET LOCAL jscc.profile_id = <authenticated profile UUID>
 -> personal queries
COMMIT/ROLLBACK
```

Equivalent transaction-local `set_config(..., true)` is allowed.

A connection-scoped persistent `SET` is prohibited because pooled connections are reused.

Missing tenant context must produce default-deny behavior.

## 10. RLS contract

Every personal table directly stores or unambiguously derives `profile_id`.

For directly scoped tables:
- `ENABLE ROW LEVEL SECURITY`;
- `FORCE ROW LEVEL SECURITY` where applicable;
- SELECT/UPDATE/DELETE policy requires row `profile_id` == transaction profile context;
- INSERT uses `WITH CHECK` for the same condition.

Runtime database identity:
- must not be superuser;
- must not have `BYPASSRLS`;
- must not retain migration/DDL authority before PROD multiuser cutover.

RLS is defense in depth, not the only authorization mechanism.

## 11. Personal tables in initial scope

At minimum:
- `profile`-owned preference state;
- `profile_job_state`;
- `profile_job_evaluation`;
- `applications`;
- personal notes if/when persisted;
- server-persisted UI preferences.

`user_session` is account-scoped security data, not profile workspace content.

Shared/system tables do not receive profile RLS merely to imitate tenancy.

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

Irreversible transaction or verified transactional procedure:
- revoke/delete sessions;
- delete external identity;
- delete profile-owned data;
- delete profile;
- delete account;
- preserve shared/canonical/system data.

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

## 17. Negative security acceptance matrix

Mandatory cases:
- invalid Google signature -> 401;
- wrong issuer/audience -> 401;
- expired Google credential -> 401;
- unknown valid Google subject -> exactly one new USER/profile;
- concurrent first sign-in -> exactly one USER/profile;
- DEACTIVATED -> session establishment denied;
- revoked/expired JSCC session -> 401;
- Google bearer used directly on ordinary protected endpoint after cutover -> rejected;
- profile-id tampering -> no authority change;
- A reads/writes A -> allowed;
- A reads/writes B -> denied/zero visible rows;
- ADMIN reads own personal data -> allowed as own USER context;
- ADMIN reads B personal data -> denied;
- forged ADMIN field/header/request payload -> no privilege;
- application ID belonging to B used by A -> denied;
- pooled connection reused A -> B -> no tenant leakage;
- missing DB tenant context -> no personal rows;
- runtime role attempts DDL/BYPASSRLS path -> denied by privilege contract.

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
- ADMIN personal-content bypass;
- browser-selected tenant authority;
- direct Google-sub foreign keys in personal domain;
- persistent connection-level tenant context;
- runtime DB role with unaccepted RLS/DDL bypass;
- silent fallback to `ALLOWED_GOOGLE_SUB`;
- cross-environment fallback;
- a new identity provider/service not approved for Stage 1;
- permanent JSON/PostgreSQL dual-write.

## 21. References

- ADR-005
- ADR-007
- #265
- #275
- #450
- `docs/command-api.md`
- `docs/data-contract.md`
- PostgreSQL Row Security
- OWASP Session Management Cheat Sheet
