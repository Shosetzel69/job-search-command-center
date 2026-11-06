# R7 implementation status — fail-closed candidate

## Implemented as source code
- ATC issue/comment provenance validation module
- Action-scoped HMAC approval issuer module
- Cloud Run job dispatcher module with idempotency callback contract
- Cloud Run container, immutable main SHA checkout, isolated worktree
- Digest checked GCS patch retrieval, fixed test commands, bounded evidence object
- GitHub API/CLI integration for PR and merge and Cloud Run deployment invocation

## Critical blockers before enabling privileged actions
1. Authenticated gateway request handler must call dispatch with trusted OAuth subject.
2. Server-side ATC per-action authorization callback must verify authenticated actor.
3. Atomic, durable, one-time admission/approval consumption is absent. R7 refuses all privileged job actions.
4. Merge review-thread pagination, required-check verification and enforcement are incomplete. Merge fails closed.
5. Patch GCS ingestion/ownership and object-generation binding are incomplete.
6. Evidence redaction/persistence completeness, Secret Manager wiring, IAM and deployment manifests remain incomplete.
7. Build/test/deploy and E2E in GCP not executed.

Do not deploy as a replacement for the running gateway; do not enable publish/merge/deploy.
