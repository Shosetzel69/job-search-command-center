// #589 DEV E2E F1-F3: bounded Cloud Run/Logging/GCS diagnostics.
// Pure functions with injected transports, no shell, IAM or TEST/PROD writes.
const executionRE=/^(jscc-diagnostics-dev|jscc-search-dev)-[a-z0-9-]{5,45}$/;
const runRE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOG_PAGES=8;
const TASK_PAGES=4;
const DEV_BUCKET='jscc-dev-runtime-828902654738';
const GEN=/^[1-9][0-9]{0,19}$/;
const validGeneration=x=>typeof x==='string'&&GEN.test(x);
const resourcePath=x=>typeof x==='string'?x.replace(/^projects\/828902654738\//,'projects/jscc-dev/'):null;

function target(executionId) {
  if(typeof executionId!=='string' || !executionRE.test(executionId)) throw Error('invalid_execution_id');
  return {executionId,job:executionId.startsWith('jscc-search-dev-')?'jscc-search-dev':'jscc-diagnostics-dev'};
}
function requireResponse(response,code) {
  if(!response || typeof response.status!=='number' || typeof response.ok!=='boolean') throw Error(code+'_malformed_response');
  if(!response.ok) throw Error(code+'_'+response.status);
}
function textPayload(entry) {
  if(typeof entry.textPayload==='string') return entry.textPayload;
  if(entry.jsonPayload && typeof entry.jsonPayload==='object') return JSON.stringify(entry.jsonPayload);
  if(entry.protoPayload && typeof entry.protoPayload==='object') return JSON.stringify(entry.protoPayload);
  return '';
}

export async function listExecutionTaskEvidence(executionId,{request}) {
  const {job}=target(executionId);
  if(typeof request!=='function')throw Error('task_transport_missing');
  const url='https://run.googleapis.com/v2/projects/jscc-dev/locations/europe-west1/jobs/'+job+'/executions/'+executionId+'/tasks';
  const parent=url.slice('https://run.googleapis.com/v2/'.length,-'/tasks'.length);
  let token='',pages=0,tasks=[];
  const seen=new Set(),names=new Set(),indexes=new Set();
  do{
    if(pages===TASK_PAGES)throw Error('task_pagination_limit');
    const query=new URLSearchParams({pageSize:'100'});
    if(token)query.set('pageToken',token);
    const r=await request(url+'?'+query);
    if(!r?.ok && [403,404].includes(r?.status))
      return {task_metadata_available:false,task_metadata_error:'task_read_'+r.status,tasks:[],task_count_verified:0};
    requireResponse(r,'task_read');
    const json=await r.json();
    if(!json || !Array.isArray(json.tasks||[]) || (json.tasks||[]).length>100)throw Error('task_response_invalid');
    for(const task of json.tasks||[]){
      const name=resourcePath(task?.name),index=task?.index??0;
      if(!name?.startsWith(parent+'/tasks/')||!(/^[a-z0-9-]{1,100}$/.test(name.slice((parent+'/tasks/').length)))||
         (task.job!==job&&resourcePath(task.job)!==parent.split('/executions/')[0])||
         (task.execution!==executionId&&resourcePath(task.execution)!==parent)||
         !Number.isInteger(index)||index<0||index>=1000||names.has(name)||indexes.has(index))
        throw Error('task_resource_binding_mismatch');
      names.add(name);indexes.add(index);
      const attempt=task.lastAttemptResult||{},status=attempt.status||{};
      if((attempt.exitCode!==undefined&&!Number.isInteger(attempt.exitCode))||
         (attempt.termSignal!==undefined&&!Number.isInteger(attempt.termSignal)))
        throw Error('task_attempt_invalid');
      // Keep only fields consumed by the existing diagnostics worker.
      const safeMessage=x=>typeof x==='string'?x.slice(0,2048):undefined;
      tasks.push({name,index,lastAttemptResult:{
        ...(attempt.exitCode===undefined?{}:{exitCode:attempt.exitCode}),
        ...(attempt.termSignal===undefined?{}:{termSignal:attempt.termSignal}),
        status:{...(Number.isInteger(status.code)?{code:status.code}:{}),message:safeMessage(status.message)}},
        conditions:(Array.isArray(task.conditions)?task.conditions:[]).slice(0,20).map(c=>({message:safeMessage(c?.message)}))});
    }
    if(tasks.length>400)throw Error('task_result_limit');
    token=json.nextPageToken || '';
    if(typeof token!=='string' || token.length>2048 || (token && seen.has(token)))throw Error('task_page_token_invalid');
    if(token)seen.add(token);
    pages++;
  }while(token);
  return {task_metadata_available:true,task_metadata_error:null,tasks,task_count_verified:tasks.length};
}

export async function readBoundedExecutionLogs({execution_id,limit,view,request,sanitize}) {
  const {executionId,job}=target(execution_id);
  if(!Number.isInteger(limit) || limit<1 || limit>200)throw Error('invalid_log_limit');
  if(typeof view!=='string' ||
      !/^projects\/jscc-dev\/locations\/[a-z0-9-]+\/buckets\/_Default\/views\/jscc-ops-dev$/.test(view))
    throw Error('invalid_log_view');
  if(typeof request!=='function' || typeof sanitize!=='function')throw Error('log_dependencies_missing');
  const filter='resource.type="cloud_run_job"'+
    ' AND resource.labels.project_id="jscc-dev"'+
    ' AND resource.labels.location="europe-west1"'+
    ' AND resource.labels.job_name="'+job+'"'+
    ' AND (labels.execution_name="'+executionId+'" OR labels."run.googleapis.com/execution_name"="'+executionId+'")';
  const lines=[], visited=new Set(),entryIds=new Set();
  let truncated=false;
  let nextPageToken='',pages=0,complete=false;
  do{
    if(pages>=LOG_PAGES)break;
    const req={resourceNames:[view],filter,orderBy:'timestamp desc',pageSize:Math.min(100,limit)};
    if(nextPageToken)req.pageToken=nextPageToken;
    const r=await request('https://logging.googleapis.com/v2/entries:list',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)
    });
    requireResponse(r,'logging_read');
    const data=await r.json();
    if(!data || !Array.isArray(data.entries || []) || (data.entries||[]).length>100)
      throw Error('logging_response_invalid');
    for(const entry of data.entries || []){
      const resource=entry?.resource;
      const labels=resource?.labels || {};
      const eLabels=entry?.labels || {};
      if(resource?.type!=='cloud_run_job' || labels.project_id!=='jscc-dev' ||
         labels.location!=='europe-west1' || labels.job_name!==job ||
         (eLabels.execution_name!==executionId && eLabels['run.googleapis.com/execution_name']!==executionId)||
         (Object.hasOwn(eLabels,'execution_name')&&eLabels.execution_name!==executionId)||
         (Object.hasOwn(eLabels,'run.googleapis.com/execution_name')&&eLabels['run.googleapis.com/execution_name']!==executionId))
        throw Error('logging_execution_binding_mismatch');
      if(typeof entry.insertId==='string'&&entry.insertId.length){
        if(entry.insertId.length>1024)throw Error('log_entry_id_invalid');
        const key=JSON.stringify([entry.logName??null,entry.timestamp??null,entry.insertId]);
        if(entryIds.has(key))continue;
        entryIds.add(key);
      }
      const payload=textPayload(entry);
      if(payload.length>8192)throw Error('log_payload_too_large');
      const clean=sanitize(payload);
      if(clean){if(lines.length<limit)lines.push(clean);else truncated=true;}
    }
    nextPageToken=data.nextPageToken || '';
    if(typeof nextPageToken!=='string' || nextPageToken.length>2048 ||
       (nextPageToken && visited.has(nextPageToken))) throw Error('log_page_token_invalid');
    if(nextPageToken)visited.add(nextPageToken);
    pages++;
    complete=!nextPageToken;
  }while(!complete && lines.length<limit);
  const excerpt=sanitize(lines.join('\n'));
  return {
    target_alias:executionId,line_count:lines.length,log_excerpt:excerpt,logs:lines,
    log_evidence_verified:lines.length>0,
    log_search_complete:complete&&!truncated,
    log_lookup_status:lines.length>0?'FOUND':complete?'NO_MATCHING_ENTRIES':'INCOMPLETE',
  };
}

export async function inspectDevRunSnapshot({run_id,runtimeBucket,readStatus,readMetadata}) {
  if(typeof run_id!=='string' || !runRE.test(run_id) || run_id.includes('..'))throw Error('invalid_run_id');
  if(runtimeBucket!==DEV_BUCKET)
    throw Error('runtime_bucket_not_configured');
  if(typeof readStatus!=='function' || typeof readMetadata!=='function')throw Error('snapshot_transport_missing');
  const status=await readStatus(runtimeBucket,'runs/'+run_id+'/run-status.json');
  if(!status)throw Error('runtime_snapshot_not_found');
  if(!status.data || typeof status.data!=='object' || Array.isArray(status.data))
    throw Error('runtime_snapshot_invalid');
  if(status.data.run_id!==run_id)throw Error('runtime_snapshot_id_mismatch');
  if(!validGeneration(status.generation))throw Error('runtime_snapshot_generation_unverified');
  const num=status.data.jobs_published ?? status.data.results;
  const published=Number.isInteger(num)&&num>=0?num:null;
  // Metadata-only GET. Avoid reading jobs.json, which can contain sensitive data.
  let jobsPresent=null,jobsEvidence='UNVERIFIED';
  const meta=await readMetadata(runtimeBucket,'runs/'+run_id+'/jobs.json');
  if(meta?.status===200){
    if(meta.bucket!==runtimeBucket||meta.name!=='runs/'+run_id+'/jobs.json'||!validGeneration(meta.generation)||
       (meta.contentType&&typeof meta.contentType!=='string'))throw Error('jobs_metadata_invalid');
    jobsPresent=true;jobsEvidence='METADATA_FOUND';
  } else if(meta?.status===404) {
    jobsPresent=false;jobsEvidence='METADATA_NOT_FOUND';
  } else if(meta?.status===403){
    jobsEvidence='METADATA_DENIED';
  } else if(meta?.status===null || meta===null) {
    jobsEvidence='UNVERIFIED';
  } else throw Error('jobs_metadata_read_failed');
  const after=await readStatus(runtimeBucket,'runs/'+run_id+'/run-status.json');
  if(after?.generation!==status.generation||after.data?.run_id!==run_id)throw Error('runtime_snapshot_generation_drift');
  const rawState=status.data.status||status.data.state||null;
  const runStatus=typeof rawState==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(rawState)?rawState:null;
  return {
    target_alias:run_id,run_status:runStatus,
    published_jobs:published,status_present:true,
    jobs_present:jobsPresent,jobs_evidence:jobsEvidence,
  };
}
