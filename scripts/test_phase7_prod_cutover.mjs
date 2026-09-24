import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const promotion = readFileSync(resolve(ROOT, '.github/workflows/prod-cutover.yml'), 'utf8');
const runtime = readFileSync(resolve(ROOT, 'config/runtime-template/runtime.yml'), 'utf8');
const commandApi = readFileSync(resolve(ROOT, 'command-api/src/index.js'), 'utf8');
const prodExecutor = readFileSync(resolve(ROOT, 'scripts/environment/prod-reconciliation.mjs'), 'utf8');
const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');
const promotionEvidence = readFileSync(resolve(ROOT, 'scripts/environment/promotion.mjs'), 'utf8');

test('PROD promotion is manual-only, PROD-scoped and serialized', () => {
  assert.match(promotion, /name: PROD promotion/);
  assert.match(promotion, /workflow_dispatch:/);
  assert.doesNotMatch(promotion, /schedule:/);
  assert.doesNotMatch(promotion, /push:/);
  assert.match(promotion, /environment:\s*prod/);
  assert.match(promotion, /group: deploy-prod/);
  assert.match(promotion, /cancel-in-progress: false/);
});

test('PROD mutation requires explicit owner GO and release-specific rollback reference', () => {
  assert.match(promotion, /owner_gate=PROD_GO/);
  assert.match(promotion, /rollback_reference/);
  assert.match(promotion, /PROD mutation requires rollback_reference/);
  assert.doesNotMatch(promotion, /PHASE7_APPROVED/);
});

test('PROD requires exact TEST PASS evidence for the same immutable candidate', () => {
  assert.match(promotion, /test_pass_run_id/);
  assert.match(promotion, /promotion-test-pass/);
  assert.match(promotion, /verify-test-pass/);
  assert.match(promotion, /CANDIDATE_SHA/);
  assert.match(promotion, /merge-base --is-ancestor/);
  assert.match(promotion, /TEST-passed candidate is not reachable from approved main/);
});

test('PROD captures distinct previous promotion snapshot and acceptance runtime head before mutation', () => {
  assert.match(promotion, /previous-prod-health\.json/);
  assert.match(promotion, /Previous PROD source_sha is invalid/);
  assert.match(promotion, /Previous PROD runtime_data_sha is invalid/);
  assert.match(promotion, /expected_runtime_sha/);
  assert.match(promotion, /expected_runtime_head/);
  assert.match(promotion, /prior promotion_runtime_sha/);
  assert.match(promotion, /prior acceptance_runtime_head/);
  assert.match(promotion, /expected acceptance_runtime_head/);
  assert.match(promotion, /--expected-runtime-head/);
});

test('PROD release record is generated after exact candidate health verification', () => {
  assert.match(promotion, /prod-health\.json/);
  assert.match(promotion, /create-release/);
  assert.match(promotion, /release-record\.json/);
  assert.match(promotion, /name: release-record/);
  assert.match(promotion, /owner-go-reference/);
});

test('PROD release record receives both runtime-anchor identities plus reconciliation evidence', () => {
  assert.match(promotion, /--expected-runtime-sha "\$EXPECTED_RUNTIME_SHA"/);
  assert.match(promotion, /--expected-runtime-head "\$EXPECTED_RUNTIME_HEAD"/);
  assert.match(promotion, /--reconciliation-file promotion-output\/reconciliation\.json/);
  assert.match(promotionEvidence, /previous_prod_runtime_anchor/);
  assert.match(promotionEvidence, /prod_runtime_anchor/);
  assert.match(promotionEvidence, /promotion_runtime_sha/);
  assert.match(promotionEvidence, /acceptance_runtime_head/);
});

test('configuration and destructive DB changes fail closed without rollback evidence', () => {
  assert.match(promotion, /bootstrap-deploy requires config_rollback_reference/);
  assert.match(promotion, /database_change/);
  assert.match(promotion, /Destructive DB change requires migration_version/);
  assert.match(promotion, /Destructive DB change requires db_backup_reference/);
  assert.match(promotion, /Destructive DB change requires SHA-256 checksum verification/);
  assert.match(promotion, /Destructive DB change requires non-PROD restore evidence/);
});

test('PROD deployment keeps trusted control-plane separate from candidate payload', () => {
  assert.match(promotion, /Checkout trusted control-plane from main/);
  assert.match(promotion, /Checkout immutable candidate source as inert payload/);
  assert.match(promotion, /Prepare sanitized candidate payload on trusted baseline/);
  assert.match(promotion, /cmp control-plane\/command-api\/wrangler\.jsonc/);
  assert.match(promotion, /Execute reconciled PROD candidate promotion/);
  assert.match(prodExecutor, /deployCandidateWithReconciliation/);
  assert.match(provision, /export async function deployCandidateWithReconciliation/);
});

test('PROD runtime executes search from immutable source then publishes and redeploys exact runtime snapshot', () => {
  assert.match(runtime, /Collect normalize filter and score in PROD/);
  assert.match(runtime, /Publish PROD runtime results safely/);
  assert.match(runtime, /RUNTIME_DATA_SHA/);
  assert.match(runtime, /Redeploy PROD with published runtime snapshot/);
  assert.match(runtime, /Verify PROD health after runtime redeploy/);
  assert.match(runtime, /TEST smoke policy verified immutable source checkout only/);
});


test('PROD candidate-managed reconciliation uses the exact approved allowlist and replaces the unsafe direct snapshot path', () => {
  assert.match(promotion, /for path in data\/sources\.json data\/source-categories\.json data\/nomenclatures\.json/);
  assert.match(promotion, /Unexpected candidate-managed payload/);
  assert.doesNotMatch(promotion, /cp -a candidate-source\/data/);
  assert.doesNotMatch(promotion, /Resolve deployment runtime snapshot/);
  assert.doesNotMatch(promotion, /Deploy exact TEST-passed candidate to dedicated PROD/);
  assert.match(promotion, /id-token: write/);
  assert.match(promotion, /Acquire short-lived functional verification OIDC token/);
  assert.match(promotion, /FUNCTIONAL_GITHUB_OIDC_TOKEN/);
  assert.match(promotion, /jscc-functional-verification/);
  assert.doesNotMatch(promotion, /FUNCTIONAL_GOOGLE_ID_TOKEN/);
  assert.doesNotMatch(promotion, /secrets\.FUNCTIONAL_GOOGLE_ID_TOKEN/);
  assert.match(promotion, /RECONCILIATION_EVIDENCE_PATH/);
  assert.match(promotion, /reconciliation-prod-\$\{\{ github\.run_id \}\}/);
  assert.match(promotion, /--reconciliation-file promotion-output\/reconciliation\.json/);
  assert.match(promotionEvidence, /PROD reconciliation evidence is missing/);
});

test('PROD reconciliation runs only after immutable runtime anchor and TEST PASS guards', () => {
  const guard = promotion.indexOf('Verify exact TEST PASS evidence');
  const anchor = promotion.indexOf('Verify immutable PROD acceptance runtime head');
  const reconcile = promotion.indexOf('Execute reconciled PROD candidate promotion');
  const release = promotion.indexOf('Create minimal non-secret release record');
  assert.ok(guard >= 0 && anchor > guard && reconcile > anchor && release > reconcile);
});

test('bootstrap-deploy advances from pre-bootstrap anchor to an explicitly authorized post-bootstrap reconciliation head', () => {
  const bootstrap = promotion.match(/- name: Install PROD runtime workflow without rewriting runtime data[\s\S]*?- name: Configure PROD runtime variables and secrets/)?.[0] || '';
  assert.match(bootstrap, /EXPECTED_RUNTIME_HEAD/);
  assert.match(bootstrap, /cloned_head=/);
  assert.match(bootstrap, /PROD runtime moved before bootstrap workflow update/);
  assert.match(bootstrap, /authorized_head=/);
  assert.match(bootstrap, /remote_head=/);
  assert.match(bootstrap, /PROD runtime moved after authorized bootstrap workflow update/);
  assert.match(bootstrap, /RECONCILIATION_RUNTIME_HEAD=\$authorized_head/);

  const execute = promotion.match(/- name: Execute reconciled PROD candidate promotion[\s\S]*?- name: Upload PROD reconciliation trace/)?.[0] || '';
  assert.match(execute, /--expected-runtime-head "\$RECONCILIATION_RUNTIME_HEAD"/);
  assert.doesNotMatch(execute, /--expected-runtime-head "\$\{\{ inputs\.expected_runtime_head \}\}"/);
});

test('PROD reconciliation artifact is mandatory evidence', () => {
  const upload = promotion.match(/- name: Upload PROD reconciliation trace[\s\S]*?- name: Create minimal non-secret release record/)?.[0] || '';
  assert.match(upload, /if-no-files-found: error/);
  assert.doesNotMatch(upload, /if-no-files-found: warn/);
});

test('PROD reconciled deployment refreshes Worker runtime secrets before protected verification', () => {
  assert.match(prodExecutor, /configureBootstrapSecrets: true/);
  assert.match(provision, /'secret', 'put', 'GITHUB_TOKEN'/);
  assert.match(provision, /'secret', 'put', 'ALLOWED_GOOGLE_SUB'/);
  assert.match(provision, /verifyProtectedFunctionalVisibility/);
});

test('health validates live runtime repository access rather than token presence only', () => {
  assert.match(commandApi, /github_configured:await canAccessRuntimeRepository\(env, runtime\)/);
  assert.doesNotMatch(commandApi, /github_configured:Boolean\(env\.GITHUB_TOKEN\)/);
  assert.match(promotion, /contents\/data\/search-config\.json\?ref=main/);
  assert.match(promotion, /Runtime token cannot read canonical runtime contents/);
});


test('pre-deploy rollback anchor capture does not block credential remediation', () => {
  const block = promotion.match(/Capture previous known-good PROD anchors before mutation[\s\S]*?- name: Verify credential boundaries before mutation/)?.[0] || '';
  assert.match(block, /auth_configured == true/);
  assert.doesNotMatch(block, /github_configured == true/);
  assert.match(block, /Previous PROD identity\/rollback anchors are invalid/);
});
