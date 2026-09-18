# Security negative regression suite

Issue: #232 / parent #21  
Release: Release 1 / Wave 3

## Objective

Verify fail-closed security behavior against the stabilized HttpOnly session model without weakening authentication or requiring PROD mutation.

## Automated matrix

| Case | Expected |
|---|---|
| Google payload with `sub != ALLOWED_GOOGLE_SUB` | authorization rejects with 403 |
| protected `/data/*` without bearer and without valid session cookie | 401 before asset lookup |
| privileged request with forbidden `Origin` | 403 and no ACAO reflection |
| forbidden CORS preflight | 403 |
| invalid configuration payload shape/value | 400 at validation boundary |
| same-origin protected 401 in frontend | auto-restore disabled and controlled reauthentication/reload scheduled |
| business 403 such as controlled non-live run rejection | not misclassified as expired authentication |

## Boundaries

- Token signature/issuer/audience validation remains performed by `jose.jwtVerify` against Google JWKS.
- The authorization decision after successful token validation is isolated as a pure testable boundary; no auth bypass is introduced.
- Tests use synthetic identities only.
- Cookie/token values are not logged or persisted by the test suite.
- No PROD mutation or live Full Search is required.

## Evidence

Acceptance evidence is the green Command API + frontend test suite for the exact implementation SHA/PR. The suite runs from the existing `Validate Command API` workflow.
