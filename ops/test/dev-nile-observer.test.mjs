import test from 'node:test';
import assert from 'node:assert/strict';
import {observeNile} from '../nile/dev-nile-observer.mjs';

const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const role='jscc_nile_observer';
function fixture({guard={},failAt=null}={}) {
  const calls=[], releases=[];
  const client={
    async query(sql,args) {
      calls.push({sql,args});
      if (failAt && sql.startsWith(failAt)) throw Object.assign(new Error('private message'),{code:'0A000'});
      if (sql.startsWith('SELECT current_database')) return {rows:[{db:'jobsearch_dev',role,ro:'on',tenant,...guard}]};
      if (sql.startsWith('EXPLAIN')) return {rows:[{'QUERY PLAN':[{Plan:{'Plan Rows':4,'Total Cost':5,Filter:tenant,'Relation Name':'private',Plans:[{'Plan Rows':2,Filter:'private'}]}}]}]};
      if (sql.startsWith('SELECT COUNT')) return {rows:[{count:3}]};
      return {rows:[]};
    },
    release(discard){releases.push(discard);}
  };
  return {input:{pool:{connect:async()=>client},authorizedTenant:tenant,expectedRole:role},calls,releases};
}
test('denies cross-environment, unknown operation and arbitrary SQL before connecting',async()=>{
  for (const request of [
    {environment:'prod',operation:'schema_probe'},
    {environment:'dev',operation:'sql'},
    {environment:'dev',operation:'schema_probe',sql:'SELECT 1'},
    {environment:'dev',operation:'schema_probe',tenant}
  ]) {
    const f=fixture();
    await assert.rejects(observeNile(f.input,request),/nile_request_denied/);
    assert.equal(f.calls.length,0);
  }
});
test('guards database, role, read-only and tenant before diagnostic',async()=>{
  for (const guard of [{db:'jobsearch_test'},{role:'admin'},{ro:'off'},{tenant:'other'}]) {
    const f=fixture({guard});
    const result=await observeNile(f.input,{environment:'dev',operation:'schema_probe'});
    assert.equal(result.status,'ERROR');
    assert.equal(result.stage,'guard');
    assert.equal(f.calls.some(c=>c.sql.startsWith('SELECT COUNT')),false);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  }
});
test('parameterizes tenant, strips raw plan fields and rolls back',async()=>{
  const f=fixture();
  const result=await observeNile(f.input,{environment:'dev',operation:'evaluation_count_plan'});
  assert.equal(result.status,'COLLECTED');
  assert.deepEqual(result.plan,{'Plan Rows':4,'Total Cost':5,children:[{'Plan Rows':2}]});
  assert.deepEqual(f.calls.find(c=>c.sql.startsWith('EXPLAIN')).args,[tenant]);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  assert.deepEqual(f.releases,[false]);
});
test('returns stage and SQLSTATE without raw provider error',async()=>{
  const f=fixture({failAt:'SET LOCAL nile'});
  const result=await observeNile(f.input,{environment:'dev',operation:'schema_probe'});
  assert.deepEqual(result,{status:'ERROR',stage:'tenant_set',sqlstate:'0A000'});
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
