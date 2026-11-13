import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgressModel } from '../src/run-progress.mjs';

test('uses explicit live progress counters', () => {
  assert.deepEqual(runProgressModel({
    status:'in_progress',
    progress:{sources_total:20,sources_processed:7,sources_good:5,sources_failed:1,sources_skipped:1,sources_partial:2,percent:35},
  }), {
    total:20,processed:7,good:5,failed:1,skipped:1,preflightSkipped:0,blocked:0,noExtractable:0,partial:2,percent:35,
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

test('F520-06 reports blocked separately and explains catalog skips excluded from X/Y', () => {
  const status={
    status:'completed_with_errors',
    sources_skipped:9,
    sources_blocked:1,
    sources_succeeded:108,
    progress:{
      sources_total:135,
      sources_processed:135,
      sources_good:108,
      sources_failed:26,
      sources_skipped:0,
      sources_skipped_preflight:9,
      sources_blocked:1,
      sources_no_extractable_jobs:0,
      percent:100,
    },
  };
  const model=runProgressModel(status);
  assert.equal(model.total,135);
  assert.equal(model.processed,135);
  assert.equal(model.good,108);
  assert.equal(model.blocked,1);
  assert.equal(model.skipped,0);
  assert.equal(model.preflightSkipped,9);
  assert.equal(model.noExtractable,0);
  assert.equal(model.percent,100);
  assert.equal(model.good + model.failed + model.blocked + model.skipped,135);
});

test('F520-06 distinguishes no-extractable from success and handles empty progress', () => {
  const model=runProgressModel({
    status:'in_progress',
    progress:{sources_total:3,sources_processed:2,sources_good:1,
              sources_blocked:1,sources_no_extractable_jobs:1,percent:66},
  });
  assert.equal(model.blocked,1);
  assert.equal(model.noExtractable,1);
  assert.equal(model.good,1);
  assert.equal(model.percent,66);
  const empty=runProgressModel(null);
  assert.equal(empty.blocked,0);
  assert.equal(empty.preflightSkipped,0);
  assert.equal(empty.noExtractable,0);
});
