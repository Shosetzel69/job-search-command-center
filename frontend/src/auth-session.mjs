export const GOOGLE_LOGIN_HINT_KEY = 'jobSearchGoogleLoginHint';

export function readGoogleLoginHint(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem?.(GOOGLE_LOGIN_HINT_KEY);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function rememberGoogleLoginHint(email, storage = globalThis.localStorage) {
  const normalized = typeof email === 'string' ? email.trim() : '';
  if (!normalized) return null;
  try {
    storage?.setItem?.(GOOGLE_LOGIN_HINT_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export function googleIdentityOptions({ clientId, loginHint, allowAutoRestore = true, onCredential }) {
  if (!clientId) throw new Error('Google client ID is required');
  if (typeof onCredential !== 'function') throw new Error('Google credential callback is required');
  const normalizedHint = typeof loginHint === 'string' && loginHint.trim() ? loginHint.trim() : null;
  return {
    client_id: clientId,
    callback: ({ credential }) => {
      if (credential) onCredential(credential);
    },
    auto_select: Boolean(normalizedHint && allowAutoRestore),
    cancel_on_tap_outside: true,
    ...(normalizedHint ? { login_hint: normalizedHint } : {}),
  };
}
