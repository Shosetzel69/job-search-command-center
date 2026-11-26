import pg from 'pg';
import {observeNile} from './dev-nile-observer.mjs';
import {CATALOG_VERSION,NILE_JOB,envConfig,gcsReadJson,gcsWriteJson,isoNow,normalizeExecutionId,validateDispatchBinding,validateTaskRequest,releaseLease} from '../src/lib.mjs';

async function main(){
  const cfg=envConfig();
  const execution=normalizeExecutionId(process.env.CLOUD_RUN_EXECUTION,true);
  if(process.env.CLOUD_RUN_JOB!==NILE_JOB || !execution.startsWith(NILE_JOB+'-')) throw Error('wrong_job');
  if(!/^sha256:[0-9a-f]{64}$/.test(cfg.nileWorkerDigest)) throw Error('missing_worker_digest');
  let dispatch;
  for(let i=0;i<240;i++){
    const rec=await gcsReadJson(cfg.bucket,'nile/dispatch/'+execution+'.json');
    if(rec){dispatch=rec.data;break;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  validateDispatchBinding(dispatch,execution,{catalog_version:CATALOG_VERSION,ops_source_sha:cfg.opsSourceSha,worker_image_digest:cfg.nileWorkerDigest});
  const task=validateTaskRequest(dispatch.task,dispatch.args);
  if(task.task!=='observe_dev_nile'||!/^op-[a-z0-9_-]{10,100}$/.test(dispatch.operation_id)) throw Error('invalid_dispatch');
  const id=dispatch.operation_id;
  const startedAt=isoNow();
  let result={status:'ERROR',stage:'configuration',sqlstate:null};
  let pool;
  try{
    const uri=new URL(process.env.NILE_OBSERVER_DATABASE_URL);
    const host=process.env.NILE_OBSERVER_DB_HOST;
    if(!['postgres:','postgresql:'].includes(uri.protocol)||uri.pathname!=='/jobsearch_dev'||uri.hash||!uri.username||!uri.password||!host||uri.hostname!==host||!host.endsWith('.db.thenile.dev')||!['','5432'].includes(uri.port)) throw Error('invalid_db_binding');
    const keys=[...uri.searchParams.keys()];
    if(keys.length>1||(keys.length===1&&(keys[0]!=='sslmode'||!['require','verify-full'].includes(uri.searchParams.get('sslmode'))))) throw Error('invalid_db_options');
    uri.search='';
    pool=new pg.Pool({connectionString:uri.toString(),ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:5000,query_timeout:12000});
    result=await observeNile({pool,authorizedTenant:process.env.NILE_OBSERVER_TENANT_ID,expectedRole:process.env.NILE_OBSERVER_ROLE},task.args);
  }catch{result={status:'ERROR',stage:'operator',sqlstate:null};}
  finally{if(pool)await pool.end();}
  const state=result.status==='COLLECTED'?'SUCCEEDED':'FAILED';
  const evidence={operation_id:id,work_item_ref:dispatch.work_item_ref,task:task.task,task_class:task.task_class,operation_state:state,ops_source_sha:cfg.opsSourceSha,gateway_image_digest:cfg.gatewayDigest,worker_image_digest:cfg.nileWorkerDigest,started_at:startedAt,finished_at:isoNow(),assertions:{nile_status:result.status,nile_stage:result.stage??null,nile_sqlstate:result.sqlstate??null,nile_evidence_json:JSON.stringify(result)}};
  await gcsWriteJson(cfg.bucket,'nile/results/'+id+'.json',evidence,0);
  await releaseLease(cfg.bucket,id);
  if(state==='FAILED')process.exitCode=1;
}
main().catch(()=>{console.error('nile_operator_failed');process.exitCode=1;});
