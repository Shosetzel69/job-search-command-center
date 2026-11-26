// #589: existing diagnostics worker uses only its own Google identity.
// This module never receives a DB connection string or caller-supplied URL.
const AUDIENCE='urn:jscc:dev:nile-diagnostic';
const OPERATIONS=new Set(['fit_verify_plan','global_listing_plan','fit_verify_analyze','global_listing_analyze']);
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
      const stage=['account','transaction','basis','explain','route','connect','begin','tenant_set','tenant_verify','statement_timeout','lock_timeout','database_guard','rollback'].includes(raw.stage)?raw.stage:'api';
      return fail(stage,/^[0-9A-Z]{5}$/.test(raw.sqlstate||'')?raw.sqlstate:null);
    }
    if(!Number.isSafeInteger(raw.elapsed_ms)||raw.elapsed_ms<0)return fail('metrics');
    const timing={};
    for(const k of ['Planning Time','Execution Time'])if(Number.isFinite(raw.timing?.[k]))timing[k]=raw.timing[k];
    const evidence={operation:args.operation,elapsed_ms:raw.elapsed_ms,timing,plan:planSummary(raw.plan)};
    return {nile_status:'COLLECTED',nile_evidence_json:JSON.stringify(evidence),target_source_sha:raw.source_sha,exit_code:0};
  }catch{return fail('transport_or_response');}
}
