import test from 'node:test';
import assert from 'node:assert/strict';
import {FIT_CRITERIA,normalizeFitConfig,evaluateFitV2} from '../../shared/fit-v2.mjs';
const config=()=>Object.fromEntries(FIT_CRITERIA.map(k=>[k,{weight:0}]));
const example=()=>({...config(),compensation:{weight:20},work_mode:{weight:50,ratings:{remote:5,hybrid:2}},industry:{weight:30,ratings:{banking:4}}});
test('unconfigured and invalid profiles have no score',()=>{for(const c of [null,{},config()])assert.equal(evaluateFitV2(c).score,null);});
test('weighted sum retains denominator for missing data',()=>{const r=evaluateFitV2(example(),{work_mode:'remote'});assert.equal(r.score,50);assert.equal(r.matrix.find(x=>x.criterion==='industry').reason,'MISSING_DATA');assert.equal(r.matrix.length,6);});
test('compensation binary regardless of amount, currency or period',()=>{for(const c of [1,500,{minimum:150,currency:'PLN'},{maximum:100000,currency:'USD'}])assert.equal(evaluateFitV2(example(),{compensation:c}).score,20);for(const c of [null,undefined,{},NaN,-1])assert.equal(evaluateFitV2(example(),{compensation:c}).score,0);});
test('exact explicit preference ratings and no match',()=>{const r=evaluateFitV2(example(),{compensation:500,work_mode:' HYBRID ',industry:'banking'});assert.equal(r.score,64);assert.equal(evaluateFitV2(example(),{industry:'banking adjacent'}).matrix.find(x=>x.criterion==='industry').reason,'NO_MATCH');});
test('invalid total, grade and duplicate normalized label rejected',()=>{for(const c of [{...example(),compensation:{weight:21}},{...example(),work_mode:{weight:50,ratings:{remote:6}}},{...example(),work_mode:{weight:50,ratings:{remote:5,REMOTE:4}}}])assert.throws(()=>normalizeFitConfig(c),{status:400});});
test('zero weights have no effect and no implicit preferences',()=>{const c={...config(),compensation:{weight:100}};assert.equal(evaluateFitV2(c,{work_mode:'remote'}).score,0);assert.equal(evaluateFitV2(c,{compensation:100}).score,100);});
test('profiles independently evaluate same evidence without mutation',()=>{const a=example(),b={...a,work_mode:{weight:50,ratings:{remote:1}}},e=Object.freeze({work_mode:'remote'});assert.equal(evaluateFitV2(a,e).score,50);assert.equal(evaluateFitV2(b,e).score,10);assert.equal(a.work_mode.ratings.remote,5);});

import { normalizedContractType, classifyCanonicalJob } from '../../shared/job-classification.mjs';
test('D-660-02 workload tags do not turn unknown into permanent',()=>{
  for(const tag of ['full time','full-time','FULL_TIME','part time']) {
    const payload={employment_statuses:['project management',tag,'agile'],contract_type:'unknown'};
    assert.equal(normalizedContractType(payload),'unknown');
    assert.equal(normalizedContractType({employment_statuses:payload.employment_statuses}),'unknown');
    assert.equal(classifyCanonicalJob({title:'Project Manager',payload}).contract_type,'unknown');
  }
  assert.equal(normalizedContractType({employment_statuses:['full time','permanent']}),'permanent');
  assert.equal(normalizedContractType({employment_statuses:['full time','B2B']}),'contract');
});
