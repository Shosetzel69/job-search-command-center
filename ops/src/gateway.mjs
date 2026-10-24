import http from 'node:http';
import OAuth2Server from '@node-oauth/oauth2-server';
import * as oidc from 'openid-client';
import { CLAUDE_ID, CLAUDE_REDIRECT, CLAUDE_SCOPES, REFRESH_TTL_MS, knownClient, normalizeRegistration, allowedScopes, safeAuthReason } from './claude-oauth.mjs';
import {
  ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS, CATALOG_VERSION, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT_URI, TASK_CATALOG, OBSERVE_TIMEOUT_MS, REQUIRED_AUDIENCE,
  REQUIRED_SCOPE, STATE_TTL_MS, VERIFY_TIMEOUT_MS, acquireLease, consumeJson, envConfig, gcpFetch,
  gcsReadJson, gcsReplaceJson, gcsWriteJson, incrementDailyCounter, isoNow,
  normalizeExecutionName, operationObject, authenticatedEvidence, accessTokenRecordError, authorizationCodeRecordError,
  randomToken, releaseLease, resolveIdempotencyReservation, sha256, isAllowedChatGptClientId, validateChatGptRedirectUris, validateTaskRequest
} from './lib.mjs';

const cfg = envConfig();
const PORT = Number(process.env.PORT || 8080);

function oauthClient(clientId) {
  return knownClient(clientId, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT_URI, cfg.legacyChatgptClientId);
}
function chatGptClient(clientId) {
  return isAllowedChatGptClientId(clientId, cfg.legacyChatgptClientId) ? oauthClient(clientId) : false;
}
function authReject(route, reason) {
  console.warn(JSON.stringify({event:'oauth_rejection',route,reason:safeAuthReason(reason)}));
}

const { Request: OAuthRequest, Response: OAuthResponse } = OAuth2Server;
let googleConfigPromise;
function googleConfig() {
  if (!googleConfigPromise) {
    googleConfigPromise = oidc.discovery(
      new URL('https://accounts.google.com'),
      cfg.googleClientId,
      cfg.googleClientSecret
    );
  }
  return googleConfigPromise;
}

const oauthModel = {
  generateAuthorizationCode: async () => randomToken(32),
  generateAccessToken: async () => randomToken(32),
  getClient: async (clientId, clientSecret) => {
    if (clientSecret) return false;
    return oauthClient(clientId);
  },
  validateRedirectUri: async (redirectUri, client) => (
    Boolean(oauthClient(client?.id)) && oauthClient(client?.id).redirectUris.includes(redirectUri)
  ),
  validateScope: async (_user, client, scope) => {
    const values = Array.isArray(scope) ? scope : String(scope || '').split(/\s+/).filter(Boolean);
    return oauthClient(client?.id) && allowedScopes(client?.id,values) ? values : false;
  },
  verifyScope: async (token, scope) => {
    const required = Array.isArray(scope) ? scope : String(scope || '').split(/\s+/).filter(Boolean);
    const actual = Array.isArray(token.scope) ? token.scope : String(token.scope || '').split(/\s+/).filter(Boolean);
    return required.every(v => actual.includes(v));
  },
  saveAuthorizationCode: async (code, client, user) => {
    const record = {
      consumed:false,
      expires_at_ms:new Date(code.expiresAt).getTime(),
      redirect_uri:code.redirectUri,
      scope:code.scope,
      code_challenge:code.codeChallenge || null,
      code_challenge_method:code.codeChallengeMethod || null,
      client_id:client.id,
      user,
    };
    await gcsWriteJson(cfg.bucket, `auth/codes/${sha256(code.authorizationCode)}.json`, record, 0);
    return { ...code, client, user };
  },
  getAuthorizationCode: async (authorizationCode) => {
    const rec = await gcsReadJson(cfg.bucket, `auth/codes/${sha256(authorizationCode)}.json`);
    if (authorizationCodeRecordError(rec?.data)) return false;
    const client = oauthClient(rec.data.client_id);
    if (!client) return false;
    return {
      authorizationCode,
      expiresAt:new Date(rec.data.expires_at_ms),
      redirectUri:rec.data.redirect_uri,
      scope:rec.data.scope,
      codeChallenge:rec.data.code_challenge,
      codeChallengeMethod:rec.data.code_challenge_method,
      client,
      user:rec.data.user,
    };
  },
  revokeAuthorizationCode: async (code) => {
    const name = `auth/codes/${sha256(code.authorizationCode)}.json`;
    const rec = await gcsReadJson(cfg.bucket, name);
    if (!rec || rec.data.consumed) return false;
    await gcsReplaceJson(cfg.bucket, name, { ...rec.data, consumed:true, consumed_at:isoNow() }, rec.generation);
    return true;
  },
  generateRefreshToken: async () => randomToken(48),
  saveToken: async (token, client, user) => {
    const expiresAt = token.accessTokenExpiresAt || new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    const familyId=client.id===CLAUDE_ID ? (user.refresh_family || randomToken(24)) : null;
    if (familyId) {
      const familyKey=`auth/families/${sha256(familyId)}.json`;
      if (!user.refresh_family) await gcsWriteJson(cfg.bucket,familyKey,{revoked:false,created_at:isoNow()},0);
      const family=await gcsReadJson(cfg.bucket,familyKey);
      if (!family || family.data.revoked) throw new Error('refresh_family_revoked');
    }
    const record = {
      ...(familyId ? {refresh_family:familyId} : {}),
      revoked:false,
      expires_at_ms:new Date(expiresAt).getTime(),
      scope:token.scope,
      audience:user.audience,
      resource:user.resource,
      actor_sub:user.id,
      client_id:client.id,
      issued_at:isoNow(),
    };
    await gcsWriteJson(cfg.bucket, `auth/tokens/${sha256(token.accessToken)}.json`, record, 0);
    if (client.id === CLAUDE_ID && token.refreshToken) {
      await gcsWriteJson(cfg.bucket, `auth/refresh/${sha256(token.refreshToken)}.json`, {
        ...record, expires_at_ms:new Date(token.refreshTokenExpiresAt || Date.now()+REFRESH_TTL_MS).getTime(),
        revoked:false, rotated:false
      }, 0);
    }
    return {
      accessToken:token.accessToken,
      accessTokenExpiresAt:new Date(expiresAt),
      ...(client.id === CLAUDE_ID && token.refreshToken ? {refreshToken:token.refreshToken,refreshTokenExpiresAt:token.refreshTokenExpiresAt || new Date(Date.now()+REFRESH_TTL_MS)} : {}),
      scope:token.scope,
      client,
      user,
    };
  },
  getRefreshToken: async refreshToken => {
    const rec=await gcsReadJson(cfg.bucket,`auth/refresh/${sha256(refreshToken)}.json`);
    if (!rec?.data || rec.data.client_id!==CLAUDE_ID || !rec.data.refresh_family) return false;
    const familyKey=`auth/families/${sha256(rec.data.refresh_family)}.json`;
    const family=await gcsReadJson(cfg.bucket,familyKey);
    if (!family || family.data.revoked) return false;
    if (rec.data.rotated) {
      try { await gcsReplaceJson(cfg.bucket,familyKey,{...family.data,revoked:true,reuse_detected_at:isoNow()},family.generation); }
      catch(e) { if(e.message!=='generation_precondition_failed') throw e; }
      authReject('/token','refresh_token_reuse_family_revoked');
      return false;
    }
    if (rec.data.revoked || rec.data.expires_at_ms<=Date.now()) return false;
    return {refreshToken,refreshTokenExpiresAt:new Date(rec.data.expires_at_ms),scope:rec.data.scope,client:oauthClient(CLAUDE_ID),user:{id:rec.data.actor_sub,audience:rec.data.audience,resource:rec.data.resource,refresh_family:rec.data.refresh_family}};
  },
  revokeToken: async token => {
    if (!token?.refreshToken) return false;
    const name=`auth/refresh/${sha256(token.refreshToken)}.json`;
    const rec=await gcsReadJson(cfg.bucket,name);
    if (!rec || rec.data.rotated || rec.data.revoked) return false;
    try { await gcsReplaceJson(cfg.bucket,name,{...rec.data,rotated:true,rotated_at:isoNow()},rec.generation);return true; }
    catch(e) { if(e.message==='generation_precondition_failed') return false;throw e; }
  },
  getAccessToken: async (accessToken) => {
    const rec = await gcsReadJson(cfg.bucket, `auth/tokens/${sha256(accessToken)}.json`);
    if (accessTokenRecordError(rec?.data)) return false;
    const client = oauthClient(rec.data.client_id);
    if (!client) return false;
    if (client.id===CLAUDE_ID) {
      if (!rec.data.refresh_family) return false;
      const family=await gcsReadJson(cfg.bucket,`auth/families/${sha256(rec.data.refresh_family)}.json`);
      if (!family || family.data.revoked) return false;
    }
    return {
      accessToken,
      accessTokenExpiresAt:new Date(rec.data.expires_at_ms),
      scope:rec.data.scope,
      client,
      user:{ id:rec.data.actor_sub, audience:rec.data.audience, resource:rec.data.resource },
    };
  },
};

const oauth = new OAuth2Server({
  model:oauthModel,
  authorizationCodeLifetime:AUTH_CODE_TTL_MS / 1000,
  accessTokenLifetime:ACCESS_TOKEN_TTL_MS / 1000,
  refreshTokenLifetime:REFRESH_TTL_MS/1000,
  requireClientAuthentication:{ authorization_code:false,refresh_token:false },
});

function makeOAuthRequest({ method='GET', headers={}, query={}, body={} } = {}) {
  return new OAuthRequest({ method, headers, query, body });
}
function makeOAuthResponse() {
  return new OAuthResponse({ headers:{} });
}

function base(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${req.headers.host}`;
}
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function sendText(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 256 * 1024) throw new Error('request_too_large');
  }
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch { throw new Error('invalid_json'); }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}
function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}
async function authenticate(req) {
  try {
    const token = await oauth.authenticate(
      makeOAuthRequest({ method:req.method, headers:req.headers }),
      makeOAuthResponse(),
      { scope:REQUIRED_SCOPE }
    );
    if (token?.user?.audience !== REQUIRED_AUDIENCE) return { ok:false, error:'wrong_audience' };
    if (token?.user?.resource !== `${base(req)}/mcp`) return { ok:false, error:'wrong_resource' };
    return { ok:true, record:{ actor_sub:token.user.id, scope:REQUIRED_SCOPE, audience:REQUIRED_AUDIENCE } };
  } catch {
    return { ok:false, error:'invalid_token' };
  }
}
function unauthorized(req, res, error) {
  sendJson(res, 401, { error }, { 'www-authenticate': `Bearer resource_metadata="${base(req)}/.well-known/oauth-protected-resource", error="${error}"` });
}

async function runDiagnosticsJob() {
  const url = `https://run.googleapis.com/v2/projects/${cfg.project}/locations/${cfg.region}/jobs/${cfg.diagnosticsJob}:run`;
  const r = await gcpFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error(`run_job_${r.status}`);
  return r.json();
}
function extractExecutionName(op) {
  const values = [op?.response?.name, op?.metadata?.name, op?.metadata?.execution, op?.metadata?.target];
  for (const v of values) {
    if (typeof v === 'string' && v.includes('/executions/')) return normalizeExecutionName(v);
    if (typeof v === 'string' && /^jscc-diagnostics-dev-/.test(v)) return normalizeExecutionName(v);
  }
  return null;
}
async function resolveExecution(lro) {
  let op = lro;
  for (let i = 0; i < 120; i++) {
    const direct = extractExecutionName(op);
    if (direct) return direct;
    if (!op?.name) break;
    await new Promise(r => setTimeout(r, 500));
    const r = await gcpFetch(`https://run.googleapis.com/v2/${op.name}`);
    if (!r.ok) throw new Error(`run_operation_read_${r.status}`);
    op = await r.json();
  }
  throw new Error('execution_binding_unresolved');
}
async function updateOperation(operationId, mutate) {
  const name = `operations/${operationId}.json`;
  for (let i = 0; i < 4; i++) {
    const cur = await gcsReadJson(cfg.bucket, name);
    if (!cur) throw new Error('operation_not_found');
    const next = { ...cur.data, ...mutate(cur.data), updated_at: isoNow() };
    try { await gcsReplaceJson(cfg.bucket, name, next, cur.generation); return next; }
    catch (e) { if (e.message !== 'generation_precondition_failed') throw e; }
  }
  throw new Error('operation_update_contention');
}
async function acceptOperation(auth, toolArgs) {
  const workItem = String(toolArgs.work_item_ref || '').trim();
  const idem = String(toolArgs.idempotency_key || '').trim();
  if (!/^#[0-9]{1,8}$/.test(workItem)) throw new Error('invalid_work_item_ref');
  if (!/^[A-Za-z0-9._:-]{12,128}$/.test(idem)) throw new Error('invalid_idempotency_key');

  const taskReq = validateTaskRequest(toolArgs.task, toolArgs.args || {});
  const idemHash = sha256(idem);
  const requestHash = sha256(JSON.stringify({ work_item_ref: workItem, task: taskReq.task, args: taskReq.args }));
  const idemName = `idempotency/${idemHash}.json`;

  const returnExisting = async () => {
    const existing = await gcsReadJson(cfg.bucket, idemName);
    return resolveIdempotencyReservation(existing?.data, requestHash);
  };

  const existing = await gcsReadJson(cfg.bucket, idemName);
  if (existing) return returnExisting();

  const timeout = taskReq.task_class === 'VERIFY' ? VERIFY_TIMEOUT_MS : OBSERVE_TIMEOUT_MS;
  const opId = `op-${Date.now().toString(36)}-${randomToken(8).toLowerCase().replace(/_/g,'-')}`;
  const reservation = { operation_id: opId, request_hash: requestHash, created_at: isoNow() };

  try {
    await gcsWriteJson(cfg.bucket, idemName, reservation, 0);
  } catch (e) {
    if (e.message === 'generation_precondition_failed') return returnExisting();
    throw e;
  }

  const op = operationObject(opId, taskReq, {
    work_item_ref: workItem,
    idempotency_key_hash: idemHash,
    actor_sub_hash: sha256(auth.record.actor_sub),
    ops_source_sha: cfg.opsSourceSha,
    gateway_image_digest: cfg.gatewayDigest,
    worker_image_digest: cfg.workerDigest,
  });

  try {
    await gcsWriteJson(cfg.bucket, `operations/${opId}.json`, op, 0);
    await incrementDailyCounter(cfg.bucket, new Date().toISOString().slice(0,10));
    await acquireLease(cfg.bucket, opId, timeout + 60_000);

    const lro = await runDiagnosticsJob();
    const execution = await resolveExecution(lro);
    const dispatch = {
      schema_version: '1.0', operation_id: opId, work_item_ref: workItem, execution_name: execution, task: op.task,
      task_class: op.task_class, args: op.args, catalog_version: CATALOG_VERSION,
      ops_source_sha: cfg.opsSourceSha, worker_image_digest: cfg.workerDigest,
      expires_at_ms: Date.now() + timeout, created_at: isoNow(),
    };
    await gcsWriteJson(cfg.bucket, `dispatch/${execution}.json`, dispatch, 0);
    await updateOperation(opId, () => ({ operation_state: 'RUNNING', execution_name: execution, started_at: isoNow() }));
    return { operation_id: opId, duplicate: false, operation_state: 'RUNNING' };
  } catch (e) {
    const preDispatch = ['daily_operation_limit','diagnostic_already_active'].includes(e.message);
    try {
      await updateOperation(opId, () => ({
        operation_state: preDispatch ? 'REJECTED' : 'FAILED',
        coarse_error: preDispatch ? e.message : 'dispatch_failed',
        finished_at: isoNow()
      }));
    } catch {}
    try { await releaseLease(cfg.bucket, opId); } catch {}
    throw e;
  }
}

async function getOperation(id) {
  const opId = String(id || '').trim();
  if (!/^op-[a-z0-9_-]{10,100}$/.test(opId)) throw new Error('invalid_operation_id');
  const rec = await gcsReadJson(cfg.bucket, `operations/${opId}.json`);
  if (!rec) throw new Error('operation_not_found');
  const result = await gcsReadJson(cfg.bucket, `results/${opId}.json`);
  return result ? authenticatedEvidence({ ...rec.data, ...result.data }) : authenticatedEvidence(rec.data);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, base(req));
    const issuer = base(req);
    if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true, component: 'jscc-ops-gateway-dev', privileged: true, project: cfg.project, catalog_version: CATALOG_VERSION });
    if (req.method === 'GET' && u.pathname === '/.well-known/oauth-protected-resource') return sendJson(res, 200, { resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: [REQUIRED_SCOPE], bearer_methods_supported: ['header'] });
    if (req.method === 'GET' && (u.pathname === '/.well-known/oauth-authorization-server' || u.pathname === '/.well-known/openid-configuration')) {
      return sendJson(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, revocation_endpoint: `${issuer}/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'], code_challenge_methods_supported: ['S256'], scopes_supported: CLAUDE_SCOPES, token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true });
    }
    if (req.method === 'POST' && u.pathname === '/register') {
      let body;
      try { body = await readBody(req); } catch(e) { authReject('/register',e.message);return sendJson(res,400,{error:'invalid_request'}); }
      let registration;
      try { registration = normalizeRegistration(body,CHATGPT_REDIRECT_URI); }
      catch(e) { authReject('/register',e.message); return sendJson(res,400,{error:'invalid_client_metadata',error_description:safeAuthReason(e.message)}); }
      return sendJson(res,201,{
        client_id:registration.id || CHATGPT_CLIENT_ID,
        redirect_uris:[registration.redirect],
        token_endpoint_auth_method:'none',
        grant_types:registration.grants,
        response_types:['code'],
        code_challenge_methods_supported:['S256'],
        ...(registration.id===CLAUDE_ID?{scope:CLAUDE_SCOPES.join(' ')}:{})
      });
    }
    if (req.method === 'GET' && u.pathname === '/authorize') {
      if (!(cfg.googleClientId && cfg.googleClientSecret && cfg.googleAllowedSub)) {authReject('/authorize','oauth_not_configured');return sendText(res,503,'oauth_not_configured');}
      const q = u.searchParams;
      const clientId = q.get('client_id') || '';
      const redirectUri = q.get('redirect_uri') || '';
      const clientState = q.get('state') || '';
      const challenge = q.get('code_challenge') || '';
      const method = q.get('code_challenge_method') || '';
      const scope = q.get('scope') || '';
      const resource = q.get('resource') || '';
      if (!oauthClient(clientId) || !oauthClient(clientId).redirectUris.includes(redirectUri)) { authReject('/authorize','invalid_client_or_redirect');return sendText(res,400,'invalid_client_or_redirect'); }
      if (q.get('response_type') !== 'code') {authReject('/authorize','unsupported_response_type');return sendText(res,400,'unsupported_response_type');}
      if (method !== 'S256' || !challenge) {authReject('/authorize','pkce_s256_required');return sendText(res,400,'pkce_s256_required');}
      if (!allowedScopes(clientId,scope.split(/\s+/).filter(Boolean)) || !scope.split(/\s+/).includes(REQUIRED_SCOPE)) {authReject('/authorize','invalid_scope');return sendText(res,400,'invalid_scope');}
      if (resource !== `${issuer}/mcp`) {authReject('/authorize','invalid_resource');return sendText(res,400,'invalid_resource');}

      const upstreamState = oidc.randomState();
      const nonce = oidc.randomNonce();
      const googleVerifier = oidc.randomPKCECodeVerifier();
      const googleChallenge = await oidc.calculatePKCECodeChallenge(googleVerifier);
      await gcsWriteJson(cfg.bucket, `auth/upstream/${sha256(upstreamState)}.json`, {
        consumed:false,
        expires_at_ms:Date.now()+STATE_TTL_MS,
        client_id:clientId,
        redirect_uri:redirectUri,
        client_state:clientState,
        scope,
        resource,
        code_challenge:challenge,
        code_challenge_method:method,
        nonce,
        google_code_verifier:googleVerifier
      }, 0);

      const redirect = `${issuer}/oauth/google/callback`;
      const gc = await googleConfig();
      const redirectTo = oidc.buildAuthorizationUrl(gc, {
        redirect_uri:redirect,
        scope:'openid',
        state:upstreamState,
        nonce,
        code_challenge:googleChallenge,
        code_challenge_method:'S256',
        prompt:'select_account'
      });
      res.writeHead(302, { location: redirectTo.href, 'cache-control': 'no-store' }); return res.end();
    }
    if (req.method === 'GET' && u.pathname === '/oauth/google/callback') {
      const upstreamState = u.searchParams.get('state') || '';
      if (!upstreamState || !u.searchParams.get('code')) return sendText(res, 400, 'invalid_callback');
      let st;
      try { st = await consumeJson(cfg.bucket, `auth/upstream/${sha256(upstreamState)}.json`); }
      catch { return sendText(res, 400, 'invalid_or_expired_upstream_state'); }

      const redirect = `${issuer}/oauth/google/callback`;
      const gc = await googleConfig();
      const currentUrl = new URL(req.url, issuer);
      let tokens;
      try {
        tokens = await oidc.authorizationCodeGrant(gc, currentUrl, {
          pkceCodeVerifier:st.google_code_verifier,
          expectedState:upstreamState,
          expectedNonce:st.nonce,
          idTokenExpected:true
        });
      } catch {
        return sendText(res, 400, 'google_oidc_validation_failed');
      }
      const claims = tokens.claims();
      if (!claims?.sub || claims.sub !== cfg.googleAllowedSub) return sendText(res, 403, 'unapproved_google_subject');

      const authRequest = makeOAuthRequest({
        method:'GET',
        query:{
          client_id:st.client_id,
          redirect_uri:st.redirect_uri,
          response_type:'code',
          state:st.client_state,
          scope:st.scope,
          code_challenge:st.code_challenge,
          code_challenge_method:st.code_challenge_method
        }
      });
      let code;
      try {
        code = await oauth.authorize(authRequest, makeOAuthResponse(), {
          authorizationCodeLifetime:AUTH_CODE_TTL_MS/1000,
          authenticateHandler:{ handle:async()=>({ id:claims.sub, audience:REQUIRED_AUDIENCE, resource:st.resource }) }
        });
      } catch {
        return sendText(res, 400, 'authorization_failed');
      }
      const out = new URL(st.redirect_uri);
      out.searchParams.set('code', code.authorizationCode);
      out.searchParams.set('iss', issuer);
      if (st.client_state) out.searchParams.set('state', st.client_state);
      res.writeHead(302, { location: out.toString(), 'cache-control': 'no-store' }); return res.end();
    }
    if (req.method === 'POST' && u.pathname === '/token') {
      let body;
      try { body = await readBody(req); } catch(e) {authReject('/token',e.message);return sendJson(res,400,{error:'invalid_request'});}
      if (body.resource !== `${issuer}/mcp` && !(body.grant_type==='refresh_token' && !body.resource)) { authReject('/token','invalid_target'); return sendJson(res,400,{error:'invalid_target'}); }
      let token;
      try {
        token = await oauth.token(
          makeOAuthRequest({ method:'POST', headers:req.headers, body }),
          makeOAuthResponse(),
          {
            accessTokenLifetime:ACCESS_TOKEN_TTL_MS/1000,
            requireClientAuthentication:{ authorization_code:false,refresh_token:false },
            refreshTokenLifetime:REFRESH_TTL_MS/1000
          }
        );
      } catch(e) {
        authReject('/token',e?.name === 'InvalidClientError' ? 'invalid_client' : e?.name === 'InvalidScopeError' ? 'invalid_scope' : e?.name === 'InvalidGrantError' ? 'invalid_grant' : 'token_exchange_failed');
        return sendJson(res, 400, { error:'invalid_grant' });
      }
      const expiresAt = new Date(token.accessTokenExpiresAt).getTime();
      return sendJson(res, 200, {
        access_token:token.accessToken,
        token_type:'Bearer',
        expires_in:Math.max(0, Math.floor((expiresAt-Date.now())/1000)),
        scope:Array.isArray(token.scope) ? token.scope.join(' ') : String(token.scope || REQUIRED_SCOPE),
        ...(token.refreshToken?{refresh_token:token.refreshToken}:{})
      });
    }
    if (req.method === 'POST' && u.pathname === '/revoke') {
      const body = await readBody(req);
      const isRefresh = body.token_type_hint === 'refresh_token';
      const name = `${isRefresh ? 'auth/refresh' : 'auth/tokens'}/${sha256(body.token || '')}.json`;
      const cur = await gcsReadJson(cfg.bucket, name);
      if (cur) {
        try { await gcsReplaceJson(cfg.bucket, name, { ...cur.data, revoked:true, revoked_at:isoNow() }, cur.generation); }
        catch(e) { if(e.message !== 'generation_precondition_failed') throw e; }
      }
      res.writeHead(200, { 'cache-control': 'no-store' }); return res.end();
    }
    if (u.pathname === '/mcp') {
      const auth = await authenticate(req); if (!auth.ok) return unauthorized(req, res, auth.error);
      if (req.method !== 'POST') return sendText(res, 405, 'POST required');
      const body = await readBody(req), id = body.id ?? null;
      if (body.method === 'initialize') return sendJson(res, 200, { jsonrpc: '2.0', id, result: { protocolVersion: body.params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'jscc-ops-gateway-dev', version: '1.0.0' } } });
      if (body.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      if (body.method === 'tools/list') return sendJson(res, 200, { jsonrpc: '2.0', id, result: { tools: [
        { name: 'auth_check', description: 'Return non-sensitive authentication metadata.', inputSchema: { type:'object',properties:{},additionalProperties:false } },
        { name: 'run_operation', description: 'Run an allowlisted DEV diagnostic or verification operation.', inputSchema: { type:'object', required:['work_item_ref','idempotency_key','task','args'], additionalProperties:false, properties:{ work_item_ref:{type:'string'}, idempotency_key:{type:'string'}, task:{type:'string',enum:Object.keys(TASK_CATALOG)}, args:{type:'object'} } } },
        { name: 'get_operation', description: 'Read sanitized operation state/evidence.', inputSchema: { type:'object',required:['operation_id'],additionalProperties:false,properties:{operation_id:{type:'string'}} } }
      ] } });
      if (body.method === 'tools/call' && body.params?.name === 'auth_check') return sendJson(res, 200, { jsonrpc:'2.0', id, result:{content:[{type:'text',text:JSON.stringify({authenticated:true,scope:REQUIRED_SCOPE,audience:REQUIRED_AUDIENCE,token_ttl_class:'short',gcp_credential_exposed:false,privileged:true,project:cfg.project})}]}});
      if (body.method === 'tools/call' && body.params?.name === 'run_operation') {
        try { const out = await acceptOperation(auth, body.params.arguments || {}); return sendJson(res,200,{jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(out)}]}}); }
        catch (e) { return sendJson(res,200,{jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify({error:e.message})}]}}); }
      }
      if (body.method === 'tools/call' && body.params?.name === 'get_operation') {
        try { const out = await getOperation(body.params.arguments?.operation_id); return sendJson(res,200,{jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(out)}]}}); }
        catch (e) { return sendJson(res,200,{jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:JSON.stringify({error:e.message})}]}}); }
      }
      return sendJson(res, 200, { jsonrpc:'2.0', id, error:{code:-32601,message:'Method not found'} });
    }
    return sendText(res, 404, 'not found');
  } catch (e) {
    console.error(JSON.stringify({ event:'gateway_error', error:String(e?.message || 'unknown') }));
    return sendJson(res, 500, { error:'internal_error' });
  }
});

server.listen(PORT, () => console.log(JSON.stringify({ event:'startup', component:'jscc-ops-gateway-dev', project:cfg.project, region:cfg.region, catalog_version:CATALOG_VERSION })));
