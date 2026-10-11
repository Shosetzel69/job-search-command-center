import http from 'node:http';
import {
  ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS, CATALOG_VERSION, TASK_CATALOG, OBSERVE_TIMEOUT_MS, REQUIRED_AUDIENCE,
  REQUIRED_SCOPE, STATE_TTL_MS, VERIFY_TIMEOUT_MS, acquireLease, consumeJson, envConfig, gcpFetch,
  gcsReadJson, gcsReplaceJson, gcsWriteJson, incrementDailyCounter, isoNow, logicalTokenError,
  makeSignedClient, makeSignedState, normalizeExecutionName, operationObject, parseSignedClient, parseSignedState, publicEvidence,
  randomToken, releaseLease, sha256, validateTaskRequest, verifyGoogleIdToken
} from './lib.mjs';

const cfg = envConfig();
const PORT = Number(process.env.PORT || 8080);

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
  const raw = bearer(req);
  if (!raw) return { ok: false, error: 'missing_token' };
  const rec = await gcsReadJson(cfg.bucket, `auth/tokens/${sha256(raw)}.json`);
  const error = logicalTokenError(rec?.data);
  if (error) return { ok: false, error };
  return { ok: true, record: rec.data };
}
function unauthorized(req, res, error) {
  sendJson(res, 401, { error }, { 'www-authenticate': `Bearer resource_metadata="${base(req)}/.well-known/oauth-protected-resource", error="${error}"` });
}
async function googleTokenExchange(code, redirectUri) {
  const body = new URLSearchParams({ code, client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`google_token_exchange_${r.status}`);
  return r.json();
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
  const idemHash = sha256(idem);
  const existing = await gcsReadJson(cfg.bucket, `idempotency/${idemHash}.json`);
  if (existing) return { operation_id: existing.data.operation_id, duplicate: true };
  const taskReq = validateTaskRequest(toolArgs.task, toolArgs.args || {});
  const timeout = taskReq.task_class === 'VERIFY' ? VERIFY_TIMEOUT_MS : OBSERVE_TIMEOUT_MS;
  const opId = `op-${Date.now().toString(36)}-${randomToken(8).toLowerCase()}`;
  await incrementDailyCounter(cfg.bucket, new Date().toISOString().slice(0,10));
  await acquireLease(cfg.bucket, opId, timeout + 60_000);
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
    await gcsWriteJson(cfg.bucket, `idempotency/${idemHash}.json`, { operation_id: opId, created_at: isoNow() }, 0);
    return { operation_id: opId, duplicate: false, operation_state: 'RUNNING' };
  } catch (e) {
    try { await updateOperation(opId, () => ({ operation_state: 'FAILED', coarse_error: 'dispatch_failed', finished_at: isoNow() })); } catch {}
    try { await releaseLease(cfg.bucket, opId); } catch {}
    throw e;
  }
}
async function getOperation(id) {
  const opId = String(id || '').trim();
  if (!/^op-[a-z0-9-]{10,100}$/.test(opId)) throw new Error('invalid_operation_id');
  const rec = await gcsReadJson(cfg.bucket, `operations/${opId}.json`);
  if (!rec) throw new Error('operation_not_found');
  const result = await gcsReadJson(cfg.bucket, `results/${opId}.json`);
  return result ? publicEvidence({ ...rec.data, ...result.data }) : publicEvidence(rec.data);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, base(req));
    const issuer = base(req);
    if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true, component: 'jscc-ops-gateway-dev', privileged: true, project: cfg.project, catalog_version: CATALOG_VERSION });
    if (req.method === 'GET' && u.pathname === '/.well-known/oauth-protected-resource') return sendJson(res, 200, { resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: [REQUIRED_SCOPE], bearer_methods_supported: ['header'] });
    if (req.method === 'GET' && (u.pathname === '/.well-known/oauth-authorization-server' || u.pathname === '/.well-known/openid-configuration')) {
      return sendJson(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, revocation_endpoint: `${issuer}/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], scopes_supported: [REQUIRED_SCOPE], token_endpoint_auth_methods_supported: ['none'] });
    }
    if (req.method === 'POST' && u.pathname === '/register') {
      if (!cfg.clientSigningKey) return sendJson(res, 503, { error: 'oauth_not_configured' });
      const body = await readBody(req);
      const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      if (!redirects.length || redirects.some(x => typeof x !== 'string' || !x.startsWith('https://'))) return sendJson(res, 400, { error: 'invalid_redirect_uris' });
      const clientId = makeSignedClient(redirects, cfg.clientSigningKey);
      return sendJson(res, 201, { client_id: clientId, redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
    }
    if (req.method === 'GET' && u.pathname === '/authorize') {
      if (!(cfg.googleClientId && cfg.googleClientSecret && cfg.googleAllowedSub && cfg.clientSigningKey)) return sendText(res, 503, 'oauth_not_configured');
      const q = u.searchParams;
      const clientId = q.get('client_id') || '';
      const client = parseSignedClient(clientId, cfg.clientSigningKey);
      const redirectUri = q.get('redirect_uri') || '';
      const state = q.get('state') || '';
      const challenge = q.get('code_challenge') || '';
      const method = q.get('code_challenge_method') || '';
      const scope = q.get('scope') || '';
      const resource = q.get('resource') || REQUIRED_AUDIENCE;
      if (!client || !client.redirect_uris.includes(redirectUri)) return sendText(res, 400, 'invalid_client_or_redirect');
      if (method !== 'S256' || !challenge) return sendText(res, 400, 'pkce_s256_required');
      if (!scope.split(/\s+/).includes(REQUIRED_SCOPE)) return sendText(res, 400, 'required_scope_missing');
      if (![REQUIRED_AUDIENCE, `${issuer}/mcp`].includes(resource)) return sendText(res, 400, 'invalid_resource');
      const nonce = randomToken(24);
      const upstreamState = makeSignedState({ expires_at_ms: Date.now()+STATE_TTL_MS, client_id: clientId, redirect_uri: redirectUri, client_state: state, scope, challenge, audience: REQUIRED_AUDIENCE, nonce }, cfg.clientSigningKey);
      const redirect = `${issuer}/oauth/google/callback`;
      const gp = new URLSearchParams({ client_id: cfg.googleClientId, redirect_uri: redirect, response_type: 'code', scope: 'openid', state: upstreamState, nonce, prompt: 'select_account' });
      res.writeHead(302, { location: `https://accounts.google.com/o/oauth2/v2/auth?${gp}`, 'cache-control': 'no-store' }); return res.end();
    }
    if (req.method === 'GET' && u.pathname === '/oauth/google/callback') {
      const upstreamState = u.searchParams.get('state') || '', googleCode = u.searchParams.get('code') || '';
      if (!(upstreamState && googleCode)) return sendText(res, 400, 'invalid_callback');
      const st = parseSignedState(upstreamState, cfg.clientSigningKey);
      if (!st) return sendText(res, 400, 'invalid_or_expired_upstream_state');
      const redirect = `${issuer}/oauth/google/callback`;
      const gt = await googleTokenExchange(googleCode, redirect);
      if (!gt.id_token) return sendText(res, 400, 'google_id_token_missing');
      const claims = await verifyGoogleIdToken(gt.id_token, st.nonce, cfg.googleClientId);
      if (claims.sub !== cfg.googleAllowedSub) return sendText(res, 403, 'unapproved_google_subject');
      const code = randomToken(32);
      await gcsWriteJson(cfg.bucket, `auth/codes/${sha256(code)}.json`, { consumed: false, expires_at_ms: Date.now()+AUTH_CODE_TTL_MS, client_id: st.client_id, redirect_uri: st.redirect_uri, scope: st.scope, audience: st.audience, challenge: st.challenge, actor_sub: claims.sub }, 0);
      const out = new URL(st.redirect_uri); out.searchParams.set('code', code); if (st.client_state) out.searchParams.set('state', st.client_state);
      res.writeHead(302, { location: out.toString(), 'cache-control': 'no-store' }); return res.end();
    }
    if (req.method === 'POST' && u.pathname === '/token') {
      const body = await readBody(req);
      let codeRec;
      try { codeRec = await consumeJson(cfg.bucket, `auth/codes/${sha256(body.code || '')}.json`); }
      catch { return sendJson(res, 400, { error: 'invalid_grant' }); }
      if (body.client_id !== codeRec.client_id || body.redirect_uri !== codeRec.redirect_uri) return sendJson(res, 400, { error: 'invalid_grant' });
      if (sha256(body.code_verifier || '') !== codeRec.challenge) return sendJson(res, 400, { error: 'invalid_grant', error_description: 'pkce_failed' });
      const accessToken = randomToken(32);
      await gcsWriteJson(cfg.bucket, `auth/tokens/${sha256(accessToken)}.json`, { revoked: false, expires_at_ms: Date.now()+ACCESS_TOKEN_TTL_MS, scope: codeRec.scope, audience: codeRec.audience, actor_sub: codeRec.actor_sub, issued_at: isoNow() }, 0);
      return sendJson(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 900, scope: codeRec.scope });
    }
    if (req.method === 'POST' && u.pathname === '/revoke') {
      const body = await readBody(req); const name = `auth/tokens/${sha256(body.token || '')}.json`; const cur = await gcsReadJson(cfg.bucket, name);
      if (cur) await gcsReplaceJson(cfg.bucket, name, { ...cur.data, revoked: true, revoked_at: isoNow() }, cur.generation);
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
