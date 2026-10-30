import test from 'node:test';
import assert from 'node:assert/strict';
import { jobQualityWarnings } from '../src/job-quality.mjs';

test('explicit quality warnings show friendly reasons and are deduplicated',()=>{
  assert.deepEqual(jobQualityWarnings({data_quality_issues:['INVALID_LOCATION','INVALID_LOCATION','SUSPECT_APPLY_URL']}),['Locație incorectă','URL de aplicare suspect']);
});
test('malformed location HTML, URL, or excessively long payload is marked',()=>{
  assert.deepEqual(jobQualityWarnings({location:'<div>Cookie preference</div>'}),['Locație incorectă']);
  assert.deepEqual(jobQualityWarnings({location:'https://example.com/privacy'}),['Locație incorectă']);
  assert.deepEqual(jobQualityWarnings({location:'a'.repeat(241)}),['Locație incorectă']);
});
test('valid location, missing publication date, sparse description and low FIT are not automatically flagged',()=>{
  assert.deepEqual(jobQualityWarnings({location:'Montreal, Canada',fit:45,description:'',date_posted:null}),[]);
});
test('object-based explicit reasons survive with accessible display message',()=>{
  assert.deepEqual(jobQualityWarnings({data_quality_issues:[{code:'NON_JOB_PAGE'},{reason:'Locația nu corespunde sursei'}]}),
    ['Pagina sursă nu este un anunț de angajare','Locația nu corespunde sursei']);
});
test('unvalidated generic risk text is not misinterpreted as data-quality evidence',()=>{
  assert.deepEqual(jobQualityWarnings({risks:['Low score','Industry mismatch']}),[]);
});

test('QF-01 navigation prose and embedded URLs are detected but city names remain valid',()=>{
  assert.deepEqual(jobQualityWarnings({location:'17:55 For freelancers Find projects Benefits for freelancers Prices and features'}),['Locație suspectă']);
  assert.deepEqual(jobQualityWarnings({location:'Berlin https://example.com/privacy center'}),['Locație incorectă']);
  assert.deepEqual(jobQualityWarnings({location:'London, United Kingdom'}),[]);
});
test('QF-04 inherited Object.prototype keys are literal string reasons',()=>{
  assert.deepEqual(jobQualityWarnings({data_quality_issues:['toString','constructor']}),['toString','constructor']);
});
