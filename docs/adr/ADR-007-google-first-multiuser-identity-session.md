# ADR-007 — Google-first multiuser identity and application session boundary

Status: **Accepted**  
Version: **v1.0**  
Applicability: **CURRENT**  
Applies to: **AGENTFLOW**  
Effective from: **2026-09-30**  
Decision owner: Project owner  
Architecture tracker: #450  
Parent requirement: #265  
Builds on: ADR-005, ADR-006
Tenant-isolation amendment: ADR-008

## Context

ADR-005 approved JSCC multiuser ownership, tenant isolation, shared collection, account lifecycle and the semantic mapping:

`Google sub -> app_user.user_id -> profile.profile_id`.

The current single-user implementation still uses:
- `ALLOWED_GOOGLE_SUB` as the authorization allowlist;
- a verified Google ID token as the browser credential;
- the Google ID token itself inside the current `__Host-jscc_session` cookie.

Before implementing multiuser, the identity and session boundary must be precise enough to:
1. remove the single-user allowlist safely;
2. support account deactivation/deletion and immediate session revocation;
3. keep Google as Stage-1 IdP;
4. avoid binding application data to Google-specific identifiers;
5. allow a later email/password identity method without redesigning tenancy.

## Problem

Using Google `sub` directly as the application account key would couple all application data to one IdP.

Using a Google ID token as the durable application session credential also couples session lifetime and revocation to the external token. Multiuser account lifecycle requires JSCC to be able to revoke access immediately after deactivation, deletion or explicit logout.

The solution must preserve ADR-005:
- exactly one profile per user in MVP;
- USER and ADMIN roles only;
- server-derived tenant context;
- Nile-native tenant isolation through the ADR-008 Tenant Data Gateway;
- no ADMIN bypass of personal content;
- shared collection and profile-owned evaluation.

## Options considered

### A. Keep direct Google-sub account binding and Google token session

Advantages:
- smallest code delta;
- closest to current implementation.

Disadvantages:
- identity model remains Google-specific;
- application session cannot be independently revoked without checking account state on every token-authenticated request;
- later email/password support requires a second identity redesign.

### B. Google IdP + generic external identity mapping + JSCC-owned opaque sessions

Advantages:
- Google remains the only Stage-1 authentication provider;
- application identity becomes provider-neutral;
- server controls session creation, expiry and revocation;
- deactivation/delete/logout can revoke sessions immediately;
- future email/password becomes an identity-provider extension, not a tenancy redesign.

Disadvantages:
- requires a session persistence table;
- protected endpoint authentication changes at multiuser cutover;
- requires explicit migration and regression coverage.

### C. Introduce a new managed authentication platform now

Rejected for Stage 1.

Reason:
- adds a new provider/service and operational dependency before it is required;
- Google Identity Services already satisfies the approved Stage-1 authentication requirement;
- email/password remains a later phase.

## Decision

Choose **Option B**.

### 1. Identity boundary

Google Identity Services remains the Stage-1 browser IdP.

Canonical identity resolution becomes:

```text
Google ID token
   -> verify Google claims
   -> user_identity(provider=GOOGLE, provider_subject=sub)
   -> app_user.user_id
   -> profile.profile_id
```

`Google sub` is an external identity subject only. It is not:
- a primary key for application-owned data;
- a foreign key used by personal business tables;
- an authorization value supplied by the browser.

Minimum identity model:

```text
app_user
- user_id UUID PK
- role USER|ADMIN
- status ACTIVE|DEACTIVATED
- deletion_started_at NULL  -- internal irreversible-delete progress marker
- deletion_initiated_by NULL  -- SELF|ADMIN, preserved only until final deletion
- created_at
- updated_at

user_identity
- identity_id UUID PK
- user_id UUID FK
- provider
- provider_subject
- email
- email_verified
- created_at

UNIQUE(provider, provider_subject)
UNIQUE(user_id, provider)        -- MVP: one identity per provider/user

profile  -- global account/tenant metadata
- profile_id UUID PK, also the logical Nile tenant id; equality to tenants.id is a provisioning invariant, not a physical shared->tenant FK
- user_id UUID UNIQUE FK
- provisioned_at NULL  -- internal readiness marker; session issuance requires non-null
- created_at
- updated_at
```

Email is account metadata for human identification. It is not the canonical account key and is not required to be globally unique in JSCC.

A future identity method may add another `provider` without changing `app_user`, `profile`, tenant ownership or personal-domain foreign keys.

### 2. First-sign-in provisioning

After Google token verification:

1. resolve `(provider=GOOGLE, provider_subject=sub)`;
2. if found, resolve the associated `app_user` and profile; if `deletion_started_at` is non-null, deny session/reactivation and resume deletion internally; if `profile.provisioned_at` is null, resume the missing provisioning steps before any session can be issued;
3. if not found, provision through the ADR-008 Account Provisioning Gateway using provider-compatible, idempotent transaction boundaries:
   - shared-only transaction: create ACTIVE USER, GOOGLE `user_identity`, opaque `profile_id` and exactly one global profile mapping;
   - tenant-control transaction: create Nile `tenants(id = profile_id, name = <opaque non-PII label>)`;
   - tenant-scoped transaction: initialize required personal defaults/bootstrap state;
   - shared-only transaction: finalize any shared bootstrap/system markers and set `profile.provisioned_at` after all prior steps are verified complete;
4. no JSCC session is issued while `profile.provisioned_at` is null or the corresponding Nile tenant cannot be provider-safely verified; an interrupted/drifted first sign-in resumes or fails closed through the provisioning/lifecycle boundary using the persisted `profile_id` and never creates a second identity/profile;
5. uniqueness constraints plus retry/read-after-conflict behavior make concurrent first sign-in converge to one account;
6. DEACTIVATED accounts are denied and are not reprovisioned.

A deleted user has no retained identity mapping, Nile tenant row or profile mapping. A later sign-in creates a new `user_id`, `profile_id` and Nile tenant.

### 3. Application-owned session

After successful Google authentication/account resolution, JSCC creates a new opaque session identifier.

Requirements:
- generated with a cryptographically secure RNG;
- at least 128 bits of entropy; target implementation uses 256 random bits;
- meaningless to the client;
- raw session token exists only in the browser cookie;
- persistence stores only a one-way SHA-256 token hash;
- the Google ID token is not persisted in the JSCC session store.

Minimum session model:

```text
user_session
- session_id_hash PK
- user_id UUID FK ON DELETE CASCADE
- created_at
- expires_at
- revoked_at NULL
```

Stage-1 default preserves the current short-session security posture: a session has an absolute maximum lifetime of 60 minutes. Re-authentication may transparently obtain a fresh Google credential and establish a new JSCC session, subject to Google/browser behavior.

### 4. Session cookie

Canonical cookie:

```text
__Host-jscc_session=<opaque token>;
Path=/;
Secure;
HttpOnly;
SameSite=Strict
```

No `Domain` attribute is allowed.

Session identifiers are not stored in `localStorage` or `sessionStorage`.

### 5. Session lifecycle

- successful authentication always creates a fresh session identifier;
- session fixation is not permitted;
- logout revokes the server-side session and clears the cookie;
- account deactivation revokes all live sessions for that user;
- reactivation is prohibited when `app_user.deletion_started_at` is non-null;
- account deletion sets `deletion_started_at` before destructive tenant work and revokes/deletes all sessions as part of personal/account deletion;
- expired/revoked sessions fail closed;
- protected application requests do not accept caller-selected user/profile authority.

### 6. Protected-request authentication

After the multiuser auth cutover:
- normal browser protected requests authenticate through the JSCC session cookie;
- Google ID tokens are accepted only by the authentication/session-establishment boundary;
- the separate GitHub Actions OIDC verification identity approved for bounded read-only functional verification remains unchanged;
- no Google bearer fallback is used when application-session validation fails.

This avoids a path where a deactivated user can bypass session revocation by presenting a still-valid Google ID token directly to protected endpoints.

### 7. AuthContext

Successful session validation resolves:

```text
AuthContext
- user_id
- profile_id
- role
- status
```

Business logic and repositories consume `AuthContext`, never Google claims.

For personal operations, `profile_id` is server-derived from the authenticated session. Browser-supplied profile/user identifiers never confer tenant authority.

### 8. ADMIN boundary

ADMIN:
- is a normal USER for its own profile;
- may manage account lifecycle metadata, shared/system configuration, global scheduler, collection and diagnostics;
- may not read another user's profile preferences, evaluations, applications, notes or personal workspace.

ADMIN receives no cross-user personal tenant bypass.

ADMIN-initiated account deletion uses the narrow ADR-008 Account Lifecycle Gateway. It resolves only target account metadata, first persists `deletion_started_at` plus the original `deletion_initiated_by`, deactivates the account and revokes sessions in shared state, then deletes the target Nile `tenants` row in a separate tenant-control transaction so verified cascade removes tenant-aware personal data, and finally deletes shared `app_user` metadata so identity/session/profile rows are removed through shared-account cascades. Once deletion has started, reactivation/session establishment is prohibited; retry or internal reconciliation resumes the remaining idempotent steps. ADMIN does not assume the target tenant context for personal-content access and the operation never returns target personal content.

### 9. Environment isolation

ADR-003/006 remains authoritative:
- each environment has its own OAuth client/origin configuration;
- each environment uses its own database and runtime secrets;
- no cross-environment identity/session fallback exists;
- application sessions are environment-local.

### 10. Future email/password

Email/password is not implemented by this ADR.

The approved extension point is `user_identity`. A future architecture decision may add a managed or local-password provider, but it must reuse:
- `app_user`;
- `profile`;
- application session;
- AuthContext;
- ADR-008 tenant isolation boundary;
- account lifecycle.

No password hash, reset token or email-verification implementation is introduced in Stage 1.

## Security rationale

The design follows these principles:
- Google token verification remains server-side and `sub` is the stable external subject;
- application session identifiers are opaque, random and server-controlled;
- Secure/HttpOnly/SameSite cookies are used;
- session identifier is regenerated at authentication;
- personal authorization is server-derived and reinforced by the ADR-008 fail-closed Tenant Data Gateway plus Nile-native tenant isolation;
- `profile.profile_id` is the canonical Nile tenant identifier for Multiuser MVP;
- profile-owned persistence is accessed only inside transaction-local tenant context; persistent pooled-connection tenant state is prohibited;
- each Stage-1 personal-content table remains directly profile-owned and tenant-aware;
- runtime DB authority must be separated from migration/DDL authority before PROD multiuser where Nile supports a demonstrable mechanism; any material residual privilege risk returns to Architecture.

## Consequences

Positive:
- removal of `ALLOWED_GOOGLE_SUB` becomes a controlled account lookup cutover;
- deactivation/logout/delete can invalidate access immediately;
- application data no longer depends on Google identifiers;
- email/password can be added later without redesigning tenant ownership.

Costs:
- new `user_identity` and `user_session` persistence;
- auth/session API and regression tests change;
- multiuser cutover must migrate the current owner identity;
- session storage adds bounded DB traffic.

## Guardrails

- no silent auth fallback to `ALLOWED_GOOGLE_SUB` after cutover;
- no email-as-primary-identity;
- no Google `sub` foreign keys in personal domain tables;
- no raw session tokens in database/logs;
- no Google ID tokens in database/logs/localStorage;
- no ADMIN personal-content bypass;
- no new email/password provider in Stage 1.

## Implementation authorization

This ADR records the approved architecture only.

It does not authorize coding, schema mutation, environment changes or deployment. AgentFlow implementation still requires an explicitly approved Agent Task Contract.

## References

- #265 — IDEA-022 Multiuser
- #270 — ADR-005 architecture gate
- #275 — PostgreSQL Development Analysis / ATCs
- #450 — Multiuser implementation tracker
- ADR-003 — environment isolation
- ADR-004 — PostgreSQL target
- ADR-005 — multiuser ownership/isolation/shared collection
- ADR-006 — GCP runtime
- OWASP Session Management Cheat Sheet
- Google Identity Services server-side ID-token verification guidance
- ADR-008 supersedes the historical PostgreSQL RLS enforcement design; current tenant isolation is defined there
