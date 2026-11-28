// #589: existing diagnostics worker uses only its own Google identity.
// This module never receives a DB connection string or caller-supplied URL.
const AUDIENCE='urn:jscc:dev:nile-diagnostic';
const OPERATIONS=new Set(['fit_verify_plan','global_listing_plan','fit_verify_analyze','global_listing_analyze','schema_inventory','runtime_health','migration_013_preflight','tenant_invariants']);
const METRICS=['Plan Rows','Plan Width','Startup Cost','Total Cost','Actual Rows','Actual Loops','Actual Total Time','Shared Hit Blocks','Shared Read Blocks'];
const DIAGNOSTIC_PLAN_ENUMS=Object.freeze({
  'Node Type':new Set(['Aggregate','Append','BitmapAnd','BitmapOr','Bitmap Heap Scan','Bitmap Index Scan','CTE Scan','Custom Scan','Foreign Scan','Function Scan','Gather','Gather Merge','Group','Hash','Hash Join','Incremental Sort','Index Scan','Index Only Scan','Limit','LockRows','Materialize','Memoize','Merge Append','Merge Join','Nested Loop','ProjectSet','Recursive Union','Result','Sample Scan','Seq Scan','SetOp','Sort','Subquery Scan','Tid Scan','Tid Range Scan','Unique','Values Scan','WindowAgg','WorkTable Scan']),
  'Join Type':new Set(['Inner','Left','Right','Full','Semi','Anti','Right Anti','Right Semi']),
  'Strategy':new Set(['Plain','Sorted','Hashed','Mixed'])
});
function planSummary(node,budget={remaining:128},depth=0){
  if(!node||typeof node!=='object'||depth>16||--budget.remaining<0)throw Error('invalid_plan');
  const out={};
  for(const [key,allowed] of Object.entries(DIAGNOSTIC_PLAN_ENUMS))if(allowed.has(node[key]))out[key]=node[key];
  for(const k of METRICS)if(Number.isFinite(node[k]))out[k]=node[k];
  if(Array.isArray(node.children))out.children=node.children.map(x=>planSummary(x,budget,depth+1));
  return out;
}
const SCHEMA_TABLES=new Set([
 'schema_migrations','tenants','app_user','user_identity','profile','user_session',
 'collection_policy','system_bootstrap','account_capacity_policy','account_deletion_audit',
 'canonical_jobs','source_postings','search_runs','source_run_results','scheduler_config',
 'scheduler_state','coverage_scope_state','candidate_profile','search_profile','search_profile_preferences',
 'profile_preferences','profile_job_state','profile_job_evaluation','applications','profile_notes',
 'profile_ui_preferences','refresh_requests','profile_job_count_snapshots',
]);
function schemaSummary(raw){
 const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const version=x=>typeof x==='string'&&/^[0-9]{3,12}$/.test(x);
 const name=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(x);
 const deny=()=>{throw Error('invalid_schema_metadata');};
 if(!raw||raw.database!=='jobsearch_dev'||raw.read_only!==true||
  !['MATCH','DRIFT'].includes(raw.migration_state)||!['PRESENT','MISSING'].includes(raw.table_state)||
  !hash(raw.migration_checksum)||!hash(raw.catalog_checksum)||
  !Array.isArray(raw.migrations)||raw.migrations.length<1||raw.migrations.length>128||
  !Array.isArray(raw.extra_versions)||raw.extra_versions.length>128||!raw.extra_versions.every(version)||
  !Array.isArray(raw.tables)||raw.tables.length!==SCHEMA_TABLES.size)deny();
 const migrations=raw.migrations.map(m=>{
  if(!m||!version(m.version)||!hash(m.expected_checksum)||
   (m.actual_checksum!==null&&!hash(m.actual_checksum))||!['MATCH','MISMATCH','MISSING'].includes(m.state)||
   (m.state==='MISSING')!==(m.actual_checksum===null)||
   (m.state==='MATCH'&&m.expected_checksum!==m.actual_checksum))deny();
  return {version:m.version,expected_checksum:m.expected_checksum,actual_checksum:m.actual_checksum,state:m.state};
 });
 const tables=raw.tables.map(t=>{
  if(!t||!SCHEMA_TABLES.has(t.table)||typeof t.present!=='boolean'||
   !Array.isArray(t.indexes)||t.indexes.length>128||!t.indexes.every(name)||
   !Array.isArray(t.constraints)||t.constraints.length>128||!t.constraints.every(name)||
   (!t.present&&(t.indexes.length||t.constraints.length)))deny();
  return {table:t.table,present:t.present,indexes:t.indexes,constraints:t.constraints};
 });
 if(new Set(tables.map(t=>t.table)).size!==SCHEMA_TABLES.size||
  new Set(migrations.map(m=>m.version)).size!==migrations.length||
  new Set(raw.extra_versions).size!==raw.extra_versions.length||
  raw.extra_versions.some(v=>migrations.some(m=>m.version===v))||
  (raw.migration_state==='MATCH')!==(migrations.every(m=>m.state==='MATCH')&&raw.extra_versions.length===0)||
  (raw.table_state==='PRESENT')!==tables.every(t=>t.present))deny();
 const result={database:raw.database,read_only:true,migration_state:raw.migration_state,
  table_state:raw.table_state,migration_checksum:raw.migration_checksum,catalog_checksum:raw.catalog_checksum,
  migrations,extra_versions:raw.extra_versions,tables};
 if(Buffer.byteLength(JSON.stringify(result))>32768)deny();
 return result;
}
function healthSummary(raw){
 const count=x=>Number.isSafeInteger(x)&&x>=0;
 if(!raw||raw.database!=='jobsearch_dev'||raw.read_only!==true||
  raw.statement_timeout_bound!==true||raw.lock_timeout_bound!==true||
  !['UNKNOWN','OBSERVED_TLS','OBSERVED_NO_TLS'].includes(raw.backend_tls)||
  raw.lock_scope!=='current_backend_only'||!count(raw.granted_locks)||!count(raw.waiting_locks)||
  raw.pool_scope!=='current_process_only'||!raw.pool||
  ![raw.pool.total,raw.pool.idle,raw.pool.waiting].every(count)||raw.pool.idle>raw.pool.total)
  throw Error('invalid_runtime_health');
 return {database:raw.database,read_only:true,statement_timeout_bound:true,lock_timeout_bound:true,
  backend_tls:raw.backend_tls,lock_scope:raw.lock_scope,granted_locks:raw.granted_locks,
  waiting_locks:raw.waiting_locks,pool_scope:raw.pool_scope,
  pool:{total:raw.pool.total,idle:raw.pool.idle,waiting:raw.pool.waiting}};
}
function invariantSummary(raw){
 const valid=x=>Number.isInteger(x)&&x>=0&&x<=2;
 if(!raw||raw.database!=='jobsearch_dev'||raw.read_only!==true||raw.scope!=='configured_diagnostic_tenant'||
  raw.saturation_limit!==2||!valid(raw.active_profiles)||!valid(raw.missing_preferences)||
  raw.missing_preferences>raw.active_profiles||
  raw.foundation_state!==(raw.active_profiles===1&&raw.missing_preferences===0?'CONSISTENT':'INCONSISTENT')||
  raw.complete_database_validation!==false||raw.repair_authorized!==false)
  throw Error('invalid_tenant_invariants');
 return {database:raw.database,read_only:true,scope:raw.scope,saturation_limit:2,active_profiles:raw.active_profiles,
  missing_preferences:raw.missing_preferences,foundation_state:raw.foundation_state,complete_database_validation:false,
  repair_authorized:false};
}
function migration013Summary(raw){
 if(!raw||raw.database!=='jobsearch_dev'||raw.read_only!==true||
  raw.migration!=='013_profile_job_evaluation_listing.sql'||
  typeof raw.checksum!=='string'||!/^[a-f0-9]{64}$/.test(raw.checksum)||
  !['PENDING_013','ALREADY_APPLIED'].includes(raw.readiness)||raw.apply_authorized!==false)
  throw Error('invalid_migration_preflight');
 return {database:raw.database,read_only:true,migration:raw.migration,checksum:raw.checksum,
  readiness:raw.readiness,apply_authorized:false};
}
async function boundedJson(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('missing_body');
  let size=0;const chunks=[];
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>65536)throw Error('oversize_response');
      chunks.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function observeDevNile(args,cfg,{fetchImpl=fetch}={}){
  const fail=(stage,sqlstate=null)=>({nile_status:'ERROR',nile_stage:stage,nile_sqlstate:sqlstate,exit_code:1,coarse_error:'nile_diagnostic_failed'});
  if(args.environment!=='dev'||!OPERATIONS.has(args.operation)||!/^[0-9a-f]{40}$/.test(args.expected_source_sha||'')||cfg.project!=='jscc-dev')return fail('admission');
  try{
    const origin=new URL(cfg.devBaseUrl);
    if(origin.protocol!=='https:'||!origin.hostname.endsWith('.run.app')||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.port)return fail('target');
    const metadata=new URL('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity');
    metadata.searchParams.set('audience',AUDIENCE);
    const credential=await fetchImpl(metadata,{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!credential.ok)return fail('identity');
    const token=await credential.text();
    if(!token||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return fail('identity');
    const target=new URL('/admin/dev/nile-diagnostic',origin);
    target.searchParams.set('operation',args.operation);
    target.searchParams.set('expected_source_sha',args.expected_source_sha);
    const response=await fetchImpl(target,{headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(45000)});
    const raw=await boundedJson(response);
    if(raw.source_sha!==args.expected_source_sha||raw.operation!==args.operation)return fail('source_or_response');
    if(!response.ok||raw.status!=='COLLECTED'){
      const stage=['account','transaction','basis','explain','route','connect','begin','tenant_set','tenant_verify','statement_timeout','lock_timeout','database_guard','rollback','schema','runtime_health','migration_013_preflight','tenant_invariants'].includes(raw.stage)?raw.stage:'api';
      return fail(stage,/^[0-9A-Z]{5}$/.test(raw.sqlstate||'')?raw.sqlstate:null);
    }
    if(!Number.isSafeInteger(raw.elapsed_ms)||raw.elapsed_ms<0)return fail('metrics');
    const timing={};
    for(const k of ['Planning Time','Execution Time'])if(Number.isFinite(raw.timing?.[k]))timing[k]=raw.timing[k];
    const evidence=args.operation==='schema_inventory'
      ? {operation:args.operation,elapsed_ms:raw.elapsed_ms,schema:schemaSummary(raw.schema)}
      : args.operation==='runtime_health'
        ? {operation:args.operation,elapsed_ms:raw.elapsed_ms,health:healthSummary(raw.health)}
        : args.operation==='migration_013_preflight'
          ? {operation:args.operation,elapsed_ms:raw.elapsed_ms,migration:migration013Summary(raw.migration)}
          : args.operation==='tenant_invariants'
            ? {operation:args.operation,elapsed_ms:raw.elapsed_ms,invariants:invariantSummary(raw.invariants)}
            : {operation:args.operation,elapsed_ms:raw.elapsed_ms,timing,plan:planSummary(raw.plan)};
    if(args.operation==='schema_inventory'&&typeof raw.runtime_revision==='string'&&/^jscc-command-api-dev-[a-z0-9-]{1,44}$/.test(raw.runtime_revision))evidence.runtime_revision=raw.runtime_revision;
    return {nile_status:'COLLECTED',nile_evidence_json:JSON.stringify(evidence),target_source_sha:raw.source_sha,exit_code:0};
  }catch{return fail('transport_or_response');}
}
