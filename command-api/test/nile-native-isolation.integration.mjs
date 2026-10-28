import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNileCi} from '../scripts/nile-ci-local-admission.mjs';
admitNileCi(); // Before importing the database driver or any pool
const {default:pg}=await import('pg');
const url=process.env.NILE_TEST_DATABASE_URL;
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id='w025_native_probe';
const refusal=e=>e?.code==='0A000' && /^Multiple tenant IDs specified/.test(String(e.message||''));
test('W025 T01–T05 official native Nile tenant isolation', async()=>{
 const c=new pg.Client({connectionString:url,connectionTimeoutMillis:10000});
 await c.connect();
 const readback=async()=>await c.query('SELECT tenant_id::text AS tenant,id,note FROM '+id+' ORDER BY tenant_id,id');
 const context=async()=>{const r=await c.query("SELECT current_setting('nile.tenant_id',true) AS t");assert.ok(!r.rows[0].t);};
 const inTenant=async(own,fn)=>{await c.query('BEGIN');try{await c.query("SET LOCAL nile.tenant_id = '"+own+"'");return await fn();}finally{await c.query('ROLLBACK');}};
 try{
  await c.query('CREATE TABLE '+id+'(tenant_id uuid NOT NULL,id integer NOT NULL,note text NOT NULL,PRIMARY KEY(tenant_id,id))');
  await c.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[A,'w025-native-A']);
  await c.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[B,'w025-native-B']);
  await c.query('INSERT INTO '+id+'(tenant_id,id,note) VALUES($1,1,$2)',[A,'A']);
  await c.query('INSERT INTO '+id+'(tenant_id,id,note) VALUES($1,1,$2)',[B,'B']);
  const cases=[[A,B,'A'],[B,A,'B']];
  for(const [own,other,note] of cases){
   await inTenant(own,async()=>{
    const visible=await c.query('SELECT tenant_id::text AS tenant,note FROM '+id);
    assert.deepEqual(visible.rows,[{tenant:own,note}]);
    assert.equal((await c.query('SELECT id FROM '+id+' WHERE tenant_id=$1',[other])).rowCount,0);
    assert.equal((await c.query('INSERT INTO '+id+'(tenant_id,id,note) VALUES($1,21,$2)',[own,'temp'])).rowCount,1);
    assert.equal((await c.query('UPDATE '+id+' SET note=$1 WHERE tenant_id=$2 AND id=21',['updated',own])).rowCount,1);
    assert.equal((await c.query('DELETE FROM '+id+' WHERE tenant_id=$1 AND id=21',[own])).rowCount,1);
   });
   await context();
   for(const [kind,sql,params] of [
    ['INSERT','INSERT INTO '+id+'(tenant_id,id,note) VALUES($1,22,$2)',[other,'unsafe']],
    ['UPDATE','UPDATE '+id+' SET note=$1 WHERE tenant_id=$2',['unsafe',other]],
    ['DELETE','DELETE FROM '+id+' WHERE tenant_id=$1',[other]],
   ]){
    await inTenant(own,async()=>{
     try{
      const res=await c.query(sql,params);
      if(kind==='INSERT')assert.fail('cross-tenant insert accepted');
      assert.equal(res.rowCount,0,'cross-tenant '+kind+' changed row');
     }catch(e){if(!refusal(e))throw e;}
    });
    await context();
   }
   assert.deepEqual((await readback()).rows,[{tenant:A,id:1,note:'A'},{tenant:B,id:1,note:'B'}]);
  }
  console.log('W025_NATIVE_TENANTS_PASS=5');
 }finally{await c.end();}
});
