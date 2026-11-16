import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationPreferenceDigest, INPUT_DIGEST_SQL, EVALUATION_SOURCE_SQL } from '../src/evaluation-basis.js';
import { ADVANCE_BATCH_MAX, ADVANCE_BUDGET_MS, readEvaluationBasisTx, evaluationProjection, persistIncrementalEvaluationTx } from '../src/evaluation-advance.js';

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
