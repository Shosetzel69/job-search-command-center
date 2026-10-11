import crypto from 'node:crypto';

export const CATALOG_VERSION = '537-v1';
export const REQUIRED_SCOPE = 'jscc.ops.dev';
export const REQUIRED_AUDIENCE = 'urn:jscc:ops:dev';
export const CHATGPT_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const STATE_TTL_MS = 5 * 60 * 1000;
export const OBSERVE_TIMEOUT_MS = 5 * 60 * 1000;
export const VERIFY_TIMEOUT_MS = 15 * 60 * 1000;
export const OUTPUT_MAX_LINES = 200;
export const OUTPUT_MAX_BYTES = 64 * 1024;
export const DAILY_OPERATION_LIMIT = 50;

export const TASK_CATALOG = Object.freeze({
  describe_execution: Object.freeze({
    class: 'OBSERVE',
    params: Object.freeze({ execution_id: 'execution_id' }),
  }),
  read_execution_logs: Object.freeze({
    class: 'OBSERVE',
    params: Object.freeze({ execution_id: 'execution_id', limit: 'log_limit' }),
  }),
  inspect_runtime_snapshot: Object.freeze({
    class: 'OBSERVE',
    params: Object.freeze({ run_id: 'run_id' }),
  }),
  run_test_suite: Object.freeze({
    class: 'VERIFY',
    params: Object.freeze({ suite: 'suite', expected_source_sha: 'sha40' }),
  }),
});

export const TEST_SUITES = Object.freeze({
  'dev-health': Object.freeze({ kind: 'http_health' }),
});

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function isoNow() { return new Date().toISOString(); }

export function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function normalizeExecutionId(value) {
  const v = String(value || '').trim();
  if (!/^[a-z][a-z0-9-]{5,62}$/.test(v)) throw new Error('invalid_execution_id');
  if (!(v.startsWith('jscc-search-dev-') || v.startsWith('jscc-diagnostics-dev-'))) {
    throw new Error('execution_not_allowlisted');
  }
  return v;
}

export function executionJobName(executionId) {
  const id = normalizeExecutionId(executionId);
  if (id.startsWith('jscc-search-dev-')) return 'jscc-search-dev';
  if (id.startsWith('jscc-diagnostics-dev-')) return 'jscc-diagnostics-dev';
  throw new Error('execution_not_allowlisted');
}

export function validateRunId(value) {
  const v = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v) || v.includes('..')) throw new Error('invalid_run_id');
  return v;
}

export function validateSha40(value) {
  const v = String(value || '').trim();
  if (!/^[0-9a-f]{40}$/.test(v)) throw new Error('invalid_source_sha');
  return v;
}

export function validateTaskRequest(task, args) {
  const spec = TASK_CATALOG[task];
  if (!spec) throw new Error('unknown_task');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_arguments');
  const expected = Object.keys(spec.params);
  const actual = Object.keys(args);
  const extra = actual.filter(k => !expected.includes(k));
  const missing = expected.filter(k => !(k in args));
  if (extra.length) throw new Error('unrecognized_parameter');
  if (missing.length) throw new Error('missing_parameter');
  const clean = {};
  for (const [name, type] of Object.entries(spec.params)) {
    const value = args[name];
    if (type === 'execution_id') clean[name] = normalizeExecutionId(value);
    else if (type === 'run_id') clean[name] = validateRunId(value);
    else if (type === 'sha40') clean[name] = validateSha40(value);
    else if (type === 'suite') {
      const suite = String(value || '');
      if (!Object.hasOwn(TEST_SUITES, suite)) throw new Error('unknown_suite');
      clean[name] = suite;
    } else if (type === 'log_limit') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > OUTPUT_MAX_LINES) throw new Error('invalid_log_limit');
      clean[name] = n;
    } else throw new Error('catalog_schema_error');
  }
  return Object.freeze({ task, task_class: spec.class, args: clean });
}

const SECRET_PATTERNS = [
  /\b(?:ya29\.[A-Za-z0-9._-]+)\b/g,
  /\b(?:Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:postgres(?:ql)?:\/\/)[^\s"']+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:client_secret|access_token|refresh_token|id_token|password)\b\s*[:=]\s*[^\s,;]+/gi,
];

export function sanitizeText(input) {
  let text = String(input ?? '');
  for (const p of SECRET_PATTERNS) text = text.replace(p, '[REDACTED]');
  const lines = text.split(/\r?\n/).slice(0, OUTPUT_MAX_LINES);
  let out = lines.join('\n');
  const b = Buffer.from(out);
  if (b.length > OUTPUT_MAX_BYTES) out = b.subarray(0, OUTPUT_MAX_BYTES).toString('utf8');
  return out;
}

const PUBLIC_ASSERTION_FIELDS = Object.freeze([
  'target_alias','failed_count','succeeded_count','cancelled_count','completed','line_count',
  'run_status','published_jobs','status_present','jobs_present','ops_source_sha','target_source_sha',
  'exit_code','test_verdict','coarse_error','task_count','target_exit_code','target_term_signal',
  'task_metadata_available','task_metadata_error'
]);

const AUTHENTICATED_ASSERTION_FIELDS = Object.freeze([
  ...PUBLIC_ASSERTION_FIELDS,
  'root_cause','log_excerpt'
]);

function projectAssertions(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const k of fields) {
    if (!Object.hasOwn(input, k)) continue;
    const v = input[k];
    if (v === null || ['string','number','boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

export function publicAssertions(input) {
  return projectAssertions(input, PUBLIC_ASSERTION_FIELDS);
}

export function authenticatedAssertions(input) {
  return projectAssertions(input, AUTHENTICATED_ASSERTION_FIELDS);
}

export function publicEvidence(result) {
  const allow = [
    'operation_id','work_item_ref','task','task_class','operation_state','test_verdict','catalog_version',
    'target_alias','ops_source_sha','target_source_sha','gateway_image_digest','worker_image_digest','started_at',
    'finished_at','exit_code','coarse_error','sanitizer_version','line_count','byte_count'
  ];
  const out = {};
  for (const k of allow) if (Object.hasOwn(result, k)) out[k] = result[k];
  if (typeof result.actor_sub_hash === 'string' && result.actor_sub_hash.length > 0) out.actor_bound = true;
  if (Object.hasOwn(result, 'assertions')) out.assertions = publicAssertions(result.assertions);
  return out;
}

export function authenticatedEvidence(result) {
  const allow = [
    'operation_id','work_item_ref','task','task_class','operation_state','test_verdict','execution_name','catalog_version',
    'target_alias','ops_source_sha','target_source_sha','gateway_image_digest','worker_image_digest','started_at',
    'finished_at','exit_code','coarse_error','sanitizer_version','line_count','byte_count'
  ];
  const out = {};
  for (const k of allow) if (Object.hasOwn(result, k)) out[k] = result[k];
  if (typeof result.actor_sub_hash === 'string' && result.actor_sub_hash.length > 0) out.actor_bound = true;
  if (Object.hasOwn(result, 'assertions')) out.assertions = authenticatedAssertions(result.assertions);
  return out;
}

export function authorizationCodeError(record, request, now = Date.now()) {
  if (!record || record.consumed || Number(record.expires_at_ms) <= now) return 'invalid_grant';
  if (request.client_id !== record.client_id || request.redirect_uri !== record.redirect_uri) return 'invalid_grant';
  if (request.resource !== record.resource) return 'invalid_target';
  if (sha256(request.code_verifier || '') !== record.challenge) return 'pkce_failed';
  return null;
}

export function logicalTokenError(record, now = Date.now()) {
  if (!record) return 'invalid_token';
  if (record.revoked) return 'revoked_token';
  if (Number(record.expires_at_ms) <= now) return 'expired_token';
  if (record.audience !== REQUIRED_AUDIENCE) return 'wrong_audience';
  if (!String(record.scope || '').split(/\s+/).includes(REQUIRED_SCOPE)) return 'insufficient_scope';
  return null;
}

export function validateChatGptRedirectUris(redirectUris) {
  if (!Array.isArray(redirectUris) || redirectUris.length !== 1 || redirectUris[0] !== CHATGPT_REDIRECT_URI) {
    throw new Error('invalid_redirect_uris');
  }
  return redirectUris;
}

export function envConfig(env = process.env) {
  const required = ['GCP_PROJECT','GCP_REGION','OPS_BUCKET','SOURCE_SHA','GATEWAY_IMAGE_DIGEST','WORKER_IMAGE_DIGEST'];
  for (const key of required) if (!String(env[key] || '').trim()) throw new Error(`missing_env_${key}`);
  if (env.GCP_PROJECT !== 'jscc-dev') throw new Error('dev_project_required');
  if (env.GCP_REGION !== 'europe-west1') throw new Error('region_mismatch');
  validateSha40(env.SOURCE_SHA);
  return Object.freeze({
    project: env.GCP_PROJECT,
    region: env.GCP_REGION,
    bucket: env.OPS_BUCKET,
    runtimeBucket: String(env.GCP_RUNTIME_BUCKET || ''),
    opsSourceSha: env.SOURCE_SHA,
    devBaseUrl: String(env.DEV_BASE_URL || '').replace(/\/$/, ''),
    gatewayDigest: env.GATEWAY_IMAGE_DIGEST,
    workerDigest: env.WORKER_IMAGE_DIGEST,
    diagnosticsJob: String(env.DIAGNOSTICS_JOB || 'jscc-diagnostics-dev'),
    logViewResource: String(env.LOG_VIEW_RESOURCE || ''),
    googleClientId: String(env.GOOGLE_CLIENT_ID || ''),
    googleClientSecret: String(env.GOOGLE_CLIENT_SECRET || ''),
    googleAllowedSub: String(env.GOOGLE_ALLOWED_SUB || ''),
  });
}

export async function metadataAccessToken(fetchImpl = fetch) {
  const r = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }
  });
  if (!r.ok) throw new Error(`metadata_token_${r.status}`);
  const j = await r.json();
  if (!j.access_token) throw new Error('metadata_token_missing');
  return j.access_token;
}

export async function gcpFetch(url, options = {}, fetchImpl = fetch) {
  const token = await metadataAccessToken(fetchImpl);
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${token}`);
  const r = await fetchImpl(url, { ...options, headers });
  return r;
}

function objUrl(bucket, name, media = false) {
  const suffix = media ? '?alt=media' : '';
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}${suffix}`;
}

export async function gcsReadJson(bucket, name, fetchImpl = fetch) {
  const r = await gcpFetch(objUrl(bucket, name, true), {}, fetchImpl);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`gcs_read_${r.status}`);
  const data = await r.json();
  return { data, generation: r.headers.get('x-goog-generation') || null };
}

export async function gcsWriteJson(bucket, name, data, generation = 0, fetchImpl = fetch) {
  const q = new URLSearchParams({ uploadType: 'media', name, ifGenerationMatch: String(generation) });
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${q}`;
  const r = await gcpFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  }, fetchImpl);
  if (r.status === 412) throw new Error('generation_precondition_failed');
  if (!r.ok) throw new Error(`gcs_write_${r.status}`);
  return r.json();
}

export async function gcsReplaceJson(bucket, name, data, generation, fetchImpl = fetch) {
  if (!generation) throw new Error('generation_required');
  const q = new URLSearchParams({ uploadType: 'media', name, ifGenerationMatch: String(generation) });
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${q}`;
  const r = await gcpFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  }, fetchImpl);
  if (r.status === 412) throw new Error('generation_precondition_failed');
  if (!r.ok) throw new Error(`gcs_replace_${r.status}`);
  return r.json();
}

export async function consumeJson(bucket, name, nowMs = Date.now(), fetchImpl = fetch) {
  const current = await gcsReadJson(bucket, name, fetchImpl);
  if (!current || current.data.consumed || Number(current.data.expires_at_ms) <= nowMs) throw new Error('expired_or_consumed');
  const next = { ...current.data, consumed: true, consumed_at: isoNow() };
  await gcsReplaceJson(bucket, name, next, current.generation, fetchImpl);
  return current.data;
}

export async function incrementDailyCounter(bucket, day, limit = DAILY_OPERATION_LIMIT, fetchImpl = fetch) {
  const name = `limits/${day}.json`;
  for (let i = 0; i < 4; i++) {
    const cur = await gcsReadJson(bucket, name, fetchImpl);
    if (!cur) {
      try { await gcsWriteJson(bucket, name, { count: 1, day }, 0, fetchImpl); return 1; }
      catch (e) { if (e.message !== 'generation_precondition_failed') throw e; continue; }
    }
    const n = Number(cur.data.count || 0);
    if (n >= limit) throw new Error('daily_operation_limit');
    try { await gcsReplaceJson(bucket, name, { count: n + 1, day }, cur.generation, fetchImpl); return n + 1; }
    catch (e) { if (e.message !== 'generation_precondition_failed') throw e; }
  }
  throw new Error('daily_counter_contention');
}

export async function acquireLease(bucket, operationId, ttlMs, fetchImpl = fetch) {
  const name = 'leases/diagnostics.json';
  for (let i = 0; i < 4; i++) {
    const cur = await gcsReadJson(bucket, name, fetchImpl);
    const now = Date.now();
    const next = { operation_id: operationId, state: 'ACTIVE', acquired_at: isoNow(), expires_at_ms: now + ttlMs };
    if (!cur) {
      try { await gcsWriteJson(bucket, name, next, 0, fetchImpl); return next; }
      catch (e) { if (e.message !== 'generation_precondition_failed') throw e; continue; }
    }
    const active = cur.data.state === 'ACTIVE' && Number(cur.data.expires_at_ms) > now;
    if (active) throw new Error('diagnostic_already_active');
    try { await gcsReplaceJson(bucket, name, next, cur.generation, fetchImpl); return next; }
    catch (e) { if (e.message !== 'generation_precondition_failed') throw e; }
  }
  throw new Error('lease_contention');
}

export async function releaseLease(bucket, operationId, fetchImpl = fetch) {
  const name = 'leases/diagnostics.json';
  const cur = await gcsReadJson(bucket, name, fetchImpl);
  if (!cur || cur.data.operation_id !== operationId) return false;
  await gcsReplaceJson(bucket, name, { ...cur.data, state: 'RELEASED', released_at: isoNow(), expires_at_ms: Date.now() }, cur.generation, fetchImpl);
  return true;
}

export function operationObject(operationId, taskRequest, ctx = {}) {
  const now = isoNow();
  return {
    schema_version: '1.0',
    operation_id: operationId,
    work_item_ref: ctx.work_item_ref,
    idempotency_key_hash: ctx.idempotency_key_hash,
    actor_sub_hash: ctx.actor_sub_hash,
    task: taskRequest.task,
    task_class: taskRequest.task_class,
    args: taskRequest.args,
    catalog_version: CATALOG_VERSION,
    operation_state: 'ACCEPTED',
    test_verdict: null,
    ops_source_sha: ctx.ops_source_sha,
    gateway_image_digest: ctx.gateway_image_digest,
    worker_image_digest: ctx.worker_image_digest,
    accepted_at: now,
    updated_at: now,
  };
}

export function normalizeExecutionName(name) {
  const v = String(name || '');
  const base = v.includes('/') ? v.slice(v.lastIndexOf('/') + 1) : v;
  return normalizeExecutionId(base);
}
