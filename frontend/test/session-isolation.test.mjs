import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const sourceStart=main.indexOf('  const loadData=useCallback(');
const sourceEnd=main.indexOf('\n  const handleCredential=useCallback(',sourceStart);
assert.ok(sourceStart>0 && sourceEnd>sourceStart,'loadData function must exist');

function deferred(){
 let resolve,reject;
 const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
 return {promise,resolve,reject};
}

function harness(){
 const sessionGenerationRef={current:1}, filtersRef={current:{freshness:24,workModes:['Remote']}};
 const state={applications:[],criteria:null,filters:null,status:null,jobLoads:[]};
 const pending=new Map();
 const fetchJson=(path,token)=>{
   if(token==='A'){
     const d=deferred();
     pending.set(path,d);
     return d.promise;
   }
   if(token==='B'){
     if(path==='/applications')return Promise.resolve({applications:[{title:'B Application',company:'B Co'}]});
     if(path==='/me/preferences')return Promise.resolve({preferences:{owner:'B',freshness:48}});
   }
   throw Error('unexpected fetch: '+path+' '+token);
 };
 const bindings={
   sessionGenerationRef,filtersRef,fetchJson,
   useCallback:fn=>fn,
   setDataState:value=>{state.status=value;},
   validateContract:()=>{},
   criteriaFromConfig:payload=>({freshness:payload?.preferences?.freshness??24,owner:payload?.preferences?.owner}),
   ALL_WORK_MODES:['Remote','Hybrid','Onsite'],
   normalizeApplication:app=>app,
   normalizeSource:source=>source,
   setApplications:apps=>{state.applications=apps;},
   setSources:()=>{},setSourceCategories:()=>{},
   setRunStatus:()=>{},setRunHistory:()=>{},
   setCanonicalConfig:()=>{},
   setSavedCriteria:criteria=>{state.criteria=criteria;},
   setDraftCriteria:()=>{},
   setFilters:filters=>{state.filters=filters;filtersRef.current=filters;},
   loadJobsPage:async(token)=>{state.jobLoads.push(token);return {jobs:[]};},
 };
 const loadData=vm.runInNewContext(main.slice(sourceStart,sourceEnd)+'\nloadData;',bindings);
 return {loadData,state,pending,sessionGenerationRef};
}

test('H1: user A delayed applications/preferences after logout and B login never overwrite B',async()=>{
 const h=harness();
 const a=h.loadData('A','USER',1);
 assert.equal(h.state.status.status,'loading');
 h.sessionGenerationRef.current=2; // logout invalidates the old account before network reply
 h.state.applications=[];h.state.filters=null;h.state.criteria=null;
 h.sessionGenerationRef.current=3; // B authenticates
 await h.loadData('B','USER',3);
 assert.equal(h.state.applications[0].title,'B Application');
 assert.equal(h.state.criteria.owner,'B');
 assert.deepEqual(h.state.jobLoads,['B']);
 h.pending.get('/applications').resolve({applications:[{title:'SECRET A',company:'A Co'}]});
 h.pending.get('/me/preferences').resolve({preferences:{owner:'A',freshness:30}});
 assert.equal(await a,null);
 assert.equal(h.state.applications[0].title,'B Application');
 assert.equal(h.state.criteria.owner,'B');
 assert.deepEqual(h.state.jobLoads,['B']);
 assert.equal(h.state.status.status,'ready');
});

test('H1: stale account errors after logout do not overwrite the new session error/status',async()=>{
 const h=harness();
 const a=h.loadData('A','USER',1);
 h.sessionGenerationRef.current=2;
 await h.loadData('B','USER',2);
 h.pending.get('/applications').reject(Error('old account request failed'));
 assert.equal(await a,null);
 assert.equal(h.state.status.status,'ready');
 assert.equal(h.state.criteria.owner,'B');
});

test('H1: session epoch is checked at authentication, data and listing commit boundaries',()=>{
 const auth=main.slice(main.indexOf('const handleCredential=useCallback('),main.indexOf('const retryData=useCallback('));
 const clear=main.slice(main.indexOf('const clearData=useCallback('),main.indexOf('const loadJobsPage=useCallback('));
 const jobs=main.slice(main.indexOf('const loadJobsPage=useCallback('),main.indexOf('const loadData=useCallback('));
 assert.match(auth,/generation=\+\+sessionGenerationRef\.current/);
 assert.match(auth,/clearData\(\); \/\/ synchronous invalidation/);
 assert.match(auth,/if\(generation!==sessionGenerationRef\.current\)return/);
 assert.match(clear,/sessionGenerationRef\.current\+=1/);
 assert.match(jobs,/if\(generation!==sessionGenerationRef\.current\)return \{ignored:true\}/);
});
