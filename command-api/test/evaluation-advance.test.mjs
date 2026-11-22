import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationPreferenceDigest, INPUT_DIGEST_SQL, EVALUATION_SOURCE_SQL, EVALUATION_BATCH_SOURCE_SQL, PREFERRED_POSTING_ORDER_SQL, PREFERRED_POSTING_FULL_JOIN_SQL, PREFERRED_POSTING_BATCH_JOIN_SQL } from '../src/evaluation-basis.js';
import { ADVANCE_BATCH_MAX, ADVANCE_BUDGET_MS, evaluationAdvanceProgress, encodeEvaluationScanCursor, decodeEvaluationScanCursor, readEvaluationBasisTx, evaluationProjection, persistIncrementalEvaluationTx } from '../src/evaluation-advance.js';

test('only evaluation-relevant preferences and nomenclature affect the digest',()=>{
  const p={fit_config:{work_mode:{weight:50}},target_regions:['EU'],fit_threshold:80,freshness_hours:24};
  const n={version:1,domains:{countries:[]}};
  const d=evaluationPreferenceDigest(p,n);
  assert.equal(d,evaluationPreferenceDigest({...p,fit_threshold:90,freshness_hours:48},n));
  assert.equal(d,evaluationPreferenceDigest({target_regions:['EU'],fit_config:p.fit_config},n));
  assert.notEqual(d,evaluationPreferenceDigest({...p,fit_config:{work_mode:{weight:40}}},n));
  assert.notEqual(d,evaluationPreferenceDigest(p,{...n,version:2}));
  assert.notEqual(d,evaluationPreferenceDigest({...p,target_regions:['EMEA']},n));
});
test('SQL basis covers the chosen posting, both payloads, classification and preference digest',()=>{
  for(const field of ['sp.posting_id','j.payload','sp.payload','j.job_version','j.role_subfamily','$4::text','publication.effective_posted_at'])
    assert.ok(INPUT_DIGEST_SQL.includes(field),field);
  assert.match(EVALUATION_SOURCE_SQL,/posting_id ASC/);
  assert.match(EVALUATION_SOURCE_SQL,/SELECT DISTINCT ON \(job_id\)/);
  assert.match(EVALUATION_SOURCE_SQL,/sp\.job_id = j\.job_id/);
  assert.match(EVALUATION_SOURCE_SQL,/ORDER BY job_id,[\s\S]*last_seen_at DESC, posting_id ASC/);
  assert.doesNotMatch(EVALUATION_SOURCE_SQL,/JOIN LATERAL \(\s*SELECT posting_id/);
  assert.match(EVALUATION_BATCH_SOURCE_SQL,/JOIN LATERAL \(\s*SELECT posting_id/);
  assert.match(EVALUATION_BATCH_SOURCE_SQL,/WHERE job_id = j\.job_id/);
  assert.match(EVALUATION_BATCH_SOURCE_SQL,/LIMIT 1/);
  assert.doesNotMatch(EVALUATION_BATCH_SOURCE_SQL,/SELECT DISTINCT ON/);
  assert.ok(EVALUATION_SOURCE_SQL.includes(PREFERRED_POSTING_FULL_JOIN_SQL));
  assert.ok(EVALUATION_BATCH_SOURCE_SQL.includes(PREFERRED_POSTING_BATCH_JOIN_SQL));
  assert.ok(PREFERRED_POSTING_FULL_JOIN_SQL.includes(PREFERRED_POSTING_ORDER_SQL));
  assert.ok(PREFERRED_POSTING_BATCH_JOIN_SQL.includes(PREFERRED_POSTING_ORDER_SQL));
  // Replacing only the access path must preserve date parsing and input-digest semantics.
  assert.equal(EVALUATION_SOURCE_SQL.replace(PREFERRED_POSTING_FULL_JOIN_SQL,'__PREFERRED__'),
    EVALUATION_BATCH_SOURCE_SQL.replace(PREFERRED_POSTING_BATCH_JOIN_SQL,'__PREFERRED__'));
  assert.equal(ADVANCE_BATCH_MAX,100);
  assert.equal(ADVANCE_BUDGET_MS,8000);
});
test('basis captured by one SQL read',async()=>{
  const calls=[];
  const tx={tenantId:'tenant',query:async(sql,args)=>{
    calls.push({sql,args});
    return {rows:[{search_profile_id:'profile',profile_version:4,preferences:{fit_threshold:81},policy:{collection_freshness_hours:72}}]};
  }};
  const basis=await readEvaluationBasisTx(tx,{version:1});
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/search_profile_preferences/);
  assert.match(calls[0].sql,/collection_policy/);
  assert.equal(basis.profile_version,4);
  assert.equal(basis.preferences.fit_threshold,81);
});
test('projection keeps FIT matrix and source dates together with the score and normalized mode',()=>{
  const evaluation={job:{fit_matrix:[{points:25}],title:'ＰＭ',country_codes:['RO'],mode:'Remote',
    contract_type:'contract',b2b:true,publication_date:'2026-11-15',publication_precision:'date',
    retrieve_date:'2026-11-16T08:00:00.000Z',remote:true}};
  const projection=evaluationProjection({input_digest:'digest'},evaluation);
  assert.equal(projection.sort_title,'pm');
  assert.equal(projection.display_country,'RO');
  assert.equal(projection.display_work_mode,'remote');
  assert.equal(projection.publication_at,'2026-11-15');
  assert.deepEqual(projection.fit_matrix,[{points:25}]);
});
test('rejected UPSERT is not an HTTP error; digest and matrix are part of one guarded write',async()=>{
  const calls=[];
  const tx={tenantId:'tenant',query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
  const basis={search_profile_id:'profile',profile_version:4};
  const row={job_id:'job',job_version:2,input_digest:'digest'};
  const evaluation={eligibilityState:'UNKNOWN',eligible:false,score:25,
    job:{fit_matrix:[{points:25}],title:'PM',country_codes:[],mode:'N/A',contract_type:'unknown'}};
  assert.equal(await persistIncrementalEvaluationTx(tx,basis,row,evaluation,new Date()),false);
  assert.match(calls[0].sql,/EXCLUDED.profile_version>=cur.profile_version/);
  assert.match(calls[0].sql,/EXCLUDED.job_version>=cur.job_version/);
  assert.match(calls[0].sql,/ELSE 0 END/);
  assert.equal(calls[0].args[14],'digest');
  assert.equal(calls[0].args[15],JSON.stringify([{points:25}]));
});

import { COLUMNS, INDEXES, assertEvaluation013Ledger } from '../scripts/db-evaluation-migrate-013.mjs';
test('013 exact ledger rejects missing or incorrect indexes and untracked objects',()=>{
  const files=Array.from({length:13},(_,i)=>({version:String(i+1).padStart(3,'0'),name:i===12?'013_profile_job_evaluation_listing.sql':String(i+1),checksum:i===10?'c6cb6ac52c9a717a5dc452b38fb0874be51896190dc24beab01babfafe623f0e':'x'}));
  const cols=Object.entries(COLUMNS).map(([column_name,data_type])=>({column_name,data_type,is_nullable:'YES'}));
  const indexes=Object.entries(INDEXES).map(([indexname,col])=>({indexname,indisvalid:true,indisready:true,indexdef:`CREATE INDEX ${indexname} ON public.profile_job_evaluation USING btree (tenant_id, search_profile_id, ${col}, job_id)`}));
  assert.equal(assertEvaluation013Ledger(files,files.slice(0,12),[],[]),'PENDING_013');
  assert.equal(assertEvaluation013Ledger(files,files,cols,indexes),'ALREADY_APPLIED');
  // Nile catalogs can expose the physical database-qualified public schema.
  const physical=indexes.map(i=>({...i,indexdef:i.indexdef.replace('public.','"01000000-0000-7000-8000-000000000000_public".')}));
  assert.equal(assertEvaluation013Ledger(files,files,cols,physical),'ALREADY_APPLIED');
  // Official native Nile image: exact physical deparser, from job 133681429203.
  const internal=indexes.map(i=>({...i,indexdef:i.indexdef.replace(
    'ON public.profile_job_evaluation',
    'ON ONLY "01000000-0000-7000-8000-000000000000_public_nile_internal".profile_job_evaluation_pdb_1'
  )}));
  assert.equal(assertEvaluation013Ledger(files,files,cols,internal),'ALREADY_APPLIED');
  for(const incorrect of [
    'ON ONLY "01000000-0000-7000-8000-000000000000_public_nile_internal".wrong_table_pdb_1',
    'ON ONLY "01000000-0000-7000-8000-000000000000_other_nile_internal".profile_job_evaluation_pdb_1',
    'ON ONLY public.profile_job_evaluation',
    'ON ONLY "01000000-0000-7000-8000-000000000000_public_nile_internal".profile_job_evaluation_pdb_0',
  ]) {
    const bad=internal.map((i,n)=>n?i:{...i,indexdef:i.indexdef.replace(
      'ON ONLY "01000000-0000-7000-8000-000000000000_public_nile_internal".profile_job_evaluation_pdb_1',incorrect)});
    assert.throws(()=>assertEvaluation013Ledger(files,files,cols,bad),/EVALUATION013_INDEX_DRIFT/);
  }
  assert.throws(()=>assertEvaluation013Ledger(files,files,cols,indexes.map((v,i)=>i?v:{...v,indexdef:v.indexdef.replace('public.','other_schema.')})),/EVALUATION013_INDEX_DRIFT/);
  assert.throws(()=>assertEvaluation013Ledger(files,files,cols,indexes.slice(0,-1)),/EVALUATION013_INDEX_DRIFT/);
  assert.throws(()=>assertEvaluation013Ledger(files,files,cols,[...indexes.slice(0,-1),indexes[0]]),/EVALUATION013_INDEX_DRIFT/);
  for(const flag of ['indisvalid','indisready']) {
    assert.throws(()=>assertEvaluation013Ledger(files,files,cols,indexes.map((x,i)=>i?x:{...x,[flag]:false})),/EVALUATION013_INDEX_DRIFT/);
    assert.throws(()=>assertEvaluation013Ledger(files,files.slice(0,12),[],[{...indexes[0],[flag]:false}]),/EVALUATION013_UNTRACKED_OBJECTS/);
  }
  assert.throws(()=>assertEvaluation013Ledger(files,files,cols,indexes.map((x,i)=>i?x:{...x,indexdef:x.indexdef.replace('score','b2b')})),/EVALUATION013_INDEX_DRIFT/);
  assert.throws(()=>assertEvaluation013Ledger(files,files.slice(0,12),[],indexes),/EVALUATION013_UNTRACKED_OBJECTS/);
});

test('P0 bounded lookahead commits progress without a post-write full-corpus count',()=>{
  assert.deepEqual(evaluationAdvanceProgress(0,0),{status:'COMPLETE',pending:0});
  assert.deepEqual(evaluationAdvanceProgress(1,1),{status:'COMPLETE',pending:0});
  assert.deepEqual(evaluationAdvanceProgress(99,99),{status:'COMPLETE',pending:0});
  assert.deepEqual(evaluationAdvanceProgress(100,100),{status:'COMPLETE',pending:0});
  assert.deepEqual(evaluationAdvanceProgress(101,100),{status:'INCOMPLETE',pending:null});
  assert.deepEqual(evaluationAdvanceProgress(101,70),{status:'INCOMPLETE',pending:null});
  assert.deepEqual(evaluationAdvanceProgress(2,1),{status:'INCOMPLETE',pending:1});
  assert.deepEqual(evaluationAdvanceProgress(100,99),{status:'INCOMPLETE',pending:1});
  for(const input of [[102,100],[1,2],[100,-1],[-1,0],[1.5,1]])
    assert.throws(()=>evaluationAdvanceProgress(...input),/Invalid evaluation advance progress/);
});

test('bounded corpus cursor is tenant/profile/version/digest bound and tamper-safe',()=>{
  const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const position='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const basis={search_profile_id:other,profile_version:21,preference_digest:'d'.repeat(64)};
  const raw=encodeEvaluationScanCursor(tenant,basis,position);
  assert.deepEqual(decodeEvaluationScanCursor(null,tenant,basis),{phase:'scan',position:null});
  assert.deepEqual(decodeEvaluationScanCursor(raw,tenant,basis),{phase:'scan',position});
  assert.deepEqual(decodeEvaluationScanCursor(raw,other,basis),{phase:'invalidated',position:null});
  assert.deepEqual(decodeEvaluationScanCursor(raw,tenant,{...basis,profile_version:22}),{phase:'invalidated',position:null});
  assert.deepEqual(decodeEvaluationScanCursor(raw,tenant,{...basis,preference_digest:'e'.repeat(64)}),{phase:'invalidated',position:null});
  const verify=encodeEvaluationScanCursor(tenant,basis,null,'verify');
  assert.deepEqual(decodeEvaluationScanCursor(verify,tenant,basis),{phase:'verify',position:null});
  assert.throws(()=>decodeEvaluationScanCursor('INVALID!',tenant,basis),/Invalid evaluation scan cursor/);
  assert.throws(()=>encodeEvaluationScanCursor(tenant,basis,null),/Invalid evaluation scan cursor/);
});
