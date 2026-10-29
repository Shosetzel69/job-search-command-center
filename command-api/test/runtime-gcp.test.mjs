import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEnvironmentConfig } from '../src/environment-config.js';

const SHA = 'a'.repeat(40);
const gcp = {
  APP_ENV:'dev',
  FRONTEND_ORIGIN:'https://dev.example.test',
  JSCC_RUNTIME_BACKEND:'gcp',
  GCP_PROJECT_ID:'jscc-dev',
  GCP_RUNTIME_BUCKET:'jscc-dev-runtime-828902654738',
  GCP_SEARCH_JOB:'jscc-search-dev',
  GCP_REGION:'europe-west1',
  SOURCE_SHA:SHA,
  RUNTIME_DATA_SHA:SHA,
  SEARCH_MODE:'disabled',
};

test('GCP runtime config does not require GitHub runtime bindings', () => {
  const config = assertEnvironmentConfig(gcp);
  assert.equal(config.runtimeBackend, 'gcp');
  assert.equal(config.runtimeRepository, 'gcp://jscc-dev/jscc-dev-runtime-828902654738');
  assert.equal(config.gcpSearchJob, 'jscc-search-dev');
});

test('GCP runtime config fails closed without environment-owned bucket/job', () => {
  assert.throws(() => assertEnvironmentConfig({ ...gcp, GCP_RUNTIME_BUCKET:'' }), /GCP_RUNTIME_BUCKET is required/);
  assert.throws(() => assertEnvironmentConfig({ ...gcp, GCP_SEARCH_JOB:'' }), /GCP_SEARCH_JOB is required/);
});

test('GCP runtime adapter protects candidate-managed catalogs and uses atomic controls', () => {
  const text = readFileSync(new URL('../src/runtime-gcp.js', import.meta.url), 'utf8');
  assert.match(text, /candidate-managed; create a new candidate/);
  assert.match(text, /ifGenerationMatch=0/);
  assert.match(text, /ifGenerationMatch=\$\{encodeURIComponent\(generation\)\}/);
  assert.match(text, /const name = `projects\//);
  assert.match(text, /Cloud Run Job invocation failed/);
  assert.match(text, /heavy-search\.lock/);
  assert.match(text, /GCP_CURRENT_GENERATION/);
  assert.match(text, /scripts\/gcp_finalize_run\.py/);
  assert.match(text, /trap .*active\.json .*heavy-search\.lock/);
  assert.match(text, /name === 'run-status\.json'/);
  assert.match(text, /activeRunId/);
  assert.match(text, /runs\/\$\{runId\}\/\$\{name\}/);
  assert.match(text, /deleteObject\(env, 'active\.json'\)/);
  assert.match(text, /activeWorkflowRun/);
  assert.match(text, /request_signature/);
  assert.match(text, /retrieve_scope/);
  assert.match(text, /JSCC_RUN_ID/);
  assert.match(text, /JSCC_REQUEST_SIGNATURE/);
  assert.match(text, /JSCC_RETRIEVE_SCOPE_JSON/);
  assert.match(text, /run-\$\{randomUUID\(\)\}/);
  assert.match(text, /Bounded retrieve scope and request signature are required/);
});

test('GCP runner invokes packaged Python finalizer', () => {
  const source = readFileSync(new URL('../src/runtime-gcp.js', import.meta.url), 'utf8');
  const finalizer = readFileSync(new URL('../../scripts/gcp_finalize_run.py', import.meta.url), 'utf8');
  assert.match(source, /python3 scripts\/gcp_finalize_run\.py/);
  assert.doesNotMatch(source, /JSON\.stringify\(finalizer\)/);
  assert.match(finalizer, /run-completions/);
  assert.match(finalizer, /latest-run\.json/);
  assert.match(finalizer, /ifGenerationMatch=/);
  assert.match(finalizer, /cloud_run_execution/);
});

test('Node server listens on PORT and delegates to the existing secure handler', () => {
  const text = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(text, /process\.env\.PORT \|\| 8080/);
  assert.match(text, /commandApi\.fetch/);
});


test('DEV ADMIN sources persist with GCS create-if-absent, generation CAS and no TEST/PROD mutation', async () => {
  const { readRuntimeJson, writeRuntimeJson } = await import('../src/runtime-gcp.js');
  const originalFetch = globalThis.fetch;
  let generation = null;
  let payload = null;
  const requests = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method || 'GET';
      requests.push({ method, path:url.pathname, query:url.searchParams.toString() });
      if (url.hostname === 'metadata.google.internal') {
        return new Response(JSON.stringify({ access_token:'test-gcp-token' }), { status:200 });
      }
      if (url.hostname !== 'storage.googleapis.com') throw Error('Unexpected network destination');
      const object = url.searchParams.get('name') || decodeURIComponent(url.pathname.split('/o/').at(-1) || '');
      assert.equal(object, 'seed/sources.json', 'only the DEV source registry may be modified');
      if (method === 'GET' && url.searchParams.get('alt') === 'media') {
        if (generation === null) return new Response('not found', { status:404 });
        return new Response(JSON.stringify(payload), { status:200 });
      }
      if (method === 'GET') {
        if (generation === null) return new Response('not found', { status:404 });
        return new Response(JSON.stringify({generation:String(generation)}), { status:200 });
      }
      if (method === 'POST') {
        const expected = url.searchParams.get('ifGenerationMatch');
        if (String(generation ?? 0) !== expected) return new Response('conflict', { status:412 });
        generation = (generation ?? 0) + 1;
        payload = JSON.parse(init.body);
        return new Response(JSON.stringify({generation:String(generation)}), { status:200 });
      }
      throw Error('Unexpected method');
    };
    const runtime = {sourceSha:SHA};
    const first = await readRuntimeJson(gcp, runtime, 'data/sources.json');
    assert.equal(first.sha, '0');
    assert.ok(first.payload.sources.length >= 100);
    const edited = structuredClone(first.payload);
    const hr = edited.sources.find(s => s.name === 'HR Plus');
    assert.ok(hr);
    hr.validation_status = 'validated';
    hr.approval_status = 'approved';
    hr.active = true;
    await writeRuntimeJson(gcp, runtime, 'data/sources.json', first.sha, edited);
    const second = await readRuntimeJson(gcp, runtime, 'data/sources.json');
    assert.equal(second.sha, '1');
    assert.equal(second.payload.sources.find(s => s.name === 'HR Plus').active, true);
    await assert.rejects(
      writeRuntimeJson(gcp, runtime, 'data/sources.json', '0', edited),
      error => error.status === 409 && /concurrently/.test(error.message),
    );
    edited.sources.find(s => s.name === 'HR Plus').active = false;
    await writeRuntimeJson(gcp, runtime, 'data/sources.json', '1', edited);
    assert.equal((await readRuntimeJson(gcp, runtime, 'data/sources.json')).payload.sources.find(s => s.name === 'HR Plus').active, false);
    for (const environment of ['test','prod']) {
      const frozen = { ...gcp, APP_ENV:environment, GCP_PROJECT_ID:'jscc-'+environment };
      const original = await readRuntimeJson(frozen, runtime, 'data/sources.json');
      assert.equal(original.sha, SHA);
      assert.equal(original.payload.sources.find(s => s.name === 'HR Plus').active, false);
      await assert.rejects(
        writeRuntimeJson(frozen, runtime, 'data/sources.json', original.sha, edited),
        error => error.status === 409 && /candidate-managed/.test(error.message),
      );
    }
    assert.ok(requests.some(r => r.method === 'POST' && r.query.includes('ifGenerationMatch=0')));
    assert.ok(requests.some(r => r.method === 'POST' && r.query.includes('ifGenerationMatch=1')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GCP source snapshot must be copied into each run before collector starts', () => {
  const text = readFileSync(new URL('../src/runtime-gcp.js', import.meta.url), 'utf8');
  assert.match(text, /\/runtime\/seed\/sources\.json/);
  assert.match(text, /\/sources\.json/);
  assert.match(text, /data\/sources\.json/);
  assert.match(text, /JSCC_RUNTIME_DATA_DIR/);
  assert.match(text, /devSourcesEnabled\(env\)/);
});
