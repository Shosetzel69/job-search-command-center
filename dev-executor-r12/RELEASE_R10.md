# R10 — GitHub merge gates + OAuth gateway adapter (offline)

Implemented:
- `runner/github_gates.py`: paginated required-check verification, review approval bound to expected head SHA, blocking change requests, GraphQL review-thread pagination and mandatory resolution. Required checks provided by trusted server configuration `JSCC_DEV_REQUIRED_CHECKS`; gitleaks is mandatory.
- `runner/executor.py`: invokes all gates before SHA-locked GitHub squash merge; capability flag and approval signature remain required.
- `gateway/operation-auth.mjs`: server-only OAuth actor binding adapter, action-scoped exact manifest authorization lookup, durable create-only idempotency reservation and generic denial responses.

**Integration remains incomplete:** adapter is not yet mounted in existing `ops/src/gateway.mjs`; independent authorization provisioning, patch ingestion, GitHub token via Secret Manager, runner/Gateway workload identities, GCP job and IAM manifests remain unconfigured. No privileged capabilities are enabled. `recordOperation` is an append-only first event; subsequent operation events need a distinct event ledger. Do not deploy this release.

Validation: 7 local Python unit tests passed, Python compile and JS syntax checks passed. No independent security review, end-to-end tests or GCP actions were performed. No `main` changes.
