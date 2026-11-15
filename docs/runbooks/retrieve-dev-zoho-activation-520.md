# #520 — Zoho DEV activation preparation

Evidence: exact #651 head 91df66522cd4375ed75790c4b012cf7cc4a5f509, GitHub Actions read-only run 43693128531. 52 VALID, 6 INCOMPLETE, zero INVALID. Three qualified activation candidates only:
| ID | Exact public board | Evidence |
|---|---|---|
| src-zoho-osf-digital | https://osf-global.zohorecruit.com/careers | 22/22 VALID |
| src-zoho-hr-plus | https://hr-plus.zohorecruit.com/careers | 20/20 VALID |
| src-zoho-matritel | https://matritel.zohorecruit.com/careers | 10/10 VALID |

## Existing ADMIN registry path
Do not edit candidate data/sources.json or shared routes, set pilot flags, or bypass generation checks. After final exact-SHA paired DEV deployment, confirm each runtime catalog ID/name/URL and current validation/approval/active state, then use existing authenticated ADMIN source actions POST /sources/{id}/actions (same origin), individually: mark_validated with reason "GitHub 43693128531: N/N VALID; #651; board fallback", approve, activate. If already validated/approved advance only missing steps; if identity differs or rejected state, stop that source. Verify readback and run plan; save pre-state, disable just the changed sources if rollback required. Existing ADMIN authorization and DEV-only adapter gate remain mandatory. No direct GCS mutation or new permission. The current connector exposes read-only runtime verification, not authenticated source-action mutation. Activation preparation is not activation; use existing ADMIN UI if no authorized mutation connector exists.

MADIFF and MyEmployment remain inactive. MADIFF: reuse public /jobs/Careers metadata only if it proves a larger inventory containing all portal IDs; preserve missing details explicitly, existing total request cap 101, elapsed budget 180s, same-tenant URL and no token publication. No invented pagination endpoint. Partial coverage must be reported partial, never readiness. If public metadata is absent/inconsistent, remain fail-closed. MyEmployment remains incomplete and no activation proposed. Acceptance: live scoped Retrieve, source quality, canonical Nile/API/UI and disabled-source isolation. No TEST/PROD or new deployment separate from #520.

## R2 — bounded scheduling and deadline
Rotate available portal links in stable ID order using the UTC minute slot, rather than a fixed prefix. This mitigates prefix starvation without persisted cursor state; it is not exhaustive pagination or guaranteed cross-run coverage. Preserve explicitly published metadata descriptions as partial, and never fabricate individual links. The public MADIFF portal's Next control has no verified direct paging URL in retrieved evidence. The expanded inventory is not proof of exhaustive detail access; any unpublished/unverified individual link remains a blocker for complete MADIFF acceptance. MADIFF stays inactive. Shared monotonic deadline applies to both listing surfaces and details, clamps HTTP timeout to remaining time, checks chunk reads and stops on expired detail, with a partial result. OS DNS/transport behavior is not a hard process-kill deadline. Confirm exact CI and read-only live evidence; no activation or separate deployment.
