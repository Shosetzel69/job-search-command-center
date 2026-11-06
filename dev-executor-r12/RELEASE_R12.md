# R12 — offline development checkpoint
2026-10-24

Changes versus R11:
- Fixed runner Docker context to include github_gates.py, required by merge gates.
- Gateway performs immutable patch ingestion, rejecting caller-controlled GCS paths and generations.
- Patch SHA-256 is checked before reservation; maximum decoded patch size 250 KB, base64 canonical; GCS ifGenerationMatch=0 and returned generation/size pinned in runner envelope.
- Input envelope object metadata name/generation checked; unexpected user request fields fail closed.
- Reduced runner exception message exposure in stderr/evidence to exception class at outer boundary.
- Four Node tests for request sanitization, patch tampering, replay and authorization rejection.
- Deployment preflight contract documented, explicitly not an approved executable deployment.

Validation: Python unittest 10/10 PASS, Node tests 4/4 PASS, JS parse and Python compile PASS. No full integration tests, no GCP deployment, no independent security review.

Security considerations: No authorization record writer is implemented. The existing gateway can only read externally approved immutable authorization records; this is deliberate. Privileged capabilities remain OFF. Review whether a shared bucket allows least-privilege enforcement and audit atomic reservation failure semantics before deployment.
Additional R12 hardening: patch cap aligned with gateway 256 KiB JSON read limit (180 KiB decoded). Runner now requires ops/package-lock.json and performs `npm ci --ignore-scripts` before suites; current main lacks this lockfile, so this is an explicit deploy gate rather than a false runtime PASS.
