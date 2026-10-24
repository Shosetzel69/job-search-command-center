# Claude OAuth DEV — security verification gate

Status: SOURCE_READY_FOR_INDEPENDENT_REVIEW / DEV_NOT_DEPLOYED

## Source and scope
PR #570. Only `ops/src/gateway.mjs`, `ops/src/claude-oauth.mjs` and associated tests. Existing ChatGPT client ID, redirect, grants and scopes must remain unchanged. DEV only.

## Proven by current CI
Unit/static checks and existing remote executor contract tests, plus secret scanning. This is NOT proof of an OAuth exchange or concurrency safety.

## Mandatory before merge/deploy
1. Behavioral OAuth tests with real `@node-oauth/oauth2-server@5.3.0` and mocked generation-conditional GCS storage: code+PKCE, refresh grant, rotation, revoke and replay.
2. Concurrency test: two simultaneous refreshes; at most one succeeds and any replay invalidates the entire family; descendant access and refresh tokens must fail.
3. Review transaction order: access token writes currently occur before refresh token persistence. Prove failure handling cannot leave orphaned valid access credentials or change code to fail closed.
4. Review the stale-family race between family read and access-token write; ensure downstream authentication denies a revoked family.
5. Registration automatic and static client fallback; ensure only allowlisted redirect URIs, strict public PKCE S256 and no secret is accepted.
6. Full logging route coverage, redaction, and rate-limiting/log volume; no tokens, passwords, authorization codes or IDs in logs.
7. Live ChatGPT regression check after staged deploy, then Claude auto-registration, static-client fallback and refresh across expiry.
8. Identify exact Git commit, immutable image digest and previous Cloud Run revision for rollback.

## Deployment guard
No deployment until security review PASS and behavioral tests PASS. Do not change TEST/PROD or enable privileged DEV executor routes.
