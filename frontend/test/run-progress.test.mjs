import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgressModel } from '../src/run-progress.mjs';

test('uses explicit live progress counters', () => {
  assert.deepEqual(runProgressModel({
    status:'in_progress',
    progress:{sources_total:20,sources_processed:7,sources_good:5,sources_failed:1,sources_skipped:1,sources_partial:2,percent:35},
  }), {
    total:20,processed:7,good:5,failed:1,skipped:1,partial:2,percent:35,
    active:true,terminal:false,jobsPublished:0,
  });
});

test('derives progress for legacy terminal payloads', () => {
  const model=runProgressModel({status:'completed_with_errors',sources_active:10,sources_processed:10,sources_succeeded:8,sources_failed:2,jobs_published:77});
  assert.equal(model.total,10);
  assert.equal(model.processed,10);
  assert.equal(model.good,8);
  assert.equal(model.failed,2);
  assert.equal(model.percent,100);
  assert.equal(model.terminal,true);
  assert.equal(model.jobsPublished,77);
});

test('never reports more than 100 percent', () => {
  assert.equal(runProgressModel({status:'in_progress',progress:{sources_total:3,sources_processed:4}}).percent,100);
});
