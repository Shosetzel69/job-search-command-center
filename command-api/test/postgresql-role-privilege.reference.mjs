// #531 W02-5 PostgreSQL-only strict role contract preserved, not a Nile CI suite.
// CI_NOT_COVERED_PROVIDER_UNSUPPORTED: owner-approved exclusion. Never run against DEV.
import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {runtimePrivilegeReadiness} from '../src/db/privilege-readiness.js';
const target=String(process.env.JSCC_PG_ROLE_REFERENCE_DATABASE_URL||'');
if(process.env.CI==='true' || process.env.GITHUB_ACTIONS==='true' ||
   process.env.JSCC_PG_ROLE_REFERENCE_EXPLICIT!=='true' ||
   !target || !/^postgres(?:ql)?:\/\//.test(target) ||
   !['localhost','127.0.0.1'].includes(new URL(target).hostname) ||
   new URL(target).pathname!=='/jobsearch_role_reference')
 throw new Error('CI_NOT_COVERED_PROVIDER_UNSUPPORTED: isolated PG role test is not authorized here');
test('reference: PostgreSQL strict runtime privileges and DDL denials',async()=>{
 const runtimeDb=new pg.Pool({connectionString:target,max:1});
 try{
   const env={APP_ENV:'dev',NILE_DATABASE_URL:target};
   const privilege=await runtimePrivilegeReadiness(env,{db:runtimeDb});
   assert.equal(privilege.status,'ok');
   assert.equal(privilege.superuser,false);
   assert.equal(privilege.schema_create,false);
   assert.equal(privilege.database_create,false);
   assert.equal(privilege.residual_global_mode_cross_tenant,true);
   assert.equal(privilege.tenant_tables.every(item=>
      item.present && item.tenant_id_ready && !item.owned_by_runtime && !item.member_of_owner),true);
   await assert.rejects(
     runtimeDb.query('CREATE TABLE runtime_must_not_create(id integer)'),
     /permission denied/i);
   await assert.rejects(
     runtimeDb.query('ALTER TABLE profile ADD COLUMN runtime_must_not_add integer'),
     /must be owner|permission denied/i);
 }finally{await runtimeDb.end();}
});
