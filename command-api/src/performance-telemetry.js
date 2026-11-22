// #659 — bounded DEV-only Nile query telemetry. No SQL text, binds, data or tenant IDs.
import { performance } from 'node:perf_hooks';

const OPS = new Set([
  'legacy_list_sql','advance_scan_sql','advance_batch_sql',
  'advance_verify_sql','global_listing_sql',
]);
export function performanceTelemetryEnabled(env=process.env) {
  return env?.APP_ENV === 'dev' && env?.JSCC_PERF_TELEMETRY === '1';
}
export async function measureNileSql(operation, tx, sql, params, env=process.env) {
  if (!performanceTelemetryEnabled(env) || !OPS.has(operation))
    return tx.query(sql,params);
  const start=performance.now();
  let outcome='PASS';
  try {
    return await tx.query(sql,params);
  } catch(error) {
    outcome='ERROR';
    throw error;
  } finally {
    // Allowlisted dimensions only. Never log SQL, query binds, payloads or identities.
    console.info(JSON.stringify({
      event:'JSCC_PERF_SQL_V1',
      operation,
      duration_ms:Math.round((performance.now()-start)*100)/100,
      outcome,
      source_sha:/^[0-9a-f]{40}$/.test(env.SOURCE_SHA||'')?env.SOURCE_SHA:null,
    }));
  }
}
