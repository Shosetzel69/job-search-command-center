export const GOOGLE_LOGIN_HINT_KEY = 'jobSearchGoogleLoginHint';
export const GOOGLE_AUTO_RESTORE_DISABLED_KEY = 'jobSearchGoogleAutoRestoreDisabled';
export const COOKIE_SESSION_BEARER = '__JSCC_COOKIE_SESSION__';

let cookieRestorePromise = null;
let cookieRestoreDelivered = false;
let authFailureReloadScheduled = false;
let logoutClearRequested = false;

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function readGoogleLoginHint(storage = browserStorage()) {
  try {
    const value = storage?.getItem?.(GOOGLE_LOGIN_HINT_KEY);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function rememberGoogleLoginHint(email, storage = browserStorage()) {
  const normalized = typeof email === 'string' ? email.trim() : '';
  if (!normalized) return null;
  try {
    storage?.setItem?.(GOOGLE_LOGIN_HINT_KEY, normalized);
    storage?.removeItem?.(GOOGLE_AUTO_RESTORE_DISABLED_KEY);
    logoutClearRequested = false;
    return normalized;
  } catch {
    return null;
  }
}

export function autoRestoreDisabled(storage = browserStorage()) {
  try { return storage?.getItem?.(GOOGLE_AUTO_RESTORE_DISABLED_KEY) === '1'; }
  catch { return false; }
}

export function disableAutoRestore(storage = browserStorage()) {
  try { storage?.setItem?.(GOOGLE_AUTO_RESTORE_DISABLED_KEY, '1'); } catch {}
}

function requestUrl(input, target = globalThis.window) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
    if (!raw) return null;
    return new URL(raw, target?.location?.href || 'https://local.invalid/');
  } catch {
    return null;
  }
}

export function isProtectedAuthFailure(input, response, target = globalThis.window) {
  if (response?.status !== 401) return false;
  const url = requestUrl(input, target);
  if (!url) return false;
  if (target?.location?.origin && url.origin !== target.location.origin) return false;
  return !['/auth/session','/auth/config','/auth/logout','/health'].includes(url.pathname);
}

export function installAuthFailureReload(target = globalThis.window) {
  if (!target?.fetch || target.__jsccAuthFailureGuardInstalled) return false;
  const originalFetch = target.fetch.bind(target);
  target.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (isProtectedAuthFailure(args[0], response, target) && !authFailureReloadScheduled) {
      authFailureReloadScheduled = true;
      let storage = null;
      try { storage = target.localStorage; } catch {}
      disableAutoRestore(storage);
      target.setTimeout?.(() => target.location?.reload?.(), 0);
    }
    return response;
  };
  target.__jsccAuthFailureGuardInstalled = true;
  return true;
}

function clearServerSession(target = globalThis.window) {
  if (!target?.fetch || logoutClearRequested) return;
  logoutClearRequested = true;
  target.fetch('/auth/logout', {
    method:'POST',
    credentials:'same-origin',
    cache:'no-store',
    keepalive:true,
  }).catch(() => {});
}

function restoreServerSession(onCredential, target = globalThis.window) {
  if (!target?.fetch || cookieRestoreDelivered) return;
  if (!cookieRestorePromise) {
    cookieRestorePromise = target.fetch('/auth/session', {
      method:'POST',
      credentials:'same-origin',
      cache:'no-store',
    }).then(response => response.ok).catch(() => false);
  }
  cookieRestorePromise.then(ok => {
    if (!ok || cookieRestoreDelivered) return;
    cookieRestoreDelivered = true;
    onCredential(COOKIE_SESSION_BEARER);
  });
}

export function googleIdentityOptions({ clientId, loginHint, allowAutoRestore = true, onCredential, storage = browserStorage() }) {
  if (!clientId) throw new Error('Google client ID is required');
  if (typeof onCredential !== 'function') throw new Error('Google credential callback is required');
  const normalizedHint = typeof loginHint === 'string' && loginHint.trim() ? loginHint.trim() : null;

  if (!allowAutoRestore) {
    disableAutoRestore(storage);
    if (typeof window !== 'undefined') clearServerSession(window);
  }
  const serverRestoreAllowed = Boolean(allowAutoRestore && !autoRestoreDisabled(storage));
  const effectiveAutoSelect = Boolean(normalizedHint && serverRestoreAllowed);
  let delivered = false;
  const deliver = credential => {
    if (!credential || delivered) return;
    delivered = true;
    onCredential(credential);
  };

  if (serverRestoreAllowed && typeof window !== 'undefined') restoreServerSession(deliver, window);

  return {
    client_id: clientId,
    callback: ({ credential }) => deliver(credential),
    auto_select: effectiveAutoSelect,
    cancel_on_tap_outside: true,
    ...(normalizedHint ? { login_hint: normalizedHint } : {}),
  };
}

if (typeof window !== 'undefined') installAuthFailureReload(window);
