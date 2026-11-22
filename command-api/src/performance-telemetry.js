// #659 — Nile DEV API/SQL timings; no SQL text, binds, tenant IDs or payloads.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const requests = new AsyncLocalStorage();
const OPS = new Set([
  'legacy_list_sql','advance_scan_sql','advance_batch_sql',
  'advance_verify_sql','global_listing_sql',
]);
export function performanceTelemetryEnabled(env=process.env) {
  return env?.APP_ENV === 'dev' && env?.JSCC_PERF_TELEMETRY === '1';
}
function sourceSha(env) {
  return /^[0-9a-f]{40}$/.test(env?.SOURCE_SHA || '') ? env.SOURCE_SHA : null;
}
function emit(payload) {
  // Diagnostic logging must never alter the result or error of a Nile query.
  try { console.info(JSON.stringify(payload)); } catch { /* fail open to application */ }
}
function routeOperation(req) {
  // Explicit route allowlist: never log raw URLs, query strings or path IDs.
  const path = String(req?.url || '').split('?')[0];
  if (req?.method === 'GET' && path === '/me/jobs') return 'jobs_page';
  if (req?.method === 'POST' && path === '/me/evaluation/advance') return 'evaluation_advance';
  return null;
}
export async function measureNileHttpRequest(req, res, handle, env=process.env) {
  if (!performanceTelemetryEnabled(env)) return handle();
  const operation=routeOperation(req);
  if (!operation) return handle();
  const started=performance.now(), requestId=randomUUID();
  return requests.run(requestId, async()=>{
    try { return await handle(); }
    finally {
      const status=Number(res?.statusCode);
      emit({
        event:'JSCC_PERF_API_V1',operation,request_id:requestId,
        duration_ms:Math.round((performance.now()-started)*100)/100,
        status:Number.isInteger(status)&&status>=100&&status<=599?status:null,
        source_sha:sourceSha(env),
      });
    }
  });
}
export async function measureNileSql(operation, tx, sql, params, env=process.env) {
  if (!performanceTelemetryEnabled(env) || !OPS.has(operation))
    return tx.query(sql,params);
  const started=performance.now();
  let outcome='PASS';
  try {
    return await tx.query(sql,params);
  } catch(error) {
    outcome='ERROR';
    throw error;
  } finally {
    emit({
      event:'JSCC_PERF_SQL_V1',operation,request_id:requests.getStore() || null,
      duration_ms:Math.round((performance.now()-started)*100)/100,
      outcome,source_sha:sourceSha(env),
    });
  }
}
