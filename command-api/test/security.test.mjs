import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

import { CANDIDATE_MANAGED_DATA_FILES, INTERNAL_DATA_FILES, OPERATIONAL_DATA_FILES, PROTECTED_DATA_FILES } from '../../shared/runtime-data.mjs';
import commandApi, { authorizeGithubOidcPayload, authorizeGooglePayload, protectedRuntimePath, readProtectedRuntimeData, validateUserConfigPatch, verifyGithubActionsOidcToken } from '../src/index.js';
import secureEntry, { retiredCompatibilityPath } from '../src/secure-entry.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = {
  APP_ENV: 'test',
  FRONTEND_ORIGIN: 'https://app.example.test',
  GITHUB_RUNTIME_OWNER: 'runtime-owner',
  GITHUB_RUNTIME_REPO: 'runtime-repo',
  GITHUB_RUNTIME_REF: 'main',
  GITHUB_WORKFLOW: 'job-search-full.yml',
  SOURCE_SHA: 'a'.repeat(40),
  RUNTIME_DATA_SHA: 'b'.repeat(40),
  SEARCH_MODE: 'smoke',
  GOOGLE_CLIENT_ID: 'test-client-id',
  ALLOWED_GOOGLE_SUB: 'allowed-test-user',
};

const protectedDataPaths = [...PROTECTED_DATA_FILES, ...OPERATIONAL_DATA_FILES].map(file => `/data/${file}`);
const nomenclatures = JSON.parse(readFileSync(resolve(process.cwd(), '../data/nomenclatures.json'), 'utf8'));


test('unauthorized Google subject is rejected independently of token parsing', () => {
  assert.throws(
    () => authorizeGooglePayload({ sub:'different-user', email:'other@example.test' }, env),
    error => error?.status === 403 && /not authorized/i.test(error.message),
  );
  assert.equal(authorizeGooglePayload({ sub:env.ALLOWED_GOOGLE_SUB }, env).sub, env.ALLOWED_GOOGLE_SUB);
});


const OIDC_NOW = 1_800_000_000;
const validOidcClaims = overrides => ({
  iss:'https://token.actions.githubusercontent.com',
  aud:'jscc-functional-verification',
  repository:'Shosetzel69/job-search-command-center',
  repository_id:'1356423874',
  environment:'test',
  workflow_ref:'Shosetzel69/job-search-command-center/.github/workflows/deploy-environment.yml@refs/heads/main',
  event_name:'workflow_dispatch',
  iat:OIDC_NOW - 10,
  nbf:OIDC_NOW - 10,
  exp:OIDC_NOW + 300,
  sub:'repo:Shosetzel69/job-search-command-center:environment:test',
  ...overrides,
});

test('GitHub Actions OIDC claim boundary accepts only exact functional verification identity', () => {
  assert.equal(authorizeGithubOidcPayload(validOidcClaims(), env, OIDC_NOW).environment, 'test');
  for (const [name,override] of [
    ['issuer',{ iss:'https://evil.example.test' }],
    ['audience',{ aud:'wrong-audience' }],
    ['repository',{ repository:'other/repo' }],
    ['repository_id',{ repository_id:'999' }],
    ['environment',{ environment:'prod' }],
    ['workflow',{ workflow_ref:'Shosetzel69/job-search-command-center/.github/workflows/other.yml@refs/heads/main' }],
    ['event',{ event_name:'push' }],
  ]) {
    assert.throws(
      () => authorizeGithubOidcPayload(validOidcClaims(override), env, OIDC_NOW),
      error => error?.status === 403,
      name,
    );
  }
  assert.throws(
    () => authorizeGithubOidcPayload(validOidcClaims({ exp:OIDC_NOW - 1 }), env, OIDC_NOW),
    error => error?.status === 401 && /expired/i.test(error.message),
  );
  assert.throws(
    () => authorizeGithubOidcPayload(validOidcClaims({ nbf:OIDC_NOW + 120 }), env, OIDC_NOW),
    error => error?.status === 401 && /not yet valid/i.test(error.message),
  );
  assert.throws(
    () => authorizeGithubOidcPayload(validOidcClaims({ iat:OIDC_NOW + 120 }), env, OIDC_NOW),
    error => error?.status === 401 && /issued-at/i.test(error.message),
  );
});

test('GitHub Actions OIDC verifier requires a valid signature, issuer and audience', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'functional-test';
  jwk.alg = 'RS256';
  const jwks = createLocalJWKSet({ keys:[jwk] });
  const sign = async claims => new SignJWT(claims)
    .setProtectedHeader({ alg:'RS256', kid:'functional-test' })
    .sign(privateKey);

  const token = await sign(validOidcClaims());
  const payload = await verifyGithubActionsOidcToken(token, env, {
    jwks,
    currentDate:new Date(OIDC_NOW * 1000),
  });
  assert.equal(payload.repository_id, '1356423874');

  const wrongAudience = await sign(validOidcClaims({ aud:'wrong-audience' }));
  await assert.rejects(
    () => verifyGithubActionsOidcToken(wrongAudience, env, { jwks, currentDate:new Date(OIDC_NOW * 1000) }),
  );

  const { privateKey:otherPrivateKey } = await generateKeyPair('RS256');
  const badSignature = await new SignJWT(validOidcClaims())
    .setProtectedHeader({ alg:'RS256', kid:'functional-test' })
    .sign(otherPrivateKey);
  await assert.rejects(
    () => verifyGithubActionsOidcToken(badSignature, env, { jwks, currentDate:new Date(OIDC_NOW * 1000) }),
  );
});

test('GitHub Actions OIDC is rejected on mutation endpoints before Google verification', async () => {
  const header = Buffer.from(JSON.stringify({ alg:'none', typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(validOidcClaims())).toString('base64url');
  const fakeOidc = `${header}.${payload}.`;

  const response = await commandApi.fetch(new Request('https://app.example.test/sources', {
    method:'POST',
    headers:{
      Origin:env.FRONTEND_ORIGIN,
      Authorization:`Bearer ${fakeOidc}`,
    },
  }), env);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /OIDC is not allowed/i);
});


test('route-level GitHub OIDC access is limited to exactly candidate-managed reconciliation files', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'route-functional-test';
  jwk.alg = 'RS256';
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT(validOidcClaims({
    iat:now - 10,
    nbf:now - 10,
    exp:now + 300,
  }))
    .setProtectedHeader({ alg:'RS256', kid:'route-functional-test' })
    .sign(privateKey);

  const runtimePayloads = {
    'sources.json': { schema_version:'1.0', count:0, sources:[] },
    'source-categories.json': { schema_version:'1.0', count:0, categories:[] },
    'nomenclatures.json': { schema_version:'1.0', domains:{} },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const value = String(url);
    if (value === 'https://token.actions.githubusercontent.com/.well-known/jwks') {
      return new Response(JSON.stringify({ keys:[jwk] }), {
        status:200,
        headers:{ 'content-type':'application/json', 'cache-control':'max-age=60' },
      });
    }
    const match = value.match(/\/contents\/data\/([^?]+)\?ref=main$/);
    if (match) {
      const file = decodeURIComponent(match[1]);
      const payload = runtimePayloads[file];
      assert.ok(payload, `unexpected runtime read for ${file}`);
      return new Response(JSON.stringify({
        sha:`blob-${file}`,
        content:Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
      }), { status:200, headers:{ 'content-type':'application/json' } });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };

  try {
    const runtimeEnv = { ...env, GITHUB_TOKEN:'test-runtime-token' };
    for (const file of CANDIDATE_MANAGED_DATA_FILES) {
      const response = await secureEntry.fetch(new Request(`https://app.example.test/data/${file}`, {
        headers:{ Authorization:`Bearer ${token}` },
      }), runtimeEnv);
      assert.equal(response.status, 200, `OIDC should read ${file}`);
    }

    const blocked = PROTECTED_DATA_FILES.filter(file => !CANDIDATE_MANAGED_DATA_FILES.includes(file));
    assert.ok(blocked.length > 0);
    for (const file of blocked) {
      const response = await secureEntry.fetch(new Request(`https://app.example.test/data/${file}`, {
        headers:{ Authorization:`Bearer ${token}` },
      }), runtimeEnv);
      assert.equal(response.status, 403, `OIDC must not read ${file}`);
      const body = await response.json();
      assert.match(body.error, /not authorized for this protected data file/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid configuration payloads fail closed at validation boundary', () => {
  for (const payload of [null, [], 'bad', 42]) {
    assert.throws(
      () => validateUserConfigPatch(payload, nomenclatures),
      error => error?.status === 400 && /invalid configuration payload/i.test(error.message),
    );
  }
  assert.throws(
    () => validateUserConfigPatch({ fitThreshold:101 }, nomenclatures),
    error => error?.status === 400 && /fitThreshold/i.test(error.message),
  );
});

test('protected runtime data resolves to isolated runtime paths', () => {
  assert.equal(protectedRuntimePath(env, 'sources.json'), 'data/sources.json');
  assert.equal(
    protectedRuntimePath({ ...env, SOURCES_PATH:'runtime/custom-sources.json' }, 'sources.json'),
    'runtime/custom-sources.json',
  );
  assert.equal(protectedRuntimePath(env, 'run-status.json'), 'data/run-status.json');
});

test('protected runtime data is read fresh from runtime repository on each request', async () => {
  const originalFetch = globalThis.fetch;
  const runtimeEnv = { ...env, GITHUB_TOKEN:'test-token' };
  let payload = { schema_version:'1.0', count:0, sources:[] };
  const requested = [];

  globalThis.fetch = async url => {
    requested.push(String(url));
    const content = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    return new Response(JSON.stringify({ sha:'blob-sha', content }), { status:200 });
  };

  try {
    const first = await readProtectedRuntimeData(runtimeEnv, 'sources.json');
    assert.equal(first.count, 0);

    payload = {
      schema_version:'1.0',
      count:1,
      sources:[{ id:'src-test', name:'Persisted source' }],
    };
    const second = await readProtectedRuntimeData(runtimeEnv, 'sources.json');
    assert.equal(second.count, 1);
    assert.equal(second.sources[0].name, 'Persisted source');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requested.length, 2);
  assert.ok(requested.every(url => url.includes('/repos/runtime-owner/runtime-repo/contents/data/sources.json?ref=main')));
});

test('protected runtime data helper rejects internal or unknown files', async () => {
  await assert.rejects(
    () => readProtectedRuntimeData({ ...env, GITHUB_TOKEN:'test-token' }, 'search-state.json'),
    error => error?.status === 404,
  );
  await assert.rejects(
    () => readProtectedRuntimeData({ ...env, GITHUB_TOKEN:'test-token' }, 'unknown.json'),
    error => error?.status === 404,
  );
});

test('all protected data assets reject missing bearer/cookie session before asset lookup', async () => {
  assert.ok(protectedDataPaths.includes('/data/nomenclatures.json'));
  for (const path of protectedDataPaths) {
    const response = await secureEntry.fetch(new Request(`https://app.example.test${path}`), env);
    assert.equal(response.status, 401, `${path} must be protected and must not return 404`);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
  }
});

test('nomenclature admin API rejects missing bearer/cookie session before GitHub access', async () => {
  for (const [method,path] of [
    ['GET','/nomenclatures'],
    ['POST','/nomenclatures/application_statuses'],
    ['PUT','/nomenclatures/regions/EU'],
    ['DELETE','/nomenclatures/application_statuses/applied'],
  ]) {
    const response = await secureEntry.fetch(new Request(`https://app.example.test${path}`, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type':'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ label:'Test' }),
    }), env);
    assert.equal(response.status, 401, `${method} ${path} must require authentication`);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
  }
});

test('internal data assets are never part of the protected/public manifest', () => {
  for (const file of INTERNAL_DATA_FILES) {
    assert.equal(PROTECTED_DATA_FILES.includes(file), false, `${file} must remain internal`);
  }
  assert.ok(INTERNAL_DATA_FILES.includes('search-state.json'));
});

test('unknown data asset is not exposed', async () => {
  const response = await secureEntry.fetch(new Request('https://app.example.test/data/unknown.json'), env);
  assert.equal(response.status, 404);
});

test('privileged request from a forbidden origin is rejected before auth', async () => {
  const response = await commandApi.fetch(new Request('https://app.example.test/commands/run', {
    method: 'POST',
    headers: { Origin: 'https://evil.example.test' },
  }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const payload = await response.json();
  assert.match(payload.error, /origin not allowed/i);
});

test('preflight from a forbidden origin is rejected', async () => {
  const response = await commandApi.fetch(new Request('https://app.example.test/sources', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example.test' },
  }), env);
  assert.equal(response.status, 403);
});

test('ATC-489-07 retired compatibility paths are explicit and canonical paths remain active', () => {
  for (const path of ['/data/jobs.json','/data/search-config.json','/data/applications.json','/config','/commands/run']) {
    assert.equal(retiredCompatibilityPath(path), true, path);
  }
  for (const path of ['/me/jobs','/me/preferences','/me/refresh','/admin/refresh','/applications']) {
    assert.equal(retiredCompatibilityPath(path), false, path);
  }
});


test('malformed Google credential at session establishment is normalized to generic 401', async () => {
  const response = await secureEntry.fetch(new Request('https://app.example.test/auth/session', {
    method:'POST',
    headers:{
      Origin:env.FRONTEND_ORIGIN,
      Authorization:'Bearer abc',
    },
  }), env);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Invalid Google ID token');
  assert.doesNotMatch(body.error, /jose|jws|jwk|compact/i);
});
