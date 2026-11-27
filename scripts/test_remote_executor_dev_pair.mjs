import test from 'node:test';
import assert from 'node:assert/strict';
import {runApprovedPair} from './gcp/remote_executor_dev_pair.mjs';

const old={source_sha:'a'.repeat(40),gateway_digest:'sha256:'+'b'.repeat(64),
 worker_digest:'sha256:'+'c'.repeat(64),revision:'jscc-ops-gateway-dev-00015-lxb',tags:{}};
const next={source_sha:'d'.repeat(40),gateway_digest:'sha256:'+'e'.repeat(64),
 worker_digest:'sha256:'+'f'.repeat(64),catalog:'589-nile-api-v1',previous_catalog:'589-nile-api-v1'};
const root='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
function pair(v){return {gateway_image:root+'jscc-ops-gateway@'+v.gateway_digest,
 worker_image:root+'jscc-diagnostics@'+v.worker_digest};}
function proof(kind,p,extra={}){
 return {kind,verified:true,environment:p.environment,source_sha:p.source_sha,
 work_item_ref:p.work_item_ref,plan_hash:p.plan_hash,...extra};
}
function fixture(overrides={},failMethod=null){
 const events=[];
 const args={...next,
 verifyApproval:async p=>proof('OWNER_APPROVAL',p,{approval_ref:'#589/approved'}),
 verifyImagePair:async p=>proof('IMMUTABLE_IMAGE_PAIR',p),
 verifyCost:async p=>proof('COST_ADMISSION',p,{no_incremental_cost_proven:true}),
 verifyMaintenanceWindow:async p=>proof('MAINTENANCE_WINDOW',p,{
 retrieve_and_deploy_excluded:true,tagged_revision_lease_compatible:true,
 rollback_authorized:true,operator_access_verified:true}),...overrides};
 const factory=()=>({call:async(method,...params)=>{
  events.push(method+(method==='verify_pair'?':'+params[0]:''));
  if(method===failMethod)throw Error('fixture_failure');
  if(method==='capture')return old;
  if(method==='verify_pair')return pair(params[0]?old:next);
  return true;
 },close(){events.push('close');}});
 return {args,factory,events};
}
test('R6 operator composition deploys and verifies both before release',async()=>{
 const f=fixture();
 const result=await runApprovedPair(f.args,f.factory);
 assert.equal(result.state,'SUCCEEDED');
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','deploy_gateway','verify_pair:false','release','close']);
});
test('missing approval, cost, or maintenance proof never freezes',async()=>{
 for(const key of ['verifyApproval','verifyImagePair','verifyCost','verifyMaintenanceWindow']){
  const f=fixture({[key]:async()=>({verified:false})});
  await assert.rejects(runApprovedPair(f.args,f.factory));
  assert.deepEqual(f.events,['capture','close']);
 }
});
test('R6 restores both resources, verifies restored pair, then releases',async()=>{
 const f=fixture({},'deploy_gateway');
 const result=await runApprovedPair(f.args,f.factory);
 assert.equal(result.state,'ROLLED_BACK');
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','deploy_gateway','rollback_gateway',
 'rollback_worker','verify_pair:true','release','close']);
});
test('uncertain release never initiates rollback after exclusion may be lost',async()=>{
 const f=fixture({},'release');
 const result=await runApprovedPair(f.args,f.factory);
 assert.equal(result.state,'UNFREEZE_UNCERTAIN');
 assert.equal(result.manual_intervention_required,true);
 assert.equal(result.rollback_attempted,false);
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','deploy_gateway','verify_pair:false','release','close']);
});
