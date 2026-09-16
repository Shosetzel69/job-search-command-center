# PROD Cutover and Rollback Runbook

Status: Phase 6 preparation artifact. **Execution is not authorized.**  
Parent: #161  
Preparation issue: #175  
Security gate: #177

## 1. Gate

This runbook may be executed only after:

1. G6 independent QA = PASS;
2. #177 security blockers are closed;
3. owner explicitly approves Phase 7 / PROD cutover in a separate GO;
4. exact cutover source SHA is recorded and has passed DEV/TEST;
5. legacy live PROD health and immutable backup anchors are captured;
6. new dedicated PROD target is healthy and rollback to legacy PROD is proven operationally possible.

If any condition is missing: STOP.

## 2. Cutover objective

Move production ownership from the legacy live stack:

`legacy Cloudflare account + job-search-command-center/main + job-search-full.yml`

into the new fully isolated PROD stack:

`Job Search PROD Cloudflare account + job-search-prod/main + runtime.yml`

while keeping source code in `job-search-command-center` and preserving PROD-only runtime data.

The legacy stack is not modified during Phase 6 and remains the rollback target during Phase 7 until final acceptance.

## 3. Pre-cutover capture

Immediately before any Phase 7 mutation:

- GET legacy live `/health` and save the non-secret response;
- record legacy Worker URL/name, source SHA, runtime repo/ref/workflow and search mode;
- record canonical legacy PROD data blob SHAs;
- create an immutable source/data backup anchor;
- verify legacy deployment remains reachable;
- verify candidate source SHA passed DEV and TEST;
- verify `job-search-prod` contains only approved PROD data;
- verify new PROD Cloudflare account contains only the intended Job Search PROD resources;
- verify PROD credentials cannot access DEV/TEST or the legacy Cloudflare account;
- verify OAuth/client/origin belong to the new PROD target.

If legacy PROD is unhealthy before cutover: STOP.

## 4. New PROD target preparation

Phase 6 prepares, without traffic cutover:

- dedicated Cloudflare account `Job Search PROD`;
- Worker `job-search-command-api` inside that account;
- private `Shosetzel69/job-search-prod`;
- GitHub Environment `prod`;
- separated bootstrap, runtime and source-read GitHub credentials;
- dedicated Cloudflare deploy credential;
- dedicated PROD OAuth client/origin;
- environment-specific secrets/variables;
- trusted control-plane path satisfying #177.

No legacy PROD resource is changed by these preparation steps.

## 5. PROD runtime snapshot creation

Only canonical runtime-data contract files are copied from the immutable legacy PROD snapshot into `job-search-prod`. No DEV/TEST data and no historical test-only files are copied.

The migration commit becomes the initial PROD `RUNTIME_DATA_SHA`.

Validate:

- runtime repository is private;
- exact file inventory and snapshot SHA;
- no DEV/TEST operational content;
- runtime token writes only `job-search-prod`;
- source-read token is read-only to source;
- bootstrap credential is not installed in the Worker;
- Cloudflare token belongs only to the dedicated PROD account.

## 6. New PROD deployment validation

Before traffic/cutover acceptance:

1. deploy the exact approved immutable `SOURCE_SHA` to the **new dedicated PROD Worker**;
2. verify `/health` on the new origin:
   - `environment=prod`;
   - exact `source_sha`;
   - `runtime_repo=Shosetzel69/job-search-prod`;
   - exact `runtime_data_sha`;
   - `search_mode=live`;
   - auth configured;
   - GitHub runtime configured;
3. verify authenticated UI;
4. verify protected APIs reject unauthenticated access;
5. verify runtime credential cannot write source/DEV/TEST;
6. verify Cloudflare deployment credential cannot affect DEV/TEST or the legacy account;
7. execute only the explicitly approved bounded PROD smoke;
8. confirm legacy PROD remains unchanged.

The new PROD origin is not considered the accepted production endpoint until owner cutover approval.

## 7. Cutover

After all gates pass and owner explicitly authorizes Phase 7:

1. freeze mutable production changes for the cutover window;
2. refresh the legacy PROD data snapshot if required and migrate the final approved delta;
3. revalidate new PROD `/health`, auth and protected assets;
4. switch the agreed production access path to the new isolated PROD target;
5. validate user-facing production behavior;
6. confirm no DEV/TEST or legacy resource was unintentionally modified;
7. start the observation window;
8. declare cutover complete only after explicit owner acceptance.

## 8. Stop conditions

Rollback immediately on:

- source/runtime identity mismatch;
- authentication regression;
- protected asset/API exposure;
- missing/invalid runtime data;
- cross-environment credential access;
- unexpected Full Search behavior;
- DEV/TEST or legacy PROD mutation;
- inability to reach the legacy rollback target;
- unapproved paid/quota behavior.

## 9. Rollback

Primary rollback is **traffic/operational return to the untouched legacy PROD stack**, not reconfiguration of the new stack into the legacy model.

Sequence:

1. stop further new-PROD actions;
2. route/return production use to the legacy PROD endpoint;
3. verify legacy `/health`, authentication and protected APIs;
4. confirm legacy runtime data matches the pre-cutover anchor or approved final delta;
5. confirm DEV/TEST unchanged;
6. preserve the new PROD stack and evidence for investigation;
7. do not delete or repurpose either stack until a later successful cutover is accepted.

Rollback never copies DEV/TEST data into PROD.

## 10. Post-cutover cleanup

Only after a stable observation period and explicit owner acceptance:

- disable obsolete direct source-repo deployment for the legacy `job-search-command-api`;
- revoke/remove obsolete legacy runtime credentials;
- retain rollback evidence for the agreed retention period;
- remove the legacy stack only through a separate explicit cleanup decision;
- leave unrelated `ai-github-bridge` infrastructure untouched.

## 11. Evidence package

G7 closeout includes:

- approved source SHA;
- initial/final PROD runtime data SHA;
- legacy pre-cutover `/health`;
- new PROD pre/post-cutover `/health`;
- PROD runtime repo identity;
- GitHub Environment and credential-role segregation evidence;
- Cloudflare account isolation evidence;
- auth/protected API smoke results;
- DEV/TEST/legacy preservation results;
- cutover timestamp;
- rollback anchor;
- owner acceptance.

No secret values are included in evidence.
