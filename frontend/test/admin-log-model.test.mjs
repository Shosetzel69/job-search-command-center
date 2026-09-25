import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSourceAggregates,
  exclusionGroupRows,
  failureGroupRows,
  sourceResultRows,
  sourceResultDetail,
  sortSourceResultRows,
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
      blocked_policy:1,
      provider_alias:1,
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


test('partial and blocked outcomes are warnings, not hard failures', () => {
  const rows = sourceSummaryRows({
    source_outcome_counts:{ partial:2, blocked:1, no_extractable_jobs:1, failed:1 },
    source_failure_codes:{ CONNECTOR_ERROR:1 },
    source_failure_stages:{ fetch:1 },
  });
  const byOutcome = Object.fromEntries(rows.map(row => [row.outcome,row]));
  assert.equal(byOutcome.partial.kind,'warning');
  assert.equal(byOutcome.blocked.kind,'warning');
  assert.equal(byOutcome.no_extractable_jobs.kind,'warning');
  assert.equal(byOutcome.failed.kind,'failure');
});

test('untrusted zero records display dash while valid empty displays zero', () => {
  const rows = sourceResultRows({source_results:[
    { source:'Empty OK', outcome:'success_empty', records:0 },
    { source:'Blocked', outcome:'blocked', records:0, failure_reason:'robots' },
    { source:'Failed', outcome:'failed', records:0, error_code:'TIMEOUT', failure_stage:'fetch' },
    { source:'Partial', outcome:'partial', records:3, failure_reason:'page budget' },
  ]});
  const bySource=Object.fromEntries(rows.map(row=>[row.source,row]));
  assert.equal(bySource['Empty OK'].jobsLabel,'0 joburi');
  assert.equal(bySource.Blocked.jobsLabel,'—');
  assert.equal(bySource.Failed.jobsLabel,'—');
  assert.equal(bySource.Partial.jobsLabel,'3 joburi');
  assert.equal(sourceResultDetail(bySource.Blocked),'robots');
});

test('source result rows sort deterministically by all displayed columns', () => {
  const rows=sourceResultRows({source_results:[
    {source:'Zulu',outcome:'success',records:2},
    {source:'Alpha',outcome:'partial',records:8,failure_reason:'limit'},
    {source:'Beta',outcome:'failed',records:0,error_code:'TIMEOUT',failure_stage:'fetch'},
  ]});
  assert.deepEqual(sortSourceResultRows(rows,'source','asc').map(x=>x.source),['Alpha','Beta','Zulu']);
  assert.deepEqual(sortSourceResultRows(rows,'jobs','desc').map(x=>x.source),['Alpha','Zulu','Beta']);
  assert.deepEqual(sortSourceResultRows(rows,'status','asc').map(x=>x.source),['Beta','Alpha','Zulu']);
  assert.deepEqual(sortSourceResultRows(rows,'detail','asc').map(x=>x.source),['Zulu','Alpha','Beta']);
});
