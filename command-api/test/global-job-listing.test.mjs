import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlobalListingQuery,normalizeGlobalQuery,decodeGlobalCursor,encodeGlobalCursor} from '../src/global-job-listing.js';
const id='00000000-0000-4000-8000-000000000001',digest='a'.repeat(64);
const basis={search_profile_id:id,profile_version:1,preference_digest:digest,personal:{},policy:{},preferences:{fit_threshold:80}};
const anchor=new Date('2026-11-16T00:00:00Z');
const cursor=(overrides={})=>({v:3,sort:'fit',dir:'desc',value:'82.5',null_flag:false,job_id:id,filter_hash:digest,profile_eval_digest:digest,watermark:digest,order_status:'GLOBAL',as_of:anchor.toISOString(),...overrides});

test('global cursor roundtrip, malformed values and scope validation',()=>{
 assert.deepEqual(decodeGlobalCursor(encodeGlobalCursor(cursor())),cursor());
 assert.throws(()=>decodeGlobalCursor(encodeGlobalCursor(cursor({value:'bad'}))),/STALE_CURSOR/);
 assert.throws(()=>decodeGlobalCursor(encodeGlobalCursor(cursor({null_flag:true}))),/STALE_CURSOR/);
 assert.deepEqual(decodeGlobalCursor(encodeGlobalCursor(cursor({value:null,null_flag:true}))),cursor({value:null,null_flag:true}));
 assert.throws(()=>normalizeGlobalQuery({sort:'bad'}),/Invalid global sort/);
});
test('all twelve orders use one statement with stable null-last ordering and exact counts',()=>{
 for(const sort of ['title','country','fit','work_mode','publication','retrieve']){
  for(const dir of ['asc','desc']){
   const spec=normalizeGlobalQuery({sort,dir,limit:20,result_view:'jobs'});
   const {sql,params}=buildGlobalListingQuery(id,basis,spec,anchor);
   assert.match(sql,/WITH tenant_evaluation AS MATERIALIZED \(\s*SELECT \* FROM profile_job_evaluation WHERE tenant_id=\$1 AND search_profile_id=\$3\s*\), basis_guard AS/);
   assert.match(sql,/LEFT JOIN tenant_evaluation eval ON eval\.job_id=j\.job_id/);
   assert.match(sql,/population AS/);
   assert.match(sql,/matched AS/);
   assert.match(sql,/totals AS/);
   assert.match(sql,/FROM matched/);
   assert.ok(sql.includes(dir.toUpperCase()+' NULLS LAST'));
   assert.match(sql,/job_id ASC/);
   assert.equal(params.at(-1),21);
   assert.ok(!sql.includes('OFFSET'));
  }
 }
});
test('OR within dimensions and AND across dimensions; scope canonicalization',()=>{
 const spec=normalizeGlobalQuery({sort:'fit',limit:30,role_subfamily:['B','A'],work_mode:['remote','hybrid'],contract_type:['contract'],min_fit:60,result_view:'review',freshness_hours:48});
 const alt=normalizeGlobalQuery({sort:'fit',limit:30,role_subfamily:['A','B'],work_mode:['hybrid','remote'],contract_type:['contract'],min_fit:60,result_view:'review',freshness_hours:48});
 assert.equal(spec.filter_hash,alt.filter_hash);
 const {sql,params}=buildGlobalListingQuery(id,basis,spec,anchor);
 assert.match(sql,/role_subfamily &&/);
 assert.match(sql,/COALESCE\(display_work_mode,'unknown'\)=ANY/);
 assert.match(sql,/score IS NULL OR score </);
 assert.ok(params.includes(60));
 assert.equal(params.at(-1),31);
});
test('typed keysets do not cast a FIT score as a provisional timestamp',()=>{
 const spec=normalizeGlobalQuery({sort:'fit',dir:'desc',limit:20,cursor:encodeGlobalCursor(cursor())});
 const {params}=buildGlobalListingQuery(id,basis,spec,anchor);
 const idx=params.indexOf('82.5');
 assert.ok(idx>=0);
 assert.equal(params[idx+1],null);
});

test('P4 explicit none selection has a distinct cursor scope and short-circuits matches',()=>{
 const all=normalizeGlobalQuery({sort:'publication',limit:20,result_view:'jobs'});
 const none=normalizeGlobalQuery({sort:'publication',limit:20,result_view:'jobs',empty_role_subfamilies:'true',empty_contract_types:'true'});
 assert.notEqual(all.filter_hash,none.filter_hash);
 assert.equal(none.empty_role_subfamilies,true);
 assert.equal(none.empty_contract_types,true);
 const allSql=buildGlobalListingQuery(id,basis,all,anchor).sql;
 const noneSql=buildGlobalListingQuery(id,basis,none,anchor).sql;
 assert.doesNotMatch(allSql,/WHERE false AND/);
 assert.match(noneSql,/AND false/);
});
