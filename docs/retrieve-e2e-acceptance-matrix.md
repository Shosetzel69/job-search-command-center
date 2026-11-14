# Retrieve E2E — acceptance traceability (#520 / #521 / #87 / #530)

PR #633. Implementation status only, **zero runtime PASS claimed**. `IMPLEMENTED` means a candidate code path is present, not CI PASS or deployed acceptance. `BLOCKED` means evidence or functionality is incomplete. Existing historical acceptance does not carry over to the new release. D5/D6 remain gated.

| AC | Status | Implementation / gap | Test / evidence required |
|---|---|---|---|
| D1-AC01 | IMPLEMENTED | Manual intent bypasses sufficient Coverage; user/admin refresh paths | Manual intent unit tests; DEV pending |
| D1-AC02 | BLOCKED | Newly posted jobs discovery depends on real provider run | D5 live comparison |
| D1-AC03 | IMPLEMENTED | Signed independent posting_max_age_hours and collection_freshness_hours | retrieve-scope.test.mjs; worker config |
| D1-AC04 | IMPLEMENTED | Existing Coverage intent retained | user/admin refresh regression |
| D1-AC05 | IMPLEMENTED | Manual intent bypasses automatic cooldown only | user/admin refresh tests |
| D1-AC06 | IMPLEMENTED | Existing hard gates, source approval and limits retained | Regression + native CI |
| D1-AC07 | IMPLEMENTED | Manual request does not persist global policy changes | API route regression |
| D1-AC08 | IMPLEMENTED | Server-derived auth/scope; tenant-bound request mapping | Native multiuser CI |
| D2-AC01 | IMPLEMENTED | Server-side USER and ADMIN scope derivation retained | retrieve-scope and refresh tests |
| D2-AC02 | BLOCKED | Added bounded SmartRecruiters, EURES, Remotive, Eightfold and Himalayas role queries alongside existing adapters; mixed/unsupported scopes fall back explicitly | Provider live probes and remaining geography/mode/contract capabilities |
| D2-AC03 | BLOCKED | Every planned source reports effective query/static/enumeration/skip disposition; static role filters are not represented as dynamically scoped | Live per-source capability certification |
| D2-AC04 | IMPLEMENTED | Mandatory downstream scope selection retained | Python scope tests |
| D2-AC05 | IMPLEMENTED | Existing equivalent-run coalescing | Native concurrency tests; DEV pending |
| D2-AC06 | IMPLEMENTED | Existing heavy lock rejects incompatible request | Native concurrency tests; DEV pending |
| D2-AC07 | IMPLEMENTED | Existing canonical/source identity upsert retained | Shared corpus regression |
| D2-AC08 | BLOCKED | Persistence/UI visibility for new real postings | D5 live UI acceptance |
| D2-AC09 | IMPLEMENTED | Per-source failure/partial results | Worker regression |
| D2-AC10 | BLOCKED | Raw/excluded/after-scope and per-source inserts/updates plus distinct canonical publication attribution implemented; actual provider request counts not uniformly available | Live per-source reconciliation and provider request evidence |
| D2-AC11 | IMPLEMENTED | No registry activation changes; existing validation gates | Routing regression |
| D3-AC01 | BLOCKED | Individual detail where verified; listing title provisional | Live original comparisons |
| D3-AC02 | BLOCKED | Bounded individual-detail guard; unresolved description unknown | 48 individual live comparisons |
| D3-AC03 | BLOCKED | Structured or verified locations, unknown on contextual contamination | Live comparisons |
| D3-AC04 | BLOCKED | Fields separated when structured; Crossover salary/company semantics not fully verified | Individual detail verification |
| D3-AC05 | IMPLEMENTED | Workday multiple explicit locations preserved; unknown geography not treated as proven non-RO | Workday regression; DEV pending |
| D3-AC06 | IMPLEMENTED | Quality verdict/reasons and unverified field provenance | Shared corpus tests |
| D3-AC07 | IMPLEMENTED | Quality classifier VALID/INCOMPLETE/INVALID | Shared corpus tests |
| D3-AC08 | IMPLEMENTED | Rejected invalid records before persistence | Shared corpus tests |
| D3-AC09 | IMPLEMENTED | Incomplete incoming rows do not overwrite valid canonical/source data | Shared corpus regression |
| D3-AC10 | BLOCKED | Luxoft/Stripe #617 reused; Crossover guarded individual heading links, identity retained, no adjacent-card salary/employer/date attribution | Live Crossover detail route and all three E2E |
| D3-AC11 | BLOCKED | Orange exact feed-linked public detail enrichment with title and URL identity checks; NTT geography guard retained; regional route change not authorized | Live source comparison and owner decision if NTT route replacement needed |
| D3-AC12 | IMPLEMENTED | 48 named static dispositions and original audit linked | docs/retrieve-d3-source-dispositions.md; runtime verification separate |
| D3-AC13 | BLOCKED | No new deployed original → Nile → API → UI evidence | D5 |
| D3-AC14 | IMPLEMENTED | Unverified data not evidence of absence; targeted lifecycle suppressed | Worker/shared corpus tests |
| D3-AC15 | IMPLEMENTED | Partial and failed sources excluded from lifecycle advancement | Shared corpus tests |
| D4-AC01 | IMPLEMENTED | Manual request outcome feedback | Frontend tests; DEV pending |
| D4-AC02 | IMPLEMENTED | Tenant-native request_id → run_id mapping; uncertain dispatch explicit | Native request mapping tests |
| D4-AC03 | IMPLEMENTED | Existing worker progress callback and own request polling | Worker/frontend regression; DEV pending |
| D4-AC04 | IMPLEMENTED | Planned-source denominator retained | F520-06 regression |
| D4-AC05 | IMPLEMENTED | Outcome categories retained | Source orchestration regression |
| D4-AC06 | IMPLEMENTED | Config skips separate | Source orchestration regression |
| D4-AC07 | IMPLEMENTED | Source progress denominator reconciliation | Source orchestration regression |
| D4-AC08 | IMPLEMENTED | Raw/scope/quality/created/updated plus distinct active canonical jobs touched by run, attributed by API preferred source; ADMIN history/UI shows counts; not USER opportunities | SQL/ADMIN regression; D5 live reconciliation pending |
| D4-AC09 | IMPLEMENTED | Existing terminal run persistence/history retained | Worker/native regression |
| D4-AC10 | IMPLEMENTED | Coverage before/after observed by signed scope; request origin via mapping | Coverage snapshot test; native/live verification pending |
| D4-AC11 | IMPLEMENTED | Own status only, no global source/tenant data in USER mapping response | Native isolation test |
| D4-AC12 | IMPLEMENTED | Admin per-source outcome/reason evidence | Admin history regression; DEV pending |
| D5-AC01 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC02 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC03 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC04 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC05 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC06 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC07 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC08 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC09 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC10 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC11 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC12 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D5-AC13 | NOT_STARTED | Integrated release/DEV acceptance | D1–D4 completion and exact SHA mandatory CI; schema preflight required |
| D6-AC01 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC02 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC03 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC04 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC05 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC06 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC07 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC08 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC09 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |
| D6-AC10 | NOT_STARTED | Historical repair delivery | D5 acceptance first; writes require separate authorization |

## Release boundary

Additive migration `011_refresh_requests.sql` is necessary for the private request mapping. Existing E86 promotion/migration controls remain unchanged. Before D5, establish the authorized DEV schema migration route, verification and rollback compatibility; do not bypass E86 implicitly. No DEV database migration or image deployment performed in this development cycle. No TEST/PROD, new IAM, WIF or historical data writes.

CI on prior checkpoint c50f8fb passed. Later checkpoint 5dfbc79 search regression found two existing unscoped adapter call-contract failures; candidate corrections preserve those invocation shapes. Exact final SHA must be rerun and checked. Native CI and live source evidence must be verified separately.

## Follow-up D2–D4 candidate

Role-query budgets remain bounded; no sources activated, no credentials or new infrastructure. Nine ATS adapters now preserve explicit field provenance and distinguish supplied posting dates from update/creation dates where supported. Missing location and listing-only titles cause INCOMPLETE quality; missing incoming posting dates do not erase known values. Crossover and Orange enrichment intentionally remains incomplete when a verified detail cannot be obtained. Canonical publication counts reflect exact run-touched shared jobs, not profile-visible opportunities. The release gate is unchanged: the prior GOV85 exception is scoped to SHA 121f88 and excludes database migration. A new exact-SHA DEV release route and explicit migration 011 authorization are necessary. No runtime acceptance claimed.
