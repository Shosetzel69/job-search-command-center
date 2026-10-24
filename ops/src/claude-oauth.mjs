import {createHash} from 'node:crypto';
export const CLAUDE_ID = 'claude-jscc-dev';
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const CLAUDE_SCOPES = ['jscc.ops.dev','jscc.dev.write'];
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export function knownClient(id, chatgptId, chatgptRedirect, legacy='') {
  if (id === CLAUDE_ID) return {id:CLAUDE_ID,grants:['authorization_code','refresh_token'],redirectUris:[CLAUDE_REDIRECT]};
  if (id === chatgptId || (legacy && id === legacy)) return {id,grants:['authorization_code'],redirectUris:[chatgptRedirect]};
  return false;
}
export function normalizeRegistration(body, chatgptRedirect) {
  if (!body || !Array.isArray(body.redirect_uris) || body.redirect_uris.length!==1) throw Error('invalid_redirect_uris');
  const redirect=body.redirect_uris[0];
  const claude=redirect===CLAUDE_REDIRECT;
  if (!claude && redirect!==chatgptRedirect) throw Error('redirect_uri_not_allowlisted');
  // Public PKCE S256 clients: ignore requested secret-based auth and unsupported grant requests.
  return {id:claude?CLAUDE_ID:null,redirect,grants:claude?['authorization_code','refresh_token']:['authorization_code'],authMethod:'none'};
}
export function allowedScopes(id, values) {
  return Array.isArray(values) && values.length>0 && new Set(values).size===values.length &&
    values.every(s=>(id===CLAUDE_ID?CLAUDE_SCOPES:['jscc.ops.dev']).includes(s));
}
export function safeAuthReason(value) {
  const reason=String(value||'unknown');
  return /^[a-z][a-z0-9_]{0,80}$/.test(reason)?reason:'invalid_request';
}
