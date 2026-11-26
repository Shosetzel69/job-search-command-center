// #589 RE-07: isolated operator core. Never import into the general worker.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERIES = Object.freeze({
  schema_probe: "SELECT COUNT(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('profile_job_evaluation','profile','app_user')",
  evaluation_count_plan: "EXPLAIN (FORMAT JSON) SELECT COUNT(*) FROM profile_job_evaluation WHERE tenant_id=$1"
});
const METRICS = ['Plan Rows','Plan Width','Startup Cost','Total Cost'];
function projectPlan(node, depth=0) {
  if (!node || depth>16) throw new Error('invalid_plan');
  const out = {};
  for (const key of METRICS) if (Number.isFinite(node[key])) out[key]=node[key];
  if (Array.isArray(node.Plans)) {
    if (node.Plans.length>32) throw new Error('invalid_plan');
    out.children=node.Plans.map(child=>projectPlan(child,depth+1));
  }
  return out;
}

// pool must be privately constructed by the isolated operator using its
// dedicated database principal, not supplied by a remote request.
export async function observeNile({pool, authorizedTenant, expectedRole}, request) {
  if (!request || Object.keys(request).sort().join(',')!=='environment,operation' ||
      request.environment!=='dev' || !Object.hasOwn(QUERIES,request.operation))
    throw new Error('nile_request_denied');
  if (!UUID.test(authorizedTenant||'') || !expectedRole ||
      !/^[a-z_][a-z0-9_]*$/.test(expectedRole)) throw new Error('nile_binding_required');
  const client=await pool.connect();
  let stage='begin', discard=true;
  try {
    await client.query('BEGIN READ ONLY');
    stage='tenant_set';
    await client.query("SET LOCAL nile.tenant_id = '"+authorizedTenant+"'");
    stage='timeouts';
    await client.query("SET LOCAL statement_timeout='10000ms'");
    await client.query("SET LOCAL lock_timeout='1000ms'");
    stage='guard';
    const guard=(await client.query("SELECT current_database() AS db, current_user AS role, current_setting('transaction_read_only') AS ro, current_setting('nile.tenant_id',true) AS tenant")).rows[0];
    if (guard?.db!=='jobsearch_dev'||guard.role!==expectedRole||guard.ro!=='on'||guard.tenant!==authorizedTenant)
      throw new Error('nile_guard_failed');
    stage='diagnostic';
    const start=performance.now();
    const result=await client.query(QUERIES[request.operation],request.operation==='evaluation_count_plan'?[authorizedTenant]:[]);
    const evidence=request.operation==='schema_probe'
      ? {table_count: Number(result.rows[0].count)}
      : {plan:projectPlan(result.rows[0]['QUERY PLAN'][0].Plan)};
    if (request.operation==='schema_probe' && !Number.isSafeInteger(evidence.table_count)) throw new Error('invalid_count');
    return {status:'COLLECTED',operation:request.operation,elapsed_ms:Math.round(performance.now()-start),...evidence};
  } catch (err) {
    return {status:'ERROR',stage,sqlstate:/^[0-9A-Z]{5}$/.test(err?.code||'')?err.code:null};
  } finally {
    try { await client.query('ROLLBACK'); discard=false; } finally { client.release(discard); }
  }
}
