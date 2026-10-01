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

const opaqueToken = 'a'.repeat(43);

test('cookie parser returns only the named session value', () => {
  assert.equal(cookieValue(`other=x; ${SESSION_COOKIE_NAME}=${opaqueToken}; theme=dark`), opaqueToken);
  assert.equal(cookieValue('other=x'), null);
});

test('real bearer token takes precedence over a session cookie only at explicit caller boundary', () => {
  const request = new Request('https://app.example.test/auth/session', {
    headers: { Authorization:'Bearer google-token', Cookie:`${SESSION_COOKIE_NAME}=${opaqueToken}` },
  });
  assert.equal(sessionTokenFromRequest(request), 'google-token');
  assert.equal(withSessionAuthorization(request), request);
});

test('cookie session sentinel resolves to the HttpOnly opaque cookie token', () => {
  const request = new Request('https://app.example.test/data/jobs.json', {
    headers: { Authorization:`Bearer ${COOKIE_SESSION_BEARER}`, Cookie:`${SESSION_COOKIE_NAME}=${opaqueToken}` },
  });
  const authorized = withSessionAuthorization(request);
  assert.equal(sessionTokenFromRequest(request), opaqueToken);
  assert.equal(authorized.headers.get('Authorization'), `Bearer ${opaqueToken}`);
});

test('missing cookie removes the non-secret cookie-session sentinel', () => {
  const request = new Request('https://app.example.test/data/jobs.json', {
    headers: { Authorization:`Bearer ${COOKIE_SESSION_BEARER}` },
  });
  assert.equal(withSessionAuthorization(request).headers.get('Authorization'), null);
});

test('session cookie is opaque host-only secure HttpOnly strict and fixed to one hour', () => {
  const value = sessionCookie(opaqueToken);
  assert.match(value, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(value, /Max-Age=3600/);
  assert.match(value, /Path=\//);
  assert.match(value, /Secure/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Strict/);
  assert.doesNotMatch(value, /Domain=/i);
  assert.doesNotMatch(value, /\./, 'opaque session token is not a JWT');
});

test('JWT-shaped and malformed values cannot create the new session cookie', () => {
  assert.throws(() => sessionCookie('a.b.c'), /invalid opaque token/i);
  assert.throws(() => sessionCookie('short'), /invalid opaque token/i);
});

test('logout cookie invalidates the host-only session immediately', () => {
  const value = clearSessionCookie();
  assert.match(value, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(value, /Max-Age=0/);
  assert.match(value, /Secure/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Strict/);
});
