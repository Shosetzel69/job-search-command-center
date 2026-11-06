# JSCC DEV Executor R8 — INTERMEDIATE SOURCE RELEASE

## Incremental additions
- Privileged operation admission is now signed (HMAC-SHA256), bound to operation UUID, action, manifest digest, expiry and random nonce.
- Cloud Run runner consumes a single-use admission receipt via GCS ifGenerationMatch=0, fail-closed on any error.
- No privileged call is automatically enabled. Existing action-specific approval checks and feature flags remain.

## NOT deployment-ready
- The addon dispatcher is NOT wired to actual OAuth `ops/src/gateway.mjs`.
- Server-side `reserveOperation`, `recordOperation`, and `authorizeAction` are dependency contracts, not supplied implementations.
- `merge` remains fail-closed due to incomplete GitHub review/check verification.
- Patch GCS ingestion/generation binding, least-privilege IAM, GitHub credentials/CI, image build and rollback wiring are pending.
- No GCP deployment or E2E was performed.

## Operational decision required
A trusted execution identity/approval source and GCP deployment access are required before activation. Never bypass these controls to accelerate integration.
