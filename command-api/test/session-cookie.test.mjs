import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COOKIE_SESSION_BEARER,
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  cookieValue,
  sessionCookie,
  sessionTokenFromRequest,
  withSessionAuthorization,
} from '../src/session-cookie.js';

function fakeJwt(exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg:'none', typ:'JWT' })}.${encode({ sub:'user', exp })}.signature`;
}

test('cookie parser returns only the named session value', () => {
  assert.equal(cookieValue(`other=x; ${SESSION_COOKIE_NAME}=abc.def; theme=dark`), 'abc.def');
  assert.equal(cookieValue('other=x'), null);
});

test('real bearer token takes precedence over a session cookie', () => {
  const request = new Request('https://app.example.test/data/jobs.json', {
    headers: { Authorization:'Bearer direct-token', Cookie:`${SESSION_COOKIE_NAME}=cookie-token` },
  });
  assert.equal(sessionTokenFromRequest(request), 'direct-token');
  assert.equal(withSessionAuthorization(request), request);
});

test('cookie session sentinel is replaced by the HttpOnly cookie token', () => {
  const request = new Request('https://app.example.test/data/jobs.json', {
    headers: { Authorization:`Bearer ${COOKIE_SESSION_BEARER}`, Cookie:`${SESSION_COOKIE_NAME}=cookie-token` },
  });
  const authorized = withSessionAuthorization(request);
  assert.equal(sessionTokenFromRequest(request), 'cookie-token');
  assert.equal(authorized.headers.get('Authorization'), 'Bearer cookie-token');
});

test('missing cookie removes the non-secret cookie-session sentinel', () => {
  const request = new Request('https://app.example.test/data/jobs.json', {
    headers: { Authorization:`Bearer ${COOKIE_SESSION_BEARER}` },
  });
  assert.equal(withSessionAuthorization(request).headers.get('Authorization'), null);
});

test('session cookie is host-only secure HttpOnly strict and bounded by token expiry', () => {
  const now = 1_800_000_000;
  const token = fakeJwt(now + 1800);
  const value = sessionCookie(token, now);
  assert.match(value, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(value, /Max-Age=1800/);
  assert.match(value, /Path=\//);
  assert.match(value, /Secure/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Strict/);
  assert.doesNotMatch(value, /Domain=/i);
});

test('session cookie lifetime never exceeds one hour', () => {
  const now = 1_800_000_000;
  assert.match(sessionCookie(fakeJwt(now + 7200), now), /Max-Age=3600/);
});

test('expired token cannot create a server session cookie', () => {
  const now = 1_800_000_000;
  assert.throws(() => sessionCookie(fakeJwt(now), now), /expired/i);
});

test('logout cookie invalidates the host-only session immediately', () => {
  const value = clearSessionCookie();
  assert.match(value, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(value, /Max-Age=0/);
  assert.match(value, /Secure/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Strict/);
});
