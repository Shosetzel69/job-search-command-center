# Workspace Manager cap-100 image pair — DEV only

**Important:** the deployed system has two *separate* Python images (Workspace
Manager and unprivileged Worker). Both import `service.common.MAX_FILES`.
Updating Manager alone admits 100 files in GCS but causes worker-side
`checked_files()` to fail above 80. Both images must use cap=100.

Build both images by layering the **same reviewed** `common.py` over their
respective **immutable** currently deployed image digests. The Dockerfile
`Dockerfile.cap100` is intentionally role-agnostic; it copies only
`/workspace/service/common.py` and verifies its constants.

Preconditions for independent review / release:
- Record actual Cloud Run Manager **and Worker** effective traffic revisions,
  service names and digest-pinned images. Do not invent Worker digest.
- Verify imported Manager source from digest
  `sha256:df89d44657c56826eab4d6507487e8f6c391df2f42e13a4b3f80e7cc47c5c9f2`
  and independently verify Worker source parity (not implied by this import).
- Verify each image has Python 3 and `/workspace/service/common.py`.
- Confirm both image digests are immutable, from existing approved projects
  and scoped to DEV. No TEST/PROD or gateway image changes.
- Obtain independent security/source review and explicit build/deploy
  authorization; prove no incremental paid resources.
- Build artifacts at exact approved source SHA via
  `cloudbuild.workspace-manager-cap-100.yaml` using the existing
  `jscc-ops-build` principal. Build does **not** deploy.
- Validate 99, 100 accepted and 101 rejected in **both** Manager and Worker,
  auth/read/write/run, failure codes and isolation. Worker should not
  have ambient GCS/GCloud credentials. Deploy Manager/Worker together using
  controlled Cloud Run tagged revisions; cut over only after staging PASS.
  Record actual traffic and rollback digest pair.

Do not use the existing `deploy-environment.yml` Cloudflare-oriented workflow:
it is not a workspace manager deployment path.
