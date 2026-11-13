# JSCC — Component-scoped automatic triggers (Variant B)
# Status: IMPLEMENTATION PARTIAL / EXTERNAL CONFIG PENDING
Date: 2026-11-13
Owner decision: Variant B for all JSCC components
Root: #626; related GOV-85 #623 / O-01
Scope: DEV engineering preparation; TEST/PROD and M3 not authorized

## Invariants
- Path filtering applies to **automatic change-triggered tests/builds/previews only**; it is NOT authorization to build/deploy.
- Never silence mandatory global security checks: `gitleaks` remains enabled for all PRs and main pushes; the Cloud Run Admin API v2 policy check remains global as required by ADR-009.
- Preserve exact candidate SHA, immutable digests, mandatory Service + Search Job artifact parity for every coordinated release, Retrieve/tenant security, EFA-01..17, rollback and owner approval.
- Workflow_dispatch and issue-comment authorized dispatches, scheduled sanity and the non-mutating project snapshot are not turned into automatic builds/deploys.
- `cloudbuild.promotion.yaml` and `scripts/gcp/promote.sh` still contain intentional `exit 86`; path filtering never bypasses them.
- A Cloud Build YAML recipe does NOT establish that an actual GCP trigger exists. Verify external effective triggers before claiming implementation.

## Component matrix (automatic triggers)
| Component / plane | Relevant code and build-input paths | Current enforcement | Scope rule |
|---|---|---|---|
| Cloudflare `ai-github-bridge` Workers Builds | `ai-github-bridge/*` (Cloudflare `*` matches nested files) | **EXTERNAL CONFIG PENDING** | Cloudflare production and preview both filter these paths; docs-only changes must not build |
| AI GitHub bridge GitHub CI | `ai-github-bridge/**`, `.github/workflows/ai-github-bridge-check.yml` | **SOURCE PREPARED** in #626 | Tests/dry-run on bridge changes only; docs policy and global security checks still apply |
| Cloud Run Service (frontend + Command API) | `frontend/**`, `command-api/**`, `shared/**`, relevant `data/*.json`, `Dockerfile.service`, Service Cloud Build recipes and their build scripts | **GCP TRIGGER INVENTORY PENDING** | Any *existing authorized automatic* Service build may scope these paths; never auto-deploy |
| Cloud Run Search Job | `scripts/**`, `shared/**`, `data/**`, `Dockerfile`, `requirements-search.txt`, search build recipes / test fixtures | **GCP TRIGGER INVENTORY PENDING** | Any *existing authorized automatic* Job build may scope these paths; no unintended runs |
| Ops Gateway + diagnostics worker | `ops/src/**`, `ops/test/**`, `ops/package.json`, `ops/Dockerfile.*`, `cloudbuild.ops.yaml`, related `scripts/gcp/*remote_executor_dev.sh` and ops build scripts | **GCP TRIGGER INVENTORY PENDING** | Keep approved build authority and production isolation |
| Workspace Manager | `ops/workspace-manager/**`, workspace-manager Cloud Build recipes, manager test and rollout scripts | **GCP TRIGGER INVENTORY PENDING** | No extra resource, no relaxation of MAX_FILES or execution permission |
| Remote Executor GitHub CI | `ops/**`, `cloudbuild.ops.yaml`, `scripts/gcp/*remote_executor_dev.sh`, `.github/workflows/remote-executor-check.yml` | **SOURCE PREPARED** in #626 | Scope test-only CI to implementation paths; unrelated docs do not trigger it |
| Command API / frontend / search CI | Existing path-triggered `command-api-check.yml` on source, shared, data and relevant orchestration scripts | **EXISTING FILTER PRESERVED** | This CI is a cross-component test suite; never treat it as automatic deploy |
| Source catalog / data | `data/**`, source registries, scripts and contracts consuming that data | **EXISTING CONTRACTS PRESERVED** | Shared dependency: CI scopes include real consumers; source activation remains a separate admin gate |
| Security / compliance | All PRs + main pushes for `gitleaks`, ADR-009 guard, docs-specific policy for Markdown | **GLOBAL CHECKS PRESERVED** | Do not path-filter mandated security checks simply to improve speed |
| Explicit release / operational workflows | GCP promotion, manual/owner dispatch, TEST/PROD approval, scheduled and issue-event snapshot | **UNCHANGED** | Authorization and inputs, not commit-path filters, govern mutation |

### Paired-image exception (mandatory)
Service and Search Job may use different incremental *test* selection, but a release requiring a coordinated pair **must provide both immutable image digests from the same approved exact candidate SHA** even when a change touches only frontend or only collector. Filter rules cannot turn a successful Service-only build into paired release readiness; no Retrieve change may proceed without its applicable Job and data identity checks.

## External activation A — Cloudflare Workers Builds (O-01)
1. Open **Cloudflare dashboard → Workers & Pages → `ai-github-bridge` → Settings → Build → Build watch paths**.
2. Record the effective current settings for **production** and **preview branches** separately; confirm the connected repo is `Shosetzel69/job-search-command-center` and current root directory.
3. Configure BOTH applicable settings to **Include paths: `ai-github-bridge/*`** and **Exclude paths: empty**. Confirm the slash and wildcard semantics: Cloudflare `*` matches nested directories. If the effective build depends on files outside that folder, add those explicit paths after verifying dependency evidence.
4. Save. Verify with an authorized, controlled documentation-only change that no bridge preview build occurs; verify a bridge-code change triggers exactly the expected preview. Check Cloudflare build history and GitHub comments; do **not** intentionally deploy to production to test filtering.
5. Record screenshots/settings timestamp, actual Worker tag, observed build IDs and evidence in #626. **Do not mark O-01 resolved until live Cloudflare settings and negative-path behavior are demonstrated.**
6. Cloudflare documented exceptions: 0 changed files, 3000+ files or 20+ commits may bypass path filters. These are observed platform limits; never treat path filtering as a security authorization boundary.

Reference: https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/
Optional API (ONLY when appropriately authenticated and approved): https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/ — requires **user-scoped** token, not a repo secret or account-scoped token. No token is collected or modified by #626.

## External activation B — Google Cloud Build and other CI providers
1. Inventory real enabled Cloud Build trigger IDs/configurations (shared project and DEV scope), their event types, branch selectors, service accounts, substitutions, approval settings, and build config filenames; distinguish manual invocations from automatic triggers.
2. Only if an **existing approved automatic trigger** is found, propose the narrowest file-glob includes matching the component matrix, and test positive+negative change sets read-only before mutation.
3. Preserve all explicit owner-gated deployment flows and exact-SHA contract. Do not enable disabled triggers, create new triggers, expand IAM or move any TEST/PROD deployment authority.
4. Deploy/merge changes to external trigger configurations only through their own approved change step. Document before/after ID and effective settings; do not infer from this runbook that configuration was applied.

## Verification matrix
| Changed files | Expected selective component tests/builds | Preserved global/operational checks |
|---|---|---|
| `docs/analysis/*.md` | No Cloudflare preview, no bridge or Ops test; docs-policy only | Global `gitleaks` and ADR-009 remain eligible |
| `frontend/src/*` | Frontend/Service CI; NO Cloudflare bridge or Ops build | Global/security; coordinated Service+Job release identity applies if separately approved |
| `scripts/job_search.py` | Search Job CI; shared API regression only where relevant | Global; no implicit Retrieve/Cloud Run execution |
| `ops/src/gateway.mjs` | Ops tests and any approved Ops build | Global; no bridge Cloudflare preview |
| `ops/workspace-manager/service/manager.py` | Workspace Manager & Ops-related tests | Global; no unapproved Ops or manager deployment |
| `ai-github-bridge/src/worker.js` | Bridge tests + intended Cloudflare preview on permitted branch | Global; no Command API/Job deploy |
| `shared/**` or relevant data/contract change | Every genuine consuming component check | Global; preserve paired release requirements |
| `.github/workflows/ai-github-bridge-check.yml` | Bridge CI test (workflow self-change) | Global; Cloudflare preview still skipped unless bridge source changed |

## Acceptance and release decision
- SOURCE_PREPARED: repository PR contains narrowed component-only CI paths; global required CI unchanged.
- EXTERNAL_CONFIG_PENDING: Cloudflare/GCP provider settings have not been read or changed through this PR.
- LIVE_VERIFIED only with actual provider settings and observed negative+positive triggering evidence.
- Documentation-only PR can have GitHub security and doc checks while triggering **zero component builds** after external configuration is active.
- No claim of 'Variant B active for all JSCC components' until the provider-specific evidence exists. A later review can disposition each real configured trigger separately.
- Scope remains separate from GOV-85 M3 activation and all TEST/PROD promotions.
