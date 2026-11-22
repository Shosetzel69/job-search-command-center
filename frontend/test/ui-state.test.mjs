import test from 'node:test';
import assert from 'node:assert/strict';
import { clearUiState, readUiState, sanitizeUiState, UI_STATE_KEY, writeUiState } from '../src/ui-state.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem:key => values.get(key) ?? null,
    setItem:(key,value) => values.set(key,value),
    removeItem:key => values.delete(key),
    value:key => values.get(key),
  };
}

test('transient UI state stores only the allowlisted return context', () => {
  const store = memoryStorage();
  writeUiState({
    view:'review',
    filters:{search:'project',quick:'high',freshness:48,workModes:['Remote'],roleSubfamilies:['project_management'],contractTypes:['contract'],roleSubfamiliesNone:false,contractTypesNone:true,minFit:'65',sort:'fit-asc'},
    selectedJobId:'job-1',
    scrollY:321,
    credential:'not-persisted',
    applications:[{id:'not-persisted'}],
  }, store);

  const raw = store.value(UI_STATE_KEY);
  assert.doesNotMatch(raw, /credential|applications|not-persisted/);
  assert.deepEqual(readUiState(store), {
    schema_version:1,
    view:'review',
    filters:{search:'project',quick:'all',freshness:48,workModes:['Remote'],roleSubfamilies:['project_management'],contractTypes:['contract'],roleSubfamiliesNone:false,contractTypesNone:true,minFit:'65',sort:'fit-asc'},
    selectedJobId:'job-1',
    scrollY:321,
  });
});

test('invalid transient state fails closed to safe defaults', () => {
  const clean = sanitizeUiState({ view:'unknown', filters:{quick:'bad',workModes:['Remote','Satellite']}, scrollY:-4 });
  assert.equal(clean.view,'jobs');
  assert.equal(clean.filters.quick,'all');
  assert.deepEqual(clean.filters.workModes,['Remote']);
  assert.equal(clean.scrollY,0);
});

test('P4 all/none selection survives navigation and hidden quick chip is reset',()=>{
 const clean=sanitizeUiState({filters:{quick:'b2b',roleSubfamiliesNone:true,contractTypesNone:true}});
 assert.equal(clean.filters.quick,'all');
 assert.equal(clean.filters.roleSubfamiliesNone,true);
 assert.equal(clean.filters.contractTypesNone,true);
 assert.deepEqual(clean.filters.roleSubfamilies,[]);
});

test('P4 logout clears only per-tab personal UI context before a different account signs in',()=>{
 const store=memoryStorage();
 store.setItem('unrelated-setting','safe');
 writeUiState({view:'review',filters:{roleSubfamilies:['project_management'],contractTypesNone:true,minFit:'65'},selectedJobId:'job-account-a',scrollY:100},store);
 assert.equal(readUiState(store).filters.contractTypesNone,true);
 assert.equal(clearUiState(store),true);
 assert.equal(store.value(UI_STATE_KEY),undefined);
 assert.equal(store.value('unrelated-setting'),'safe');
 const next=readUiState(store);
 assert.equal(next.view,'jobs');
 assert.equal(next.filters.contractTypesNone,false);
 assert.deepEqual(next.filters.roleSubfamilies,[]);
 assert.equal(next.filters.minFit,'');
 assert.equal(next.selectedJobId,null);
 assert.equal(next.scrollY,0);
});

test('P4 clearUiState gracefully handles denied or missing session storage',()=>{
 assert.equal(clearUiState(null),false);
 assert.equal(clearUiState({removeItem(){throw Error('denied');}}),false);
});

test('P4 M2: browser sessionStorage getter throws, mount/read/write/logout fail closed',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 try {
   Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Object.assign(Error('denied'),{name:'SecurityError'});}});
   assert.equal(readUiState().view,'jobs');
   assert.equal(writeUiState({view:'review'}),false);
   assert.equal(clearUiState(),false);
 } finally {
   if(original)Object.defineProperty(globalThis,'sessionStorage',original);
   else delete globalThis.sessionStorage;
 }
});
