
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeJobSearchQuery} from '../src/multiuser-repository.js';
import {FIT_ALGORITHM_VERSION} from '../src/profile-evaluation.js';

const repository = readFileSync(
  new URL('../src/multiuser-repository.js', import.meta.url),
  'utf8'
);
const evaluator = readFileSync(
  new URL('../src/profile-evaluation.js', import.meta.url),
  'utf8'
);

test('591: B2B is an explicit opt-in query', () => {
  assert.equal(normalizeJobSearchQuery({}).b2b, false);
  assert.equal(normalizeJobSearchQuery({b2b:'true'}).b2b, true);
  assert.equal(normalizeJobSearchQuery({b2b:'false'}).b2b, false);
});

test('591: eligible population is the default', () => {
  assert.equal(normalizeJobSearchQuery({}).eligibility, 'eligible');
});

test('591: unclassified population is selectable', () => {
  assert.equal(
    normalizeJobSearchQuery({eligibility:'unknown'}).eligibility,
    'unknown'
  );
});

test('591: unknown records cannot use global FIT branch', () => {
  assert.match(repository,
    /spec\.eligibility !== 'unknown'[\s\S]{0,100}spec\.sort_fit/);
});

test('591: unknown job returns a null score', () => {
  assert.match(evaluator,
    /eligibility\.state === 'UNKNOWN'/);
  assert.match(evaluator,
    /eligibilityState:'UNKNOWN',\s*eligibilityReasonCode:[\s\S]*?score:null/);
});

test('591: evaluation algorithm invalidates older FIT cache', () => {
  assert.equal(FIT_ALGORITHM_VERSION, 'fit-v2-eligibility-strict');
});

test('591: global FIT and partial FIT are distinguishable', () => {
  assert.match(repository, /GLOBAL_VERIFIED/);
  assert.match(repository, /PARTIAL_UNVERIFIED/);
});

test('591: aggregate counts account for unknown eligibility', () => {
  assert.match(repository, /unknown_total/);
  assert.match(repository, /unknown:Number\(c\.unknown_total\)/);
});
