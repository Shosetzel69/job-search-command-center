import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDevRollout, validateImageDigest} from '../observation/dev-rollout-evaluator.mjs';
import {CATALOG_VERSION, TASK_CATALOG, validateTaskRequest, authenticatedEvidence, publicEvidence, validateDispatchBinding} from '../src/lib.mjs';
import {readFileSync} from 'node:fs';

const service='jscc-dev-workspace-manager';
const desired='sha256:'+'a'.repeat(64);
const other='sha256:'+'b'.repeat(64);
const obs=(rows)=>({task:'describe_dev_runtime',environment:'dev',
 resource:'projects/jscc-dev/locations/europe-west1/services/'+service,
 observed_at:'2026-11-05T00:00:00Z',effective_revisions:rows});
const row=(rev,percent,digest)=>({revision:service+'-'+rev,percent,image_digest:digest});

test('R3 catalogue retains existing operations and has exact R3 version',()=>{
 assert.equal(CATALOG_VERSION,'589-r5-v1');
 assert.equal(TASK_CATALOG.inspect_dev_rollout.class,'OBSERVE');
 assert.ok(TASK_CATALOG.describe_execution);
 assert.ok(TASK_CATALOG.read_execution_logs);
 assert.ok(TASK_CATALOG.inspect_runtime_snapshot);
 assert.ok(TASK_CATALOG.run_test_suite);
 assert.deepEqual(validateTaskRequest('inspect_dev_rollout',{
  environment:'dev',service,expected_image_digest:desired
 }).args,{environment:'dev',service,expected_image_digest:desired});
});

test('R3 rollout detects 100-percent immutable image and never authorizes cutover',()=>{
 const r=assessDevRollout(obs([row('00001-lbp',100,desired)]),desired);
 assert.equal(r.rollout_verdict,'IMAGE_MATCHED_100_PERCENT');
 assert.equal(r.matched_percent,100);
 assert.equal(r.unknown_percent,0);
 assert.equal(r.source_provenance,'UNVERIFIED');
 assert.equal(r.traffic_cutover_authorized,false);
 assert.equal(r.active_revision_count,1);
});

test('R3 observed split traffic uses percentages, not latestReadyRevision',()=>{
 const r=assessDevRollout(obs([row('00001-lbp',80,desired),row('00002-lbp',20,other)]),desired);
 assert.deepEqual([r.matched_percent,r.other_percent,r.unknown_percent],[80,20,0]);
 assert.equal(r.rollout_verdict,'SPLIT_TRAFFIC');
});

test('R3 unknown digests always block image proof',()=>{
 const r=assessDevRollout(obs([row('00001-lbp',90,desired),row('00002-lbp',10,'UNKNOWN')]),desired);
 assert.equal(r.rollout_verdict,'IMAGE_NOT_PROVEN');
 assert.equal(r.unknown_percent,10);
 assert.equal(r.traffic_cutover_authorized,false);
});

test('R3 wrong image on entire service is diagnosed independently of source SHA',()=>{
 const r=assessDevRollout(obs([row('00001-lbp',100,other)]),desired);
 assert.equal(r.rollout_verdict,'DIFFERENT_IMAGE');
 assert.equal(r.other_percent,100);
 assert.equal(r.source_provenance,'UNVERIFIED');
});

test('R3 unknown source, malformed traffic, duplicates and mismatched environment fail closed',()=>{
 const bad=[
  obs([]),
  obs([row('00001-lbp',90,desired)]),
  obs([row('00001-lbp',50,desired),row('00001-lbp',50,desired)]),
  obs([row('00001-lbp',101,desired)]),
  obs([{revision:'../../other',percent:100,image_digest:desired}]),
  {...obs([row('00001-lbp',100,desired)]),environment:'prod'},
  {...obs([row('00001-lbp',100,desired)]),effective_revisions:null},
 ];
 for(const item of bad) assert.throws(()=>assessDevRollout(item,desired),/INSUFFICIENT_EVIDENCE/);
});

test('R3 validation denies unallowlisted resources, extra params and arbitrary digests',()=>{
 for(const args of [
  {environment:'test',service,expected_image_digest:desired},
  {environment:'dev',service:'jscc-prod-api',expected_image_digest:desired},
  {environment:'dev',service,expected_image_digest:'latest'},
  {environment:'dev',service,expected_image_digest:'sha256:'+'a'.repeat(63)},
  {environment:'dev',service,expected_image_digest:desired,project:'jscc-prod'},
 ])assert.throws(()=>validateTaskRequest('inspect_dev_rollout',args));
 assert.throws(()=>validateImageDigest('sha256:xyz'),/invalid_image_digest/);
});

test('R3 source/catalog mismatch blocks old R1-B worker dispatch',()=>{
 const x={execution_name:'jscc-diagnostics-dev-abcdef',
 catalog_version:'589-r1b-v1',ops_source_sha:'a'.repeat(40),
 worker_image_digest:desired,expires_at_ms:Date.now()+60000};
 assert.throws(()=>validateDispatchBinding(x,x.execution_name,{
   catalog_version:CATALOG_VERSION,ops_source_sha:x.ops_source_sha,worker_image_digest:desired
 }),/catalog_version_mismatch/);
});

test('R3 topology remains authenticated-only; public assertions do not leak digests',()=>{
 const data={operation_id:'op-test-1234567890',task:'inspect_dev_rollout',
  assertions:{target_alias:service,expected_image_digest:desired,matched_percent:100,
    rollout_verdict:'IMAGE_MATCHED_100_PERCENT',source_provenance:'UNVERIFIED',
    traffic_cutover_authorized:false,secret:'not-for-user'}};
 const pub=publicEvidence(data);
 const auth=authenticatedEvidence(data);
 assert.equal(pub.assertions.expected_image_digest,undefined);
 assert.equal(pub.assertions.rollout_verdict,undefined);
 assert.equal(auth.assertions.expected_image_digest,desired);
 assert.equal(auth.assertions.rollout_verdict,'IMAGE_MATCHED_100_PERCENT');
 assert.equal(auth.assertions.secret,undefined);
});

test('R3 worker image closure contains evaluator; gateway does not require it',()=>{
 const docker=readFileSync(new URL('../Dockerfile.worker',import.meta.url),'utf8');
 assert.ok(docker.includes('COPY ops/observation/dev-rollout-evaluator.mjs ./ops/observation/dev-rollout-evaluator.mjs'));
 assert.ok(docker.includes('USER node'));
});

test('R3 zero-percent revision tags are not treated as serving traffic',()=>{
 const r=assessDevRollout(obs([row('00001-lbp',100,desired),row('00002-lbp',0,other)]),desired);
 assert.equal(r.rollout_verdict,'IMAGE_MATCHED_100_PERCENT');
 assert.equal(r.active_revision_count,1);
 assert.equal(r.other_percent,0);
});
