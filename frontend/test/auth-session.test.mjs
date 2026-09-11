import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_LOGIN_HINT_KEY,
  googleIdentityOptions,
  readGoogleLoginHint,
  rememberGoogleLoginHint,
} from '../src/auth-session.mjs';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test('readGoogleLoginHint returns normalized remembered email', () => {
  const storage = memoryStorage({ [GOOGLE_LOGIN_HINT_KEY]: '  allowed@example.test  ' });
  assert.equal(readGoogleLoginHint(storage), 'allowed@example.test');
});

test('login hint storage failures do not break authentication UI', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readGoogleLoginHint(storage), null);
  assert.equal(rememberGoogleLoginHint('allowed@example.test', storage), null);
});

test('rememberGoogleLoginHint stores only the successful account email', () => {
  const storage = memoryStorage();
  assert.equal(rememberGoogleLoginHint(' allowed@example.test ', storage), 'allowed@example.test');
  assert.equal(storage.getItem(GOOGLE_LOGIN_HINT_KEY), 'allowed@example.test');
  assert.equal(rememberGoogleLoginHint('', storage), null);
});

test('Google Identity auto restore requires a remembered account and remains suppressible after logout', () => {
  const received = [];
  const enabled = googleIdentityOptions({
    clientId: 'client-id',
    loginHint: 'allowed@example.test',
    allowAutoRestore: true,
    onCredential: credential => received.push(credential),
  });
  assert.equal(enabled.login_hint, 'allowed@example.test');
  assert.equal(enabled.auto_select, true);
  enabled.callback({ credential: 'id-token' });
  assert.deepEqual(received, ['id-token']);

  const disabled = googleIdentityOptions({
    clientId: 'client-id',
    loginHint: 'allowed@example.test',
    allowAutoRestore: false,
    onCredential() {},
  });
  assert.equal(disabled.login_hint, 'allowed@example.test');
  assert.equal(disabled.auto_select, false);
});

test('Google Identity stays manual before the first successful login', () => {
  const options = googleIdentityOptions({ clientId: 'client-id', loginHint: null, onCredential() {} });
  assert.equal(options.auto_select, false);
  assert.equal('login_hint' in options, false);
});

test('Google Identity options reject invalid required inputs', () => {
  assert.throws(() => googleIdentityOptions({ clientId: '', onCredential() {} }), /client ID/);
  assert.throws(() => googleIdentityOptions({ clientId: 'client-id', onCredential: null }), /callback/);
});
