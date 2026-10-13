import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortJobRows, compareAgeNullsLast, isNewWithin24Hours } from '../src/job-row-filters.mjs';

const undated={id:'unknown',fit:80,age:null,date_posted:null,title:'Unknown',company:'A',description:'',source:'',location:'',countries:[]};
const dated={id:'dated',fit:80,age:23,date_posted:'2026-10-12',title:'Dated',company:'B',description:'',source:'',location:'',countries:[]};
const older={id:'older',fit:80,age:30,date_posted:'2026-10-11',title:'Older',company:'C',description:'',source:'',location:'',countries:[]};
const ageHours=(_v,age)=>age;
const opts=(kpiFilter,sort='fit-desc')=>({view:'jobs',filters:{search:'',quick:'all',sort},threshold:80,kpiFilter,ageHours});

test('CR-1: actual KPI new filter excludes undated and older job',()=>{
  assert.equal(isNewWithin24Hours(undated,ageHours),false);
  assert.deepEqual(filterAndSortJobRows([undated,older,dated],opts('new')).map(x=>x.id),['dated']);
});
test('CR-2: both fit sort modes use nulls-last at equal FIT',()=>{
  assert.equal(compareAgeNullsLast(undated,dated),1);
  for (const sort of ['fit-desc','fit-asc'])
    assert.deepEqual(filterAndSortJobRows([undated,older,dated],opts('all',sort)).map(x=>x.id),['dated','older','unknown']);
});
test('CR-2: two undated rows sort stably',()=>{
  assert.deepEqual(filterAndSortJobRows([{...undated,id:'a'},{...undated,id:'b'}],opts('all')).map(x=>x.id),['a','b']);
});
