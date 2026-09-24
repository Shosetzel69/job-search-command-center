import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentBadge, releaseVersionLabel } from '../src/environment-marker.mjs';

test('DEV and TEST render explicit non-production markers', () => {
  assert.equal(environmentBadge('dev'), 'DEV');
  assert.equal(environmentBadge('test'), 'TEST');
});

test('PROD renders explicit production identity and unknown values fail visibly', () => {
  assert.equal(environmentBadge('prod'), 'PROD');
  assert.equal(environmentBadge(null), 'UNKNOWN');
});

test('release version label is independent of environment identity', () => {
  assert.equal(releaseVersionLabel('0.5.0'), 'v0.5.0');
  assert.equal(releaseVersionLabel(''), 'v?');
});
