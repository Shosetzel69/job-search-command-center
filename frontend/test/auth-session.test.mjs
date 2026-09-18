import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_AUTO_RESTORE_DISABLED_KEY,
  GOOGLE_LOGIN_HINT_KEY,
  autoRestoreDisabled,
  disableAutoRestore,
  googleIdentityOptions,
  isProtectedAuthFailure,
  readGoogleLoginHint,
  rememberGoogleLoginHint,
} from '../src/auth-session.mjs';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
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
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(readGoogleLoginHint(storage), null);
  assert.equal(rememberGoogleLoginHint('allowed@example.test', storage), null);
});

test('rememberGoogleLoginHint stores successful account and re-enables restore', () => {
  const storage = memoryStorage({ [GOOGLE_AUTO_RESTORE_DISABLED_KEY]:'1' });
  assert.equal(rememberGoogleLoginHint(' allowed@example.test ', storage), 'allowed@example.test');
  assert.equal(storage.getItem(GOOGLE_LOGIN_HINT_KEY), 'allowed@example.test');
  assert.equal(storage.getItem(GOOGLE_AUTO_RESTORE_DISABLED_KEY), null);
  assert.equal(rememberGoogleLoginHint('', storage), null);
});

test('Google Identity auto restore requires a remembered account and remains suppressible after logout', () => {
  const received = [];
  const storage = memoryStorage();
  const enabled = googleIdentityOptions({
    clientId: 'client-id',
    loginHint: 'allowed@example.test',
    allowAutoRestore: true,
    storage,
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
    storage,
    onCredential() {},
  });
  assert.equal(disabled.login_hint, 'allowed@example.test');
  assert.equal(disabled.auto_select, false);
  assert.equal(autoRestoreDisabled(storage), true);
});

test('persisted logout marker prevents automatic restore on a later page load', () => {
  const storage = memoryStorage({ [GOOGLE_AUTO_RESTORE_DISABLED_KEY]:'1' });
  const options = googleIdentityOptions({
    clientId:'client-id',
    loginHint:'allowed@example.test',
    allowAutoRestore:true,
    storage,
    onCredential() {},
  });
  assert.equal(options.auto_select, false);
  disableAutoRestore(storage);
  assert.equal(storage.getItem(GOOGLE_AUTO_RESTORE_DISABLED_KEY), '1');
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

test('same-origin auth failures force reauthentication without treating policy 403 as session loss', () => {
  const target = { location:{ href:'https://app.example.test/', origin:'https://app.example.test' } };
  assert.equal(isProtectedAuthFailure('/data/jobs.json', { status:401 }, target), true);
  assert.equal(isProtectedAuthFailure('/data/jobs.json', { status:403 }, target), true);
  assert.equal(isProtectedAuthFailure('/commands/run', { status:401 }, target), true);
  assert.equal(isProtectedAuthFailure('/auth/session', { status:401 }, target), false);
  assert.equal(isProtectedAuthFailure('/commands/run', { status:403 }, target), false);
  assert.equal(isProtectedAuthFailure('https://other.example.test/x', { status:401 }, target), false);
});
