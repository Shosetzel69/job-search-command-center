import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planDevOperatorIam,operatorIamCommands} from '../../scripts/gcp/remote_executor_dev_operator_iam.mjs';
const {plan,sha256}=planDevOperatorIam(),byRole=new Map(plan.roles.map(r=>['projects/'+r.project+'/roles/'+r.id,r.permissions]));
const ops='jscc-dev-ops-state',source='jscc-shared-ops-cloudbuild-source';
const gateway='jscc-ops-gateway-dev',job='jscc-ops-operator-dev',publisher='jscc-ops-publisher-dev';
function allows(who,bucket,name,permission){
 const resource='projects/_/buckets/'+bucket+(name===null?'':'/objects/'+name);
 return plan.bucket_bindings.some(b=>b.bucket===bucket&&b.member==='serviceAccount:'+who+'@jscc-dev.iam.gserviceaccount.com'&&
  byRole.get(b.role).includes(permission)&&b.condition.expression.split(' || ').some(e=>{
   const m=e.match(/^resource.name.startsWith\('([^']+)'\)$/);
   return m?resource.startsWith(m[1]):e==="resource.name == '"+resource+"'";
  }));
}
test('F1 fixed prefix matrix isolates immutable approval and controller records',()=>{
 const all=['approvals','operator-requests','operator-dispatch','operator-claims','operator-results','builds','builds/ledgers','builds/consumed','deployments'];
 for(const who of [gateway,job,publisher,'jscc-diagnostics-dev','jscc-dev-sandbox-worker']){
  for(const p of all){
   const path='control/v1/'+p+'/a.json',create=who===publisher?p==='approvals':who===gateway?['operator-requests','operator-dispatch'].includes(p):
    who===job?['operator-claims','operator-results','builds/ledgers','builds/consumed','deployments'].includes(p):false;
   assert.equal(allows(who,ops,path,'storage.objects.create'),create,who+':'+p);
   assert.equal(allows(who,ops,path,'storage.objects.delete'),who===job&&['builds/ledgers','deployments'].includes(p),who+':'+p);
  }
  for(const p of ['control/v1/migrations/x.json','control/v1/product-job-steps/x.json','control/v1/unknown/x.json'])
   assert.equal(allows(who,ops,p,'storage.objects.create'),false);
  assert.equal(allows(who,ops,null,'storage.objects.list'),who===job);
  for(const permission of ['storage.objects.get','storage.objects.create','storage.objects.delete']){
   assert.equal(allows(who,ops,'leases/diagnostics.json',permission),who===job);
   assert.equal(allows(who,ops,'leases/diagnostics.json.other',permission),false);
   assert.equal(allows(who,ops,'leases/other.json',permission),false);
  }
  assert.equal(allows(who,source,null,'storage.objects.list'),false);
 }
 assert.equal(allows(gateway,ops,'control/v1/approvals/a.json','storage.objects.get'),true);
 assert.equal(allows(job,ops,'control/v1/approvals/a.json','storage.objects.get'),true);
 assert.equal(allows(publisher,ops,'control/v1/operator-requests/a.json','storage.objects.get'),false);
 assert.equal(allows(publisher,source,'source/dev-a.tar.gz','storage.objects.create'),true);
 assert.equal(allows(publisher,source,'source/dev-a.tar.gz','storage.objects.delete'),false);
 assert.equal(allows(job,source,'source/dev-a.tar.gz','storage.objects.create'),false);
 assert.equal(allows(gateway,source,'source/dev-a.tar.gz','storage.objects.get'),false);
 assert.equal(allows(job,source,'source/test-a.tar.gz','storage.objects.get'),false);
});
test('F1 plan is deterministic, exact pin commands only, no general grants or activation',()=>{
 assert.deepEqual(planDevOperatorIam(),{plan,sha256});
 assert.throws(()=>operatorIamCommands('0'.repeat(64)),/pin_mismatch/);
 const commands=operatorIamCommands(sha256);
 assert.ok(commands.roles.every(r=>r.create.includes('--stage=GA')&&r.expected_permissions.length>0));
 const text=JSON.stringify(commands);
 for(const bad of ['roles/storage.objectUser','roles/owner','roles/editor','set-iam-policy','serviceAccountTokenCreator','run.jobs.runWithOverrides'])
  assert.equal(text.includes(bad),false,bad);
 assert.equal(plan.activation_authorized,false);assert.equal(plan.live_iam_verified,false);
 assert.deepEqual(plan.job_bindings.map(x=>x.job),[job]);
});

test('R4 CLI rejects wrong pin without stack trace or commands',()=>{
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/gcp/remote_executor_dev_operator_iam.mjs',import.meta.url)),'--commands','0'.repeat(64)],{encoding:'utf8'});
 assert.equal(r.status,2);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'operator_iam_plan_pin_mismatch');
});
