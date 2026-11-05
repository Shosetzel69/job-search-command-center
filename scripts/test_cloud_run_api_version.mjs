import test from 'node:test';
import assert from 'node:assert/strict';
import { violationsForContent } from './check_cloud_run_api_version.mjs';

test('rejects global and regional Cloud Run v1 endpoints', () => {
  for (const sample of [
    'https://run.googleapis.com/v1/namespaces/jscc-dev/jobs',
    'https://europe-west1-run.googleapis.com/v1/projects/jscc-dev',
    'const api = "run.googleapis.com/v1"',
  ]) {
    assert.ok(violationsForContent(sample).some(x => x.reason === 'v1_endpoint'), sample);
  }
});

test('rejects explicit client library v1 selectors', () => {
  for (const sample of [
    "import {JobsClient} from '@google-cloud/run/v1'",
    'from google.cloud.run_v1 import JobsClient',
    'import google.cloud.run.v1',
  ]) {
    assert.ok(violationsForContent(sample).some(x => x.reason === 'v1_client'), sample);
  }
});

test('accepts Cloud Run v2 and unrelated Google APIs', () => {
  for (const sample of [
    'https://run.googleapis.com/v2/projects/jscc-dev/locations/europe-west1/jobs',
    'https://europe-west1-run.googleapis.com/v2/projects/jscc-dev',
    'https://storage.googleapis.com/storage/v1/b',
    'const RUN_API = "https://run.googleapis.com/v2"',
  ]) assert.deepEqual(violationsForContent(sample), [], sample);
});

test('reports correct line and supports multiple violations', () => {
  const findings = violationsForContent('safe\nhttps://run.googleapis.com/v1/jobs\nimport google.cloud.run_v1');
  assert.deepEqual(findings.map(x => x.line), [2,3]);
});
