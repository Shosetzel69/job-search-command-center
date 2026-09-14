# PROD Cutover and Rollback Runbook

Status: Phase 6 preparation artifact. **Execution is not authorized.**  
Parent: #161  
Preparation issue: #175

## 1. Gate

This runbook may be executed only after:

1. G6 independent QA = PASS;
2. owner explicitly approves Phase 7 / PROD cutover in a separate GO;
3. exact cutover source SHA is recorded;
4. current live PROD health and backup anchors are captured;
5. rollback target is proven reachable.

Without all five conditions: STOP.

## 2. Cutover objective

Move PROD runtime data/workflow ownership from the legacy source-backed model:

`job-search-command-center / main / job-search-full.yml`

into the isolated PROD runtime model:

`job-search-runtime-prod / main / runtime.yml`

while keeping source code in `job-search-command-center` and preserving PROD data only.

## 3. Pre-cutover capture

Before any live mutation:

- GET live `/health` and save non-secret response;
- record current Worker URL and Worker name;
- record current live source SHA;
- record current runtime repository/ref/workflow identity;
- record current canonical PROD data file blob SHAs;
- create immutable source/data backup anchor;
- verify the legacy deployment path remains available for rollback;
- verify candidate source SHA has passed DEV and TEST;
- verify PROD runtime repo snapshot contains no DEV/TEST data.

If current PROD health is not green before cutover: STOP.

## 4. PROD runtime snapshot creation

Only canonical runtime-data contract files are copied from the captured PROD snapshot. No DEV/TEST runtime data and no historical test-only source files are copied.

The migration commit in `job-search-runtime-prod` becomes the initial `RUNTIME_DATA_SHA`.

After commit:

- verify repository is private;
- verify file inventory;
- verify runtime data SHA;
- verify source/workflow separation;
- verify PROD credentials are least privilege.

No Worker change has occurred yet at this point.

## 5. Live cutover sequence

After all gates pass:

1. configure PROD runtime repository variables/secrets;
2. configure PROD Worker variables to target `job-search-runtime-prod` and `runtime.yml`;
3. deploy the exact approved immutable `SOURCE_SHA`;
4. verify `/health`:
   - `environment=prod`;
   - exact `source_sha`;
   - `runtime_repo=Shosetzel69/job-search-runtime-prod`;
   - exact `runtime_data_sha`;
   - `search_mode=live`;
   - auth configured;
   - GitHub runtime configured;
5. verify authenticated UI;
6. verify protected API rejects unauthenticated access;
7. verify runtime token cannot write source/DEV/TEST;
8. execute only the explicitly approved safe PROD smoke;
9. confirm no DEV/TEST target changed;
10. declare cutover complete only after owner acceptance.

## 6. Stop conditions

Rollback immediately if any of these occurs:

- `/health` identity mismatch;
- authentication regression;
- protected asset/API exposure;
- wrong runtime repository/ref/workflow;
- missing or invalid runtime data;
- source SHA mismatch;
- cross-environment credential access;
- unexpected Full Search execution;
- DEV/TEST mutation;
- new paid/quota behavior not previously approved.

## 7. Rollback

Rollback restores the pre-cutover PROD Worker configuration and deployment identity captured in section 3.

Sequence:

1. stop further PROD actions;
2. restore legacy runtime owner/repo/ref/workflow variables;
3. redeploy the last known-good pre-cutover source SHA if required;
4. restore the legacy PROD runtime-data snapshot/commit reference;
5. verify legacy `/health`, authentication and protected APIs;
6. confirm DEV/TEST remain unchanged;
7. record the failure evidence and keep `job-search-runtime-prod` intact for investigation;
8. do not delete the legacy path until a later successful cutover is accepted.

Rollback never copies DEV/TEST data into PROD.

## 8. Post-cutover cleanup

Only after stable owner acceptance:

- disable the obsolete direct source-repo deployment path for `job-search-command-api`;
- prove source PR/push no longer deploys the Command API directly;
- retain rollback evidence for an agreed observation period;
- remove redundant legacy credentials only after rollback is no longer required;
- leave unrelated `ai-github-bridge` infrastructure untouched.

## 9. Evidence package

G7 closeout must contain:

- approved source SHA;
- initial PROD runtime data SHA;
- pre/post `/health` evidence;
- PROD runtime repo identity;
- credential isolation results;
- auth/protected API smoke results;
- DEV/TEST preservation results;
- cutover timestamp;
- rollback anchor;
- owner acceptance.

No secret value is included in evidence.
