import { decodeJwt } from 'jose';

export const SESSION_COOKIE_NAME = '__Host-jscc_session';
export const COOKIE_SESSION_BEARER = '__JSCC_COOKIE_SESSION__';
const MAX_SESSION_SECONDS = 60 * 60;

function bearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export function cookieValue(cookieHeader, name = SESSION_COOKIE_NAME) {
  const prefix = `${name}=`;
  for (const part of String(cookieHeader || '').split(';')) {
    const item = part.trim();
    if (!item.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(item.slice(prefix.length)) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionTokenFromRequest(request) {
  const bearer = bearerToken(request);
  if (bearer && bearer !== COOKIE_SESSION_BEARER) return bearer;
  const cookieToken = cookieValue(request.headers.get('Cookie'));
  if (bearer === COOKIE_SESSION_BEARER) return cookieToken;
  return cookieToken || bearer;
}

export function withSessionAuthorization(request) {
  const bearer = bearerToken(request);
  if (bearer && bearer !== COOKIE_SESSION_BEARER) return request;

  const headers = new Headers(request.headers);
  const token = sessionTokenFromRequest(request);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return new Request(request, { headers });
}

export function sessionCookie(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  let payload;
  try {
    payload = decodeJwt(token);
  } catch {
    throw new Error('Cannot create session cookie from an invalid Google ID token');
  }
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= nowSeconds) {
    throw new Error('Cannot create session cookie from an expired Google ID token');
  }
  const maxAge = Math.max(1, Math.min(MAX_SESSION_SECONDS, Math.floor(exp - nowSeconds)));
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`;
}
