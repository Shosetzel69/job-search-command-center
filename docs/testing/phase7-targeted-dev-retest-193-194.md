# Phase 7 targeted DEV retest — #193 / #194

Status: executable after the fix candidate is deployed to DEV.
Executor: DEV instance/agent (currently ChatGPT / Development).
Environment: **DEV only**.
DEV URL: `https://job-search-command-api.job-search-dev.workers.dev`
Parent QA: #188. TEST validation remains assigned to the independent TEST executor.
Defects: #193, #194.

## Scope and hard boundaries

This is a targeted retest, not a replay of all Phase 7 QA.

- Use DEV only until every mandatory DEV case below passes.
- This runbook is executed by the DEV executor only. The independent TEST/QA executor must not enter DEV.
- **Do not run a live Full Search.** DEV must remain `search_mode=disabled`.
- Do not change search criteria, sources, nomenclatures, GitHub configuration, Cloudflare configuration, secrets, runtime repositories, or legacy.
- Do not expose Google tokens, cookie values, Authorization headers, or secrets in screenshots/evidence.
- Owner may perform the interactive Google account click when ChatGPT cannot complete Google authentication itself.
- A missing browser/DevTools capability is `BLOCKED`, not a product `FAIL`.
- Stop the dependent sequence on a reproducible auth failure, but still perform independent read-only checks that remain safe.

## Required baseline evidence

Before login capture all of the following:

1. DEV `/health` exact JSON.
2. Confirm:
   - `status=ok`
   - `environment=dev`
   - `search_mode=disabled`
   - `runtime_repo=Shosetzel69/job-search-runtime-dev`
   - `runtime_ref=main`
   - `source_sha` equals the candidate deployed for this retest.
3. Record `runtime_data_sha` as `DEV_RUNTIME_SHA_BEFORE`.
4. Open DEV in one normal browser tab. Do not alternate environments during the test.
5. Record whether DevTools/Network and Application/Cookies views are available. Do not capture credential values.

---

## DEV-AUTH-01 — Initial authorized login and protected data

**Purpose:** prove the normal Google login still works and establishes both application auth state and the server session fallback.

### Preconditions
- Browser is currently signed out of the JSCC application.
- DEV `/health` is healthy.

### Steps
1. Open the DEV root URL.
2. Confirm `[DEV]` is visible on the sign-in screen.
3. Sign in with the approved Google account. If ChatGPT cannot perform the account click, request OWNER ACTION and continue immediately after the owner completes it.
4. Wait until the normal application shell is visible.
5. Visit `Joburi noi`, `Aplicari`, `Criterii de selectie`, then `Administrare`.
6. In Network, verify these protected assets resolve successfully after authentication:
   - `/data/jobs.json`
   - `/data/applications.json`
   - `/data/search-config.json`
   - `/data/run-status.json`
7. Inspect localStorage and sessionStorage **by key name only**.

### PASS
- No login loop.
- Signed-in application shell renders.
- All four protected requests above return HTTP 200.
- No request returns `Missing Google ID token`.
- No Google ID token or session credential is stored in localStorage/sessionStorage.
- `[DEV]` remains visible.

### FAIL
Any manual re-login loop, protected 401/403 after the successful login, silent empty state caused by auth failure, or credential stored in Web Storage.

### Evidence
- screenshot of authenticated DEV header;
- HTTP status list for the four protected assets;
- storage key names only, never values.

---

## DEV-AUTH-02 — Session survives three consecutive full refreshes

**Purpose:** direct regression test for #193 / historical #153.

### Preconditions
- DEV-AUTH-01 PASS.
- User is currently authenticated.

### Steps
Repeat the following **three times in the same tab**:
1. Press browser Refresh / F5.
2. Do **not** click Google Sign-In and do not choose an account.
3. Wait up to 10 seconds for application recovery.
4. Confirm the authenticated application shell returns.
5. Open `Aplicari` and confirm the page loads normally.
6. Verify at least one protected `/data/...` request returns HTTP 200.

### PASS
For refreshes 1, 2 and 3:
- zero manual Google interaction;
- no account chooser;
- application returns to authenticated state within 10 seconds;
- protected data returns 200;
- `[DEV]` remains visible.

A brief rendering transition is acceptable only if it resolves automatically without user action.

### FAIL
Any refresh requires a manual Google click/account choice, remains on `Acces securizat`, produces `Missing Google ID token`, or shows empty application data because auth failed.

### Evidence
Record a compact table:

| Refresh | Manual Google action | App recovered <=10s | protected HTTP | Result |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

## DEV-AUTH-03 — Five-minute authenticated navigation stability

**Purpose:** reproduce the former defect where JSCC still looked signed in while protected requests started returning 401.

### Preconditions
- DEV-AUTH-02 PASS.

### Steps
For **at least 5 continuous minutes**, without refreshing the page:
1. Navigate repeatedly through `Joburi noi` → `Aplicari` → `Criterii de selectie` → `Administrare`.
2. At approximately minute 0, 2 and 5, capture the status of `/data/jobs.json` and `/data/applications.json` (a normal application navigation/reload of data is sufficient; do not alter data).
3. Observe the signed-in header/email and rendered application data.

### PASS
- No protected request returns 401/403.
- No `Missing Google ID token` appears.
- Header auth state and API auth state remain consistent.
- Application does not silently replace real data with an empty-state due to auth failure.

### FAIL
Any protected 401/403 while UI still claims authenticated, or any silent empty-state caused by auth failure.

### Evidence
Table with minute, endpoint statuses and visible UI state.

---

## DEV-AUTH-04 — Explicit logout really ends the server session

**Purpose:** ensure persistent session support does not make logout ineffective.

### Preconditions
- Authenticated DEV session.

### Steps
1. Use the profile menu → `Deconecteaza`.
2. Confirm `Acces securizat` appears.
3. Wait 2 seconds to allow the keepalive logout request to complete.
4. Refresh the page once.
5. Do not click Google Sign-In.
6. Observe for 10 seconds.
7. If Network is available, observe a session-restore request to `/auth/session` if attempted; it must not restore the application automatically after explicit logout.

### PASS
- App stays signed out after logout and refresh.
- No automatic return to the authenticated shell.
- No credential is present in localStorage/sessionStorage.
- Login hint / non-secret auto-restore marker may exist; that is allowed.

### FAIL
Refresh after explicit logout restores the authenticated application without a new user sign-in.

---

## DEV-AUTH-05 — Invalid/missing server session fails visibly, not silently

**Purpose:** prove expired/missing session handling moves the UI to re-authentication rather than showing fake empty data.

### Capability requirement
DevTools Application/Cookies must allow deletion of the JSCC session cookie **without reading/copying its value**. If this capability is unavailable, mark only this test `BLOCKED`.

### Steps
1. Sign in again and confirm DEV-AUTH-01 conditions.
2. In DevTools, delete the cookie named `__Host-jscc_session`. Do not inspect/copy its value.
3. Trigger one safe protected read by navigating to `Aplicari` or `Joburi noi`.
4. Observe the first protected response and resulting UI.

### PASS
- Protected request is rejected (expected 401 once the server session is absent and no valid bearer fallback is available).
- Application visibly transitions to re-authentication / reloads to `Acces securizat`.
- It does not remain apparently signed in with an empty list.
- No repeated reload loop.

### FAIL
UI remains apparently authenticated while protected data is 401, or replaces data with a normal-looking empty state.

---

## DEV-AUTH-06 — Unauthorized Google account boundary

Do not ask the owner for credentials or create a test account.

- If a safe already-available unauthorized Google account can be selected by the owner, attempt login once and expect HTTP 403 / `Contul Google nu este autorizat`.
- Otherwise mark the **browser variant** `BLOCKED — no safe unauthorized account available` and cite the automated server-side authorization tests as supporting evidence. This BLOCKED browser variant alone does not fail the targeted DEV retest.

---

## DEV-RUN-01 — DEV Full Search remains disabled and button recovers

**Purpose:** direct retest for #194 and DEV safety boundary.

### Preconditions
- Authenticated DEV session.
- `/health.search_mode=disabled`.
- Record `DEV_RUNTIME_SHA_BEFORE_RUN_CHECK` from `/health.runtime_data_sha`.

### Steps
1. Go to the main header or `Administrare` → `Actualizare date` where the manual run button is available.
2. Click the run button **exactly once**.
3. Observe `POST /commands/run`.
4. Do not click again while the request is pending.
5. Wait up to 5 seconds after the HTTP response.
6. Observe button label/state and any toast/message.
7. Re-read DEV `/health` after the UI settles.

### PASS
- `POST /commands/run` returns **HTTP 403** with the controlled message `Full search is disabled for this environment`.
- Button returns to idle (`Ruleaza verificarea` / `Ruleaza acum`) within 5 seconds.
- UI does not enter indefinite polling.
- User sees a clear failure/information message.
- No Full Search workflow starts.
- DEV `runtime_data_sha` is unchanged.

### FAIL
- HTTP 409 is incorrectly treated as an existing live run and the button remains stuck;
- any live collection/workflow starts;
- runtime SHA changes;
- button remains `Verificare in curs...` / `Rulare in curs...` after 5 seconds.

---

## DEV-RUN-02 — Repeated disabled-run attempt is deterministic

**Purpose:** prove the first error did not leave stale client state.

### Preconditions
- DEV-RUN-01 PASS and button is idle.

### Steps
1. Wait at least 2 seconds.
2. Click the same run button once more.
3. Observe the result for 5 seconds.

### PASS
Same controlled 403 behavior as DEV-RUN-01, button returns idle, no workflow, runtime SHA unchanged.

### FAIL
Second attempt behaves differently, stays stuck, or starts a workflow.

---

## Final DEV regression read-only checks

After all cases:
1. GET DEV `/health` again.
2. Confirm source SHA, runtime repo/ref, `search_mode=disabled` and runtime data SHA are still the expected DEV values.
3. Confirm `[DEV]` marker persists.
4. Confirm TEST and PROD were not opened or mutated during this targeted run.

## Verdict rules

- **PASS:** DEV-AUTH-01/02/03/04, DEV-RUN-01/02 and final regression checks all PASS. DEV-AUTH-05 may be BLOCKED only for missing DevTools cookie-deletion capability. DEV-AUTH-06 browser variant may be BLOCKED if no safe unauthorized account is available.
- **FAIL:** any mandatory case fails.
- **BLOCKED:** executor cannot complete a mandatory case because required browser capability or owner login action is unavailable.

## Evidence report format for #188

```markdown
## Targeted DEV retest — #193 / #194
Candidate SOURCE_SHA:
Date/time:
Executor: DEV instance/agent
DEV /health before:
DEV_RUNTIME_SHA_BEFORE:

| Test | Result | Exact evidence |
|---|---|---|
| DEV-AUTH-01 | PASS/FAIL/BLOCKED | |
| DEV-AUTH-02 | PASS/FAIL/BLOCKED | |
| DEV-AUTH-03 | PASS/FAIL/BLOCKED | |
| DEV-AUTH-04 | PASS/FAIL/BLOCKED | |
| DEV-AUTH-05 | PASS/FAIL/BLOCKED | |
| DEV-AUTH-06 | PASS/FAIL/BLOCKED | |
| DEV-RUN-01 | PASS/FAIL/BLOCKED | |
| DEV-RUN-02 | PASS/FAIL/BLOCKED | |

DEV /health after:
DEV_RUNTIME_SHA_AFTER:
Unexpected workflow/run created: YES/NO
Credentials exposed in evidence: NO
Overall targeted DEV verdict: PASS/FAIL/BLOCKED
```

Do not rerun PROD Full Search as part of this retest.
