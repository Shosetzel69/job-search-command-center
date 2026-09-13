import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentBadge } from '../src/environment-marker.mjs';

test('DEV and TEST render explicit non-production markers', () => {
  assert.equal(environmentBadge('dev'), 'DEV');
  assert.equal(environmentBadge('test'), 'TEST');
});

test('PROD has no non-production marker', () => {
  assert.equal(environmentBadge('prod'), null);
  assert.equal(environmentBadge(null), null);
});
