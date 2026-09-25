import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSourceAggregates,
  exclusionGroupRows,
  failureGroupRows,
  sourceResultRows,
  sourceSummaryRows,
  runSummaryLabel,
} from '../src/admin-log-model.mjs';

test('exclusion grouping sorts dominant categories and exact reasons by count', () => {
  const rows = exclusionGroupRows({
    excluded_by_category:{ geo:12, role:40, freshness:7 },
    excluded_by_reason:{
      'title outside target':35,
      'outside target or excluded geography':12,
      'older than 24 hours':7,
      'non-IT role':5,
    },
  });
  assert.deepEqual(rows.categories, [
    { key:'role', count:40, label:'Rol' },
    { key:'geo', count:12, label:'Geografie' },
    { key:'freshness', count:7, label:'Freshness' },
  ]);
  assert.deepEqual(rows.reasons.map(item => [item.key,item.count]), [
    ['title outside target',35],
    ['outside target or excluded geography',12],
    ['older than 24 hours',7],
    ['non-IT role',5],
  ]);
});

test('uses persisted structured aggregates without parsing messages', () => {
  const run = {
    source_outcome_counts:{ success:2, success_empty:1, failed:1, deferred_provider:3 },
    source_failure_codes:{ RATE_LIMITED:1 },
    source_failure_stages:{ fetch:1 },
    source_results:[
      { source:'A', outcome:'failed', error:'arbitrary human text', error_code:'RATE_LIMITED', failure_stage:'fetch' },
    ],
  };
  assert.deepEqual(deriveSourceAggregates(run), {
    outcomes:{ success:2, success_empty:1, failed:1, deferred_provider:3 },
    errorCodes:{ RATE_LIMITED:1 },
    failureStages:{ fetch:1 },
  });
});

test('derives fallback aggregates only from structured source fields', () => {
  const run = {
    source_results:[
      { source:'A', outcome:'success', records:4 },
      { source:'B', outcome:'success_empty', records:0 },
      { source:'C', outcome:'failed', error:'timeout-looking text', error_code:'SCHEMA_ERROR', failure_stage:'parse' },
      { source:'D', outcome:'disabled_config', error:'failed-looking text' },
    ],
  };
  const result = deriveSourceAggregates(run);
  assert.equal(result.outcomes.success, 1);
  assert.equal(result.outcomes.success_empty, 1);
  assert.equal(result.outcomes.failed, 1);
  assert.equal(result.outcomes.disabled_config, 1);
  assert.deepEqual(result.errorCodes, { SCHEMA_ERROR:1 });
  assert.deepEqual(result.failureStages, { parse:1 });
});

test('expected non-executed outcomes are not classified as failures', () => {
  const run = {
    source_outcome_counts:{
      deferred_provider:1,
      blocked_credentials:1,
      validation_pending:1,
      disabled_config:1,
      excluded_policy:1,
      skipped:1,
    },
    source_failure_codes:{},
    source_failure_stages:{},
  };
  const rows = sourceSummaryRows(run);
  assert.ok(rows.every(row => row.kind === 'expected'));
  assert.equal(failureGroupRows(run).errorCodes.length, 0);
});

test('failure grouping uses error_code and failure_stage directly', () => {
  const run = {
    source_results:[
      { source:'A', outcome:'failed', error_code:'TIMEOUT', failure_stage:'fetch' },
      { source:'B', outcome:'failed', error_code:'TIMEOUT', failure_stage:'fetch' },
      { source:'C', outcome:'failed', error_code:'SCHEMA_ERROR', failure_stage:'parse' },
    ],
  };
  assert.deepEqual(failureGroupRows(run), {
    errorCodes:[
      { key:'TIMEOUT', count:2 },
      { key:'SCHEMA_ERROR', count:1 },
    ],
    failureStages:[
      { key:'fetch', count:2 },
      { key:'parse', count:1 },
    ],
  });
});

test('source rows expose structured failure detail and human message separately', () => {
  const rows = sourceResultRows({
    source_results:[
      {
        source:'Example',
        outcome:'failed',
        records:0,
        error_code:'ACCESS_DENIED',
        failure_stage:'authentication',
        http_status:403,
        error:'Human-readable detail',
      },
    ],
  });
  assert.equal(rows[0].errorCode, 'ACCESS_DENIED');
  assert.equal(rows[0].failureStage, 'authentication');
  assert.equal(rows[0].httpStatus, 403);
  assert.equal(rows[0].message, 'Human-readable detail');
});


test('run summary labels distinguish source attempts from published jobs', () => {
  assert.equal(
    runSummaryLabel({ sources_attempted:116, sources_processed:117, jobs_published:29 }),
    '116 surse evaluate · 29 joburi publicate',
  );
  assert.equal(
    runSummaryLabel({ sources_processed:10, jobs_published:3 }),
    '10 surse evaluate · 3 joburi publicate',
  );
});
