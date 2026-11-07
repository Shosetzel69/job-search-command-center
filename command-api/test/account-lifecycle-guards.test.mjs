import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthenticatedRoute } from '../src/multiuser-api.js';

// #522 / #578: deterministic HTTP-boundary regressions, no Google credentials,
// external network, database access, or destructive account mutations.
const BASE = 'https://jscc.test.invalid';
const env = Object.freeze({ FRONTEND_ORIGIN: BASE });
const targetId = '22222222-2222-4222-8222-222222222222';
const user = Object.freeze({
  user_id: '11111111-1111-4111-8111-111111111111',
  profile_id: '33333333-3333-4333-8333-333333333333',
  role: 'USER',
  status: 'ACTIVE',
  email: 'synthetic-user@example.invalid',
});
const admin = Object.freeze({ ...user, role: 'ADMIN' });
const request = (method, path, origin = BASE) =>
  new Request(BASE + path, {
    method,
    ...(origin === null ? {} : { headers: { Origin: origin } }),
  });

async function expectForbidden(method, path, context, origin = BASE) {
  await assert.rejects(
    handleAuthenticatedRoute(request(method, path, origin), env, context),
    error => error?.status === 403,
    `${method} ${path} must deny before repository/database access`,
  );
}

test('AL-03/04: authenticated /me returns only own identity summary', async () => {
  const response = await handleAuthenticatedRoute(request('GET', '/me'), env, user);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    user_id: user.user_id,
    profile_id: user.profile_id,
    role: 'USER',
    account_status: 'ACTIVE',
    email: user.email,
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('AL-05/07/08/12: USER cannot list or mutate ADMIN account lifecycle', async () => {
  for (const [method, path] of [
    ['GET', '/admin/accounts'],
    ['POST', `/admin/accounts/${targetId}/deactivate`],
    ['POST', `/admin/accounts/${targetId}/reactivate`],
    ['DELETE', `/admin/accounts/${targetId}`],
  ]) {
    await expectForbidden(method, path, user);
  }
});

test('AL-05/07/08: missing ADMIN role fails closed', async () => {
  for (const [method, path] of [
    ['GET', '/admin/accounts'],
    ['POST', `/admin/accounts/${targetId}/deactivate`],
    ['POST', `/admin/accounts/${targetId}/reactivate`],
    ['DELETE', `/admin/accounts/${targetId}`],
  ]) {
    await expectForbidden(method, path, { ...user, role: null });
  }
});

test('AL-05/07/08: cross-origin ADMIN lifecycle mutations fail before DB work', async () => {
  for (const [method, path] of [
    ['POST', `/admin/accounts/${targetId}/deactivate`],
    ['POST', `/admin/accounts/${targetId}/reactivate`],
    ['DELETE', `/admin/accounts/${targetId}`],
  ]) {
    await expectForbidden(method, path, admin, 'https://other-origin.invalid');
  }
});

test('AL-08: cross-origin self-delete is blocked before any account mutation', async () => {
  await expectForbidden('DELETE', '/me/account', user, 'https://other-origin.invalid');
});
