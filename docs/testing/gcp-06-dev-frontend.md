# GCP-06 — DEV frontend migration to Cloud Run

Scope: #436, DEV only.

## Target

One Cloud Run origin serves both:
- React/Vite frontend;
- authenticated Command API.

DEV origin:

`https://jscc-command-api-dev-828902654738.europe-west1.run.app`

The frontend already uses relative API paths, so no client-side API base URL is introduced.

## Build

`Dockerfile.service` uses a dedicated frontend build stage and copies only `frontend/dist` into the runtime image.

Cloud Build validates:
- Command API tests;
- static frontend routing tests;
- existing frontend tests;
- Vite production build;
- immutable exact-SHA Service image.

## Routing

API authority is preserved for:
- `/health`
- `/health/db`
- `/auth/*`
- `/data/*`
- `/commands/*`
- `/config`
- `/sources*`
- `/source-categories*`
- `/nomenclatures*`

Other GET/HEAD requests are served from `frontend/dist`. Missing non-API routes fall back to `index.html` for SPA navigation.

## DEV cutover

Set:

`FRONTEND_ORIGIN=https://jscc-command-api-dev-828902654738.europe-west1.run.app`

Keep Cloud Run transport publicly reachable; application auth remains authoritative for protected paths.

The existing Google OAuth client must list the Cloud Run origin as an authorized JavaScript origin. If not already present, this is an owner-side Google Cloud Console action.

## Validation

1. `GET /` -> HTML frontend.
2. built JS/CSS asset -> 200 with correct content type.
3. SPA route -> index HTML.
4. `/health` -> PASS.
5. `/health/db` -> `jobsearch_dev`.
6. anonymous protected API -> 401.
7. browser Google sign-in -> PASS.
8. authenticated jobs/config load -> PASS.
9. manual full search -> Service -> Job path.

## Rollback

Cloud Run rollback:
- route traffic back to revision `jscc-command-api-dev-00002-gfl`.

Functional fallback:
- existing Cloudflare DEV origin remains available until GCP DEV acceptance is complete.

No TEST/PROD change is authorized by this slice.
