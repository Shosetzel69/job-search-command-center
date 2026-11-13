import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANDIDATE_SHA, TICKET_SCOPE, validateGov85Exception } from './gov85-dev-exception.mjs';

const base = {sha:CANDIDATE_SHA, tickets:TICKET_SCOPE, environment:'dev'};
for (const action of ['preflight', 'inventory', 'images-only']) {
  test(`allows only pinned DEV ${action} for three original tickets`, () => {
    assert.equal(validateGov85Exception({...base, action}).action, action);
  });
}
for (const args of [
  {...base,action:'images-only',sha:'567c4246f8c9621f2df727e066b9e95f4ed7d449'},
  {...base,action:'images-only',sha:'x'.repeat(40)},
  {...base,action:'images-only',environment:'test'},
  {...base,action:'images-only',environment:'prod'},
  {...base,action:'images-only',tickets:'515,520'},
  {...base,action:'images-only',tickets:'520,515,535'},
  {...base,action:'deploy'},
  {...base,action:'db-migrate'},
  {...base,action:'rollback'},
  {...base,action:'images-only',tickets:'515,520,535,590'},
]) {
  test(`refuses non-authorized exception ${JSON.stringify(args)}`, () => {
    assert.throws(() => validateGov85Exception(args), /GOV85_EXCEPTION_/);
  });
}

test('legacy migration promotion guards remain intact', () => {
  const legacyBuild=readFileSync(new URL('../cloudbuild.promotion.yaml',import.meta.url),'utf8');
  const legacyPromote=readFileSync(new URL('./gcp/promote.sh',import.meta.url),'utf8');
  assert.match(legacyBuild,/JSCC541_DEV01B_PROMOTION_PIPELINE_BLOCKED_BEFORE_BUILD[\s\S]*?exit 86/);
  assert.match(legacyPromote,/JSCC541_DEV01B_LEGACY_PROMOTION_BLOCKED[\s\S]*?exit 86/);
});

test('dedicated exception is build-only; no jobs, service, DB or IAM mutation in Cloud Build', () => {
  const config=readFileSync(new URL('../cloudbuild.gov85.dev-images.yaml',import.meta.url),'utf8');
  assert.match(config,/121f88e212013d2c4665bb70f881a3bcee365d21/);
  assert.match(config,/515,520,535/);
  assert.doesNotMatch(config,/gcloud run (jobs|services|deploy)|gcloud sql |db-migrate|promote\.sh|cloudbuild\.promotion\.yaml|_TARGET.*test/);
  assert.match(config,/docker build/);
  assert.match(config,/immutableTags/);
});

test('workflow must not admit TEST, PROD or a deploy action',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/gov85-dev-paired-images.yml',import.meta.url),'utf8');
  assert.match(workflow,/gov85-dev-exception\.mjs/);
  assert.match(workflow,/github\.actor == 'Shosetzel69'/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/id-token: write/);
  assert.doesNotMatch(workflow,/\bdeploy\s*:\s*true|\baction:\s*deploy|\bprod\s*:\s*true/);
  assert.match(workflow,/cloudbuild\.gov85\.dev-images\.yaml/);
});
