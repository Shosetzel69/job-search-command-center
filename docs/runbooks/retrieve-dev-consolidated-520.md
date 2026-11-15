# #520 — consolidated DEV delivery: Nile-only Retrieve + source quality + Zoho

One delivery, one application SHA, one paired Service/Search Job rollout. Existing #520, #521, #87 and #530 WP2/WP5/WP8 requirements retained. This manifest records scope and gates, not a claim of full completion.

## Included source changes
- #646: cd2b10fef9c6f39bbf94ebf173da6d88d304807e — retire DEV jobs.json processing, publication and read path; Nile canonical counts.
- #647: 59da87476a19b48268b118b280db8108d363dab3 — Workday detail isolation; Eightfold provenance fixes; source quality/audit evidence.
- #648: 075c9a95800827361cd1006993e4c6c1a67a34d7 — Ubuntu 24.04 for Playwright, sanitized validation evidence.
- This PR: exact five Zoho public boards eligible for existing read-only validation, named IDs supported in owner dispatch. No registry activation or policy mutation.
- Zoho candidates: OSF Digital, HR Plus, MADIFF, Matritel, MyEmployment. Validate all five; activate only individually approved, validated sources through existing DEV ADMIN registry, never merely on HTTP 200 or transport success.

## Evidence and outstanding work
- Historical live baseline: 135 attempted, 23 failed, 36 partial, 5982 legacy inspected / 7 legacy published. Do not interpret legacy ratio as canonical relevance or Nile count.
- Source cohorts: validation runs 43691720144 (17 sources) and 43691771094 (2 sources); collect sanitized outcomes; additional failed sources require full run evidence. Resolve actual source failures and missing fields individually; do not bypass robots, TLS, credentials or provider limits.
- Confirm query scope and request budgets on every eligible connector; don't discard unknown classifications as a shortcut. Reconcile source raw / quality / scope / projected / canonical distinct counts and live Nile/API/UI.
- Remaining run-history.json and run-status.json retirement requires complete Nile history/progress/failure parity and safe removal of remaining readers. They are retained in this candidate, including recovery controls and lock ownership.
- Perform actual authenticated USER/ADMIN Retrieve, equivalent request join and incompatible request isolation; confirm freshness and one run identity. D1–D6 acceptance remains open until evidence.
- Zoho acceptance: stable individual identity, genuine public description/location, direct URL or honestly labeled board fallback, missing fields explicit, no cross-tenant access. Partial/incomplete jobs do not establish source readiness.

## Release gate
CI exact head PASS; merge; freeze ONE final exact application SHA after fixes; build both immutable images together using existing approved Cloud Build pattern; attest quiescence, baseline digests and rollback; deploy DEV only; preserve existing controls and run owner-driven UI acceptance. Existing recipe pinned to 59da8747 is not valid for the later consolidated SHA; generate a matching recipe only after final freeze. **Validated release route (owner reconfirmed 2026-11-15): NO WIF.** GitHub implementation → GitHub Actions CI → merge main → authenticated existing GCP Cloud Shell submits exact checkout to Cloud Build in jscc-shared/europe-west1, using existing jscc-build service account and exact-SHA recipe → immutable Artifact Registry digests → paired Cloud Run Service/Search Job rollout in jscc-dev → health/DB and authenticated UI acceptance. The obsolete WIF preflight is not a release dependency. GitHub-triggered Cloud Build was previously disabled; direct automatic GitHub→GCP execution is not attested, so use the previously successful authenticated Cloud Shell route, not a new identity or trigger. No WIF, IAM, legacy exit 86, TEST/PROD, schema, historical data or old file changes. No activation, rollout or D5/D6 acceptance is implied by package preparation.
