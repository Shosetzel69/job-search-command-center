// System-owned read boundary. Caller must enforce the ADMIN operational route.
// No raw credentials or SQL are exposed to the public runtime adapter.
import {getPool} from './pool.js';

const RUN_ID=/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function operationalDbConfigured(env) {
  return Boolean(String(env.NILE_DATABASE_URL || '').trim());
}

export async function readOperationalRun(env,runId,db) {
  if (!RUN_ID.test(String(runId||''))) return null;
  const result=await (db||getPool(env)).query('SELECT payload FROM search_runs WHERE run_id=$1',[runId]);
  const payload=result.rows?.[0]?.payload;
  if (!payload || payload.run_id!==runId) return null;
  return {sha:'nile:'+runId,payload:{...payload,status:payload.status==='running'?'in_progress':payload.status}};
}

export async function readOperationalHistory(env,db) {
  const result=await (db||getPool(env)).query(
    'SELECT payload FROM search_runs ORDER BY COALESCE(completed_at,started_at,created_at) DESC,run_id DESC LIMIT 10');
  return {sha:'nile:history',payload:{schema_version:'1.0',runs:result.rows.map(row=>row.payload)}};
}
