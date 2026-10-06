import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_AUTO_RESTORE_DISABLED_KEY,
  GOOGLE_LOGIN_HINT_KEY,
  autoRestoreDisabled,
  disableAutoRestore,
  googleIdentityOptions,
  isProtectedAuthFailure,
  installAuthFailureReload,
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


test('protected 401 schedules visible reauthentication and disables automatic restore', async () => {
  const storage = memoryStorage();
  let reloads = 0;
  const target = {
    location:{
      href:'https://app.example.test/',
      origin:'https://app.example.test',
      reload(){ reloads += 1; },
    },
    localStorage:storage,
    fetch:async () => ({ status:401 }),
    setTimeout(callback){ callback(); },
  };
  assert.equal(installAuthFailureReload(target), true);
  const response = await target.fetch('/me/jobs');
  assert.equal(response.status, 401);
  assert.equal(storage.getItem(GOOGLE_AUTO_RESTORE_DISABLED_KEY), '1');
  assert.equal(reloads, 1);
});

test('only same-origin protected 401 responses trigger forced reauthentication', () => {
  const target = { location:{ href:'https://app.example.test/', origin:'https://app.example.test' } };
  assert.equal(isProtectedAuthFailure('/me/jobs', { status:401 }, target), true);
  assert.equal(isProtectedAuthFailure('/me/refresh', { status:401 }, target), true);
  assert.equal(isProtectedAuthFailure('/auth/session', { status:401 }, target), false);
  assert.equal(isProtectedAuthFailure('/me/refresh', { status:403 }, target), false);
  assert.equal(isProtectedAuthFailure('https://other.example.test/x', { status:401 }, target), false);
});
