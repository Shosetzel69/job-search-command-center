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


## 5. Guvernanță — owner baseline 2026-11-15
- GOV85-DEV; no redundant tickets, architecture changes or mandatory independent review.
- Automated tests and functional acceptance mandatory; autonomous execution, owner involvement only for decisions or real blockers.
- Preserve critical security, integrity and isolation controls; respect provider access policies; zero incremental cost objective.

## 6. Deployment procedure — owner baseline
- GitHub implementation/versioning/merge; GitHub Actions CI/testing; Google Cloud Build build; Artifact Registry immutable images; coordinated Cloud Run Service + Search Job DEV deployment.
- Reuse GOV85 procedure validated 2026-11-14 for application SHA `121f88e212013d2c4665bb70f881a3bcee365d21`, adapting only exact candidate identity and required preflight to the final consolidated candidate.
- Temporary lock, automatic paired rollback, JSCC connector DEV verification. Preserve legacy promotion controls unchanged.
- No WIF, additional IAM, new infrastructure, TEST/PROD. Attempt available authorized connector operations first; if actual Cloud Build submission is inaccessible, report that specific blocker, not WIF.

## 7. Working rules
- Inspect actual repository/implementation; reuse existing code. Consolidate requirements in #520 and update linked tickets without duplication.
- Single implementation plan; preserve Delivery → AC → Implementation → Test → Evidence traceability in docs/retrieve-e2e-acceptance-matrix.md; separately track each delivery and distinguish IMPLEMENTED, MERGED, DEPLOYED, ACCEPTED.
- Minimize builds and deployments; no redundant intermediate approvals; continue autonomously until real blocker or decision. User-facing updates at most 150 words with concrete next step.

### Current delivery checkpoint (not final acceptance)

| Delivery | AC reference | Implementation checkpoint | Test and evidence | Runtime acceptance |
|---|---|---|---|---|
| D1 #521 | D1-AC01–08 | Existing manual/coverage intent and signed scope in main; new-posting discovery unverified | Existing refresh CI; exact candidate CI pending; D1-AC02 live | PARTIAL |
| D2 #520 / WP2 | D2-AC01–11 | Existing coalescing, bounded provider queries; #647 fault isolation and scope counters MERGED; remaining capability gaps | 19-source read-only GitHub runs 43691720144/43691771094; request budgets and real concurrent requests pending | PARTIAL |
| D3 #87 / WP5 | D3-AC01–15 | #647 quality/provenance improvements MERGED; #649 Zoho read-only admission IMPLEMENTED; unresolved source defects | 19-source evidence: 10 failed, 4 partial, 5 transport successes (only ING fully valid, NTT 496/500 valid); Zoho live validation pending | PARTIAL |
| D4 #520 / WP8 | D4-AC01–12 | #646 Nile-only publication MERGED; #647 diagnostics MERGED; history/progress JSON retirement pending safe parity | #646/#647 native CI PASS; Nile/API/UI reconciliation pending | PARTIAL |
| D5 | D5-AC01–13 | One final paired DEV release pending | Exact final SHA CI, health, lock/rollback, native and authenticated E2E evidence required | NOT_ACCEPTED |
| D6 | D6-AC01–10 | Historical repair not authorized in this package | D5 acceptance and explicit historical-write decision required | NOT_STARTED |

No new deployment or source activation is claimed by this checkpoint. The detailed AC matrix remains authoritative for individual requirements and historical evidence. 
