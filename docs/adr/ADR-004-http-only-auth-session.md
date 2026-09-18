# ADR-004 — HttpOnly same-origin Google session fallback

Status: Accepted
Date: 2026-09-18
Issue: #193

## Context

Google Identity Services returns a Google ID token to the browser. Keeping that token only in React memory caused reload/session continuity regressions and could leave the UI apparently authenticated while protected requests no longer had usable credentials.

Persisting the Google ID token in localStorage or sessionStorage is explicitly rejected.

## Decision

Use a same-origin host-only session fallback implemented by the Command API boundary.

After a successful Google sign-in:

1. `POST /auth/session` validates the Google ID token server-side;
2. the Worker sets `__Host-jscc_session`;
3. the cookie contains the already validated Google ID token and is:
   - `Secure`;
   - `HttpOnly`;
   - `SameSite=Strict`;
   - `Path=/`;
   - no `Domain` attribute;
4. lifetime never exceeds the Google token expiry and is capped by the implementation;
5. protected requests may authenticate with either an explicit bearer token or the HttpOnly cookie;
6. every request still validates Google signature, issuer, audience and `ALLOWED_GOOGLE_SUB`;
7. page bootstrap may restore the application session through `POST /auth/session` without exposing the cookie value to JavaScript;
8. explicit logout clears the cookie and suppresses automatic restore;
9. credentials are never stored in Web Storage and are not logged.

## Security controls

- `__Host-` cookie prefix prevents Domain-scoped cookies and requires HTTPS + `Path=/`;
- `SameSite=Strict` reduces cross-site request attachment;
- privileged mutations continue to enforce the approved same-origin/CORS boundary;
- the cookie is not a new trust source: it only transports the Google credential back to the Worker for the same validation already applied to bearer authentication;
- protected-data 401/403 transitions the frontend to re-authentication instead of silently rendering an empty authenticated state;
- policy 403 responses such as disabled Full Search are not treated as session loss.

## Consequences

Positive:
- deterministic refresh/session continuity while the Google credential remains valid;
- no credential in localStorage/sessionStorage;
- no server-side session database is introduced.

Trade-offs:
- the Google ID token exists in an HttpOnly cookie for its bounded lifetime;
- logout and expiry semantics depend on correct cookie clearing and Google token expiry;
- cookie/session behavior must remain covered by regression tests.

## Implementation

Initial implementation: PR #196.

Release 1 hardening under #193 aligns the canonical architecture/documentation and distinguishes authentication 403 from policy 403 in frontend re-authentication handling.
