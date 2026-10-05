import test from 'node:test';
import assert from 'node:assert/strict';
import { readUiState, sanitizeUiState, UI_STATE_KEY, writeUiState } from '../src/ui-state.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem:key => values.get(key) ?? null,
    setItem:(key,value) => values.set(key,value),
    value:key => values.get(key),
  };
}

test('transient UI state stores only the allowlisted return context', () => {
  const store = memoryStorage();
  writeUiState({
    view:'review',
    filters:{search:'project',quick:'high',freshness:48,workModes:['Remote'],sort:'fit-asc'},
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
    filters:{search:'project',quick:'high',freshness:48,workModes:['Remote'],sort:'fit-asc'},
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
