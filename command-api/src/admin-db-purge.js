import {databaseConfig} from './db/config.js';
import {getPool,withTransaction} from './db/pool.js';
import {purgeDevJobProjections} from './db/tenant-gateway.js';
import {acquireDevPurgeLock} from './runtime-gcp.js';

const error=(message,status=503)=>Object.assign(new Error(message),{status});
const sharedTables=Object.freeze(['coverage_scope_state','source_run_results','source_postings','canonical_jobs','search_runs']);
function assertRequest(context,env,input) {
  if(context?.role!=='ADMIN'||context?.status!=='ACTIVE'||!context?.user_id)throw error('Active ADMIN required',403);
  if(env.APP_ENV!=='dev'||env.GCP_PROJECT_ID!=='jscc-dev'||env.JSCC_RUNTIME_BACKEND!=='gcp')throw error('DB Purge is DEV only',403);
  if(input?.confirmation!=='PURGE DEV'||Object.keys(input||{}).length!==1)throw error('Type PURGE DEV to confirm',400);
  databaseConfig(env);
}
async function assertDatabaseIdle(tx) {
  const r=await tx.query("SELECT current_database() AS database");
  if(r.rows?.[0]?.database!=='jobsearch_dev')throw error('DEV database required');
  const s=await tx.query('SELECT enabled FROM scheduler_config WHERE singleton=true FOR UPDATE');
  if(s.rows?.length!==1||s.rows[0].enabled!==false)throw error('Disable scheduler before purge',409);
  const active=await tx.query("SELECT count(*)::int AS count FROM search_runs WHERE status NOT IN ('completed','completed_with_errors','failed','cancelled','canceled','timed_out')");
  if(active.rows?.[0]?.count!==0)throw error('Retrieve run state unresolved',409);
}
async function resetShared(env,db,lock) {
  return withTransaction(async tx=>{
    await assertDatabaseIdle(tx);
    await lock.assertIdle();
    const removed={};
    for(const table of sharedTables)removed[table]=(await tx.query('DELETE FROM '+table)).rowCount;
    await tx.query("UPDATE scheduler_state SET last_triggered_at=NULL,last_run_id=NULL,state='{}'::jsonb,updated_at=now() WHERE singleton=true");
    for(const table of sharedTables){
      const r=await tx.query('SELECT count(*)::int AS count FROM '+table);
      if(r.rows?.[0]?.count!==0)throw error('Shared corpus residue');
    }
    await lock.assertHeld();
    return removed;
  },{env,db});
}
export async function adminDbPurge(context,env,input,{
  acquire=acquireDevPurgeLock,purgeProjections=purgeDevJobProjections,
  database=null,transaction=withTransaction,clearShared=resetShared,
}={}){
  assertRequest(context,env,input);
  const db=database||getPool(env);
  const lock=await acquire(env);
  let destructive=false;
  try{
    await lock.assertIdle();
    await transaction(assertDatabaseIdle,{env,db});
    destructive=true;
    const personal=await purgeProjections(context,env,{db,assertHeld:()=>lock.assertHeld()});
    const shared=await clearShared(env,db,lock);
    await lock.clearLatest();
    await lock.release();
    console.info(JSON.stringify({event:'dev_db_purge',status:'completed',tables:Object.keys({...personal,...shared})}));
    return {status:'completed',deleted:{...personal,...shared},lock_released:true};
  }catch(e){
    if(!destructive){
      try{await lock.release();}catch{throw error('Purge preflight failed; lock release unverified');}
      throw error('DB Purge preflight failed; no deletion started',Number(e?.status)||503);
    }
    console.error(JSON.stringify({event:'dev_db_purge',status:'reconciliation_required'}));
    throw error('DB Purge incomplete or unverified; maintenance lock retained. Operator reconciliation required.');
  }
}
