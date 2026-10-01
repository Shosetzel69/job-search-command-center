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
  const cookieToken = cookieValue(request.headers.get('Cookie'));
  if (bearer === COOKIE_SESSION_BEARER) return cookieToken;
  return bearer || cookieToken || null;
}

export function withSessionAuthorization(request) {
  const bearer = bearerToken(request);
  if (bearer && bearer !== COOKIE_SESSION_BEARER) return request;
  const headers = new Headers(request.headers);
  const token = cookieValue(request.headers.get('Cookie'));
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return new Request(request, { headers });
}

export function sessionCookie(token) {
  const value = String(token || '');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) {
    throw new Error('Cannot create session cookie from an invalid opaque token');
  }
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${MAX_SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`;
}
