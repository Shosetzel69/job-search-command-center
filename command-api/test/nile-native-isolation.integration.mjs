import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNileCi,attestNativeDatabase} from '../scripts/nile-ci-local-admission.mjs';
admitNileCi();
const {default:pg}=await import('pg');
const url=process.env.NILE_TEST_DATABASE_URL;
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const table='w025_native_probe';
const refusal=e=>e?.code==='0A000' && /^Multiple tenant IDs specified/.test(String(e.message||''));
test('W025 Nile tenant-native T01-T05',async t=>{
 const c=new pg.Client({connectionString:url,connectionTimeoutMillis:10000});
 await c.connect();
 await attestNativeDatabase(c);
 const context=async()=>{
  const r=await c.query("SELECT current_setting('nile.tenant_id',true) AS t");
  assert.ok(!r.rows[0].t,'tenant context leaked beyond transaction');
 };
 const scoped=async(tenant,fn,commit=false)=>{
  await c.query('BEGIN');
  try{
   await c.query("SET LOCAL nile.tenant_id = '"+tenant+"'");
   const result=await fn();
   await c.query(commit?'COMMIT':'ROLLBACK');
   return result;
  }catch(error){
   await c.query('ROLLBACK').catch(()=>{});
   throw error;
  }
 };
 const current=async()=> (await c.query('SELECT tenant_id::text AS tenant,id,note FROM '+table+' ORDER BY tenant_id,id')).rows;
 try{
  await c.query('CREATE TABLE '+table+'(tenant_id uuid NOT NULL,id integer NOT NULL,note text NOT NULL,PRIMARY KEY(tenant_id,id))');
  for(const [id,label] of [[A,'A'],[B,'B']]){
   await c.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[id,'w025-native-'+label]);
   await c.query('INSERT INTO '+table+'(tenant_id,id,note) VALUES($1,1,$2)',[id,label]);
  }
  const baseline=[{tenant:A,id:1,note:'A'},{tenant:B,id:1,note:'B'}];
  await t.test('W025-T01 own row read/write and other tenant invisibility',async()=>{
   for(const [tenant,other,label] of [[A,B,'A'],[B,A,'B']]){
    await scoped(tenant,async()=>{
     const r=await c.query('SELECT tenant_id::text AS tenant,note FROM '+table);
     assert.deepEqual(r.rows,[{tenant,note:label}]);
     assert.equal((await c.query('SELECT id FROM '+table+' WHERE tenant_id=$1',[other])).rowCount,0);
     assert.equal((await c.query('INSERT INTO '+table+'(tenant_id,id,note) VALUES($1,21,$2)',[tenant,'tmp'])).rowCount,1);
     assert.equal((await c.query('UPDATE '+table+' SET note=$1 WHERE tenant_id=$2 AND id=21',['updated',tenant])).rowCount,1);
     assert.equal((await c.query('DELETE FROM '+table+' WHERE tenant_id=$1 AND id=21',[tenant])).rowCount,1);
    });
    await context();
   }
   assert.deepEqual(await current(),baseline);
  });
  for(const [code,kind,query,params] of [
   ['T02','INSERT','INSERT INTO '+table+'(tenant_id,id,note) VALUES($1,22,$2)',other=>[other,'unsafe']],
   ['T03','UPDATE','UPDATE '+table+' SET note=$1 WHERE tenant_id=$2',['unsafe',null]],
   ['T04','DELETE','DELETE FROM '+table+' WHERE tenant_id=$1',[null]],
  ]){
   await t.test('W025-'+code+' cross-tenant '+kind+' denied and other row preserved',async()=>{
    for(const [tenant,other] of [[A,B],[B,A]]){
     await scoped(tenant,async()=>{
      const values=typeof params==='function'?params(other):params.map(v=>v===null?other:v);
      try{
       const r=await c.query(query,values);
       if(kind==='INSERT')assert.fail('cross-tenant INSERT accepted');
       assert.equal(r.rowCount,0,'other tenant '+kind+' affected rows');
      }catch(e){
       if(!refusal(e))throw e;
      }
     });
     await context();
     assert.deepEqual(await current(),baseline);
    }
   });
  }
  await t.test('W025-T05 commit + rollback clear context, rollback residue zero',async()=>{
   for(const tenant of [A,B]){
    await scoped(tenant,async()=>{
     assert.equal((await c.query('INSERT INTO '+table+'(tenant_id,id,note) VALUES($1,31,$2)',[tenant,'rolled-back'])).rowCount,1);
    });
    await context();
    assert.equal((await c.query('SELECT id FROM '+table+' WHERE tenant_id=$1 AND id=31',[tenant])).rowCount,0,'rollback residue');
    await scoped(tenant,async()=>{
     assert.equal((await c.query('INSERT INTO '+table+'(tenant_id,id,note) VALUES($1,32,$2)',[tenant,'committed'])).rowCount,1);
    },true);
    await context();
    assert.equal((await c.query('SELECT id FROM '+table+' WHERE tenant_id=$1 AND id=32',[tenant])).rowCount,1,'commit missing');
    await scoped(tenant,async()=>{
     assert.equal((await c.query('DELETE FROM '+table+' WHERE tenant_id=$1 AND id=32',[tenant])).rowCount,1);
    },true);
    await context();
   }
   assert.deepEqual(await current(),baseline);
  });
 }finally{await c.end();}
});
