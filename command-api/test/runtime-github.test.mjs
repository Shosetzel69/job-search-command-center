import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessRuntimeRepository, dispatchWorkflow, readRuntimeJson, writeRuntimeJson } from '../src/runtime-github.js';

const runtime = {
  runtimeOwner:'runtime-owner',
  runtimeRepo:'runtime-repo',
  runtimeRef:'runtime-ref',
  workflow:'job-search-full.yml',
  sourceSha:'a'.repeat(40),
};
const env = { GITHUB_TOKEN:'token' };

async function withFetch(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await callback(); }
  finally { globalThis.fetch = original; }
}

test('runtime read targets explicit runtime repository and ref', async () => {
  let requested = null;
  await withFetch(async url => {
    requested = String(url);
    const content = btoa(JSON.stringify({ schema_version:'1.0' }));
    return new Response(JSON.stringify({ sha:'blob-sha', content }), { status:200 });
  }, async () => {
    const result = await readRuntimeJson(env, runtime, 'data/search-config.json');
    assert.equal(result.sha, 'blob-sha');
  });
  assert.equal(requested, 'https://api.github.com/repos/runtime-owner/runtime-repo/contents/data/search-config.json?ref=runtime-ref');
});

test('runtime read falls back to raw media when Contents API omits inline content', async () => {
  const requests = [];
  await withFetch(async (url, init = {}) => {
    requests.push({ url:String(url), headers:init.headers || {} });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        sha:'large-blob-sha',
        size:6_162_245,
        encoding:'none',
        content:'',
      }), { status:200 });
    }
    return new Response(JSON.stringify({
      schema_version:'1.0',
      runs:[{ run_id:'github-test' }],
    }), { status:200 });
  }, async () => {
    const result = await readRuntimeJson(env, runtime, 'data/run-history.json');
    assert.equal(result.sha, 'large-blob-sha');
    assert.deepEqual(result.payload, {
      schema_version:'1.0',
      runs:[{ run_id:'github-test' }],
    });
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://api.github.com/repos/runtime-owner/runtime-repo/contents/data/run-history.json?ref=runtime-ref');
  assert.equal(requests[1].url, requests[0].url);
  assert.equal(requests[1].headers.Accept, 'application/vnd.github.raw+json');
});

test('runtime write targets explicit runtime branch', async () => {
  let requested = null;
  let body = null;
  await withFetch(async (url, init) => {
    requested = String(url);
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ commit:{ sha:'commit-sha' } }), { status:200 });
  }, async () => {
    await writeRuntimeJson(env, runtime, 'data/search-config.json', 'blob-sha', { schema_version:'1.0' }, 'test');
  });
  assert.equal(requested, 'https://api.github.com/repos/runtime-owner/runtime-repo/contents/data/search-config.json');
  assert.equal(body.branch, 'runtime-ref');
});

test('workflow dispatch transports exact immutable source_sha', async () => {
  let requested = null;
  let body = null;
  await withFetch(async (url, init) => {
    requested = String(url);
    body = JSON.parse(init.body);
    return new Response(null, { status:204 });
  }, async () => {
    await dispatchWorkflow(env, runtime, 'manual-ui', false);
  });
  assert.equal(requested, 'https://api.github.com/repos/runtime-owner/runtime-repo/actions/workflows/job-search-full.yml/dispatches');
  assert.equal(body.ref, 'runtime-ref');
  assert.equal(body.inputs.run_trigger, 'manual-ui');
  assert.equal(body.inputs.source_sha, runtime.sourceSha);
});


test('runtime credential probe validates actual runtime contents access', async () => {
  await withFetch(async url => {
    assert.equal(String(url), 'https://api.github.com/repos/runtime-owner/runtime-repo/contents/data/search-config.json?ref=runtime-ref');
    const content = btoa(JSON.stringify({ schema_version:'1.0' }));
    return new Response(JSON.stringify({ sha:'blob-sha', content }), { status:200 });
  }, async () => {
    assert.equal(await canAccessRuntimeRepository(env, runtime), true);
  });
});

test('runtime credential probe fails closed for missing or rejected token', async () => {
  assert.equal(await canAccessRuntimeRepository({}, runtime), false);
  await withFetch(async () => new Response('Bad credentials', { status:401 }), async () => {
    assert.equal(await canAccessRuntimeRepository(env, runtime), false);
  });
});
