// #589 R5: trusted operator-side Cloud Build API composition, not an MCP handler.
// The independently obtained pin is mandatory; a caller must never hash its own
// request to manufacture approval. No gateway/diagnostics/sandbox credentials.
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {planDevOpsBuild,projectDevBuildStatus} from '../../ops/build/dev-cloud-build-controller.mjs';
import {operationIdentity,executeApprovedDevBuildOnce,observeDevBuildOnce,reconcileDevBuildSubmission}
 from '../../ops/control/dev-build-operation-ledger.mjs';
import {evidenceDigest,operatorBuildStore} from './remote_executor_dev_admission.mjs';

const exec=promisify(execFile);
const REPO=fileURLToPath(new URL('../../',import.meta.url));
const ROOT='https://cloudbuild.googleapis.com/v1/projects/jscc-shared/locations/europe-west1/builds';
const BUCKET='jscc-shared-ops-cloudbuild-source';
const SA='projects/jscc-shared/serviceAccounts/jscc-ops-build@jscc-shared.iam.gserviceaccount.com';
const REGISTRY='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const HEX=/^[a-f0-9]{64}$/;
const REF=/^#589\/[1-9][0-9]{0,19}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STEPS=['trusted-source-admission','materialize-verified-source','validate-candidate',
 'python-contract-tests','ops-contract-tests','registry-immutability','detect-existing-images',
 'build-gateway','build-worker','build-operator','verify-image-source','push-gateway','push-worker','push-operator','evidence'];
const WORKSPACE_STEPS=['trusted-source-admission','materialize-verified-source','immutable-workspace-baselines',
 'workspace-manager-contract-tests','build-manager-r2','build-worker-r2','worker-image-cwd-smoke',
 'manager-image-route-smoke','verify-workspace-image-source','push-manager-r2','push-worker-r2','digest-evidence'];
const WORKSPACE_SUBSTITUTIONS={
 _GIT_SHA:'',_TRUSTED_REF:'',
 _MANAGER_BASE:REGISTRY+'jscc-dev-workspace-manager-r2@sha256:ac80ef6e88a57b78c51c958930bc345141fa85d569544cf085f10c33323b99f1',
 _MANAGER_IMAGE:REGISTRY+'jscc-dev-workspace-manager-r2',
 _WORKER_BASE:REGISTRY+'jscc-dev-workspace-worker-cap100@sha256:1dc1354d2777b0e7e65a1d07758d012c66f15d223fd1fec4fee3e82cd02ce617',
 _WORKER_IMAGE:REGISTRY+'jscc-dev-workspace-worker-cap100'};
const OPS_SUBSTITUTIONS={_GIT_SHA:'',_TRUSTED_REF:'',_GATEWAY_IMAGE:REGISTRY+'jscc-ops-gateway',
 _WORKER_IMAGE:REGISTRY+'jscc-diagnostics',_OPERATOR_IMAGE:REGISTRY+'jscc-ops-operator'};
const stepsFor=plan=>plan.build_kind==='workspace_r2'?WORKSPACE_STEPS:STEPS;
const substitutionsFor=(plan,config)=>plan.build_kind==='workspace_r2'?WORKSPACE_SUBSTITUTIONS:
 Object.hasOwn(config?.substitutions||{},'_PUBLISHER_IMAGE')?
 {...OPS_SUBSTITUTIONS,_PUBLISHER_IMAGE:REGISTRY+'jscc-ops-publisher'}:OPS_SUBSTITUTIONS;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function require(ok,code){if(!ok)throw Error(code);}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function admitBuildBundle(bundle,pin,now=Date.now){
 require(typeof pin==='string'&&HEX.test(pin)&&
  exact(bundle,['schema_version','request','actor_sub_hash','idempotency_key','archive',
   'config_yaml_sha256','build_config','evidence','issued_at_ms','expires_at_ms']),
  'invalid_build_evidence_bundle');
 require(evidenceDigest(bundle)===pin,'build_evidence_pin_mismatch');
 const x=freeze(JSON.parse(JSON.stringify(bundle)));
 const plan=planDevOpsBuild(x.request);
 require(x.schema_version==='1.0'&&plan.work_item_ref==='#589','build_scope_denied');
 const identity=operationIdentity({actor_sub_hash:x.actor_sub_hash,
  idempotency_key:x.idempotency_key,request:x.request});
 require(exact(x.archive,['bucket','object','generation','sha256'])&&
  x.archive.bucket===BUCKET&&typeof x.archive.object==='string'&&
  /^source\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.tar\.gz$/.test(x.archive.object)&&
  !x.archive.object.includes('..')&&typeof x.archive.generation==='string'&&
  /^[1-9][0-9]{0,19}$/.test(x.archive.generation)&&
  typeof x.archive.sha256==='string'&&/^sha256:[a-f0-9]{64}$/.test(x.archive.sha256),
  'invalid_build_source_archive');
 require(typeof x.config_yaml_sha256==='string'&&HEX.test(x.config_yaml_sha256)&&
  exact(x.evidence,['approval','independent_review','source_snapshot','config_equivalence',
   'cost','operator_access','lifecycle'])&&Object.values(x.evidence).every(v=>typeof v==='string'&&REF.test(v)),
  'build_authoritative_evidence_missing');
 const config=x.build_config;
 // The protected approval pins the exact JSON translation. The remote Job
 // additionally parses and compares the archived YAML before submission.
 require(exact(config,['steps','substitutions','serviceAccount','options'])&&
  config.serviceAccount===SA&&exact(config.options,['logging'])&&config.options.logging==='CLOUD_LOGGING_ONLY'&&
  exact(config.substitutions,Object.keys(substitutionsFor(plan,config)))&&
  evidenceDigest(config.substitutions)===evidenceDigest(substitutionsFor(plan,config))&&
  Array.isArray(config.steps)&&config.steps.length===stepsFor(plan).length&&
  config.steps.every((s,i)=>s&&s.id===stepsFor(plan)[i])&&JSON.stringify(config).length<=65536,
  'build_config_scope_denied');
 require(Number.isSafeInteger(x.issued_at_ms)&&Number.isSafeInteger(x.expires_at_ms)&&
  x.expires_at_ms>x.issued_at_ms&&x.expires_at_ms-x.issued_at_ms<=3600000,'build_evidence_window_invalid');
 function fresh(){
  const t=now();
  require(Number.isSafeInteger(t)&&t>=x.issued_at_ms&&t<x.expires_at_ms,'build_evidence_window_closed');
 }
 fresh();
 const proof=kind=>({kind,verified:true,work_item_ref:'#589',source_sha:plan.source_sha,
  trusted_ref:plan.trusted_ref});
 return {bundle:x,identity,plan,fresh,proof};
}

async function checkedSource(plan){
 const git=async(...args)=>(await exec('git',args,{cwd:REPO,timeout:30000,maxBuffer:65536})).stdout.trim();
 require(await git('rev-parse','HEAD')===plan.source_sha&&await git('status','--porcelain')==='',
  'build_operator_source_mismatch');
 const remote=await git('ls-remote','https://github.com/Shosetzel69/job-search-command-center.git',plan.trusted_ref);
 require(remote===plan.source_sha+'\t'+plan.trusted_ref,'build_trusted_ref_mismatch');
 return hash(await readFile(REPO+plan.config));
}
async function token(){
 const {stdout}=await exec('gcloud',['auth','print-access-token','--quiet'],{timeout:30000,maxBuffer:65536});
 return stdout.trim();
}
function operatorTransport(getToken,fetchImpl){
 return async(url,{method='GET',body,timeout=20000}={})=>{
  const t=await getToken();
  require(typeof t==='string'&&t.length>0,'operator_token_missing');
  const headers={Authorization:'Bearer '+t,Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetchImpl(url,{method,headers,redirect:'error',
   signal:AbortSignal.timeout(timeout),...(body!==undefined?{body:JSON.stringify(body)}:{})});
  require(response.ok,'build_operator_http_error');
  return response;
 };
}
async function verifyLifecycle(request,now){
 const response=await request('https://storage.googleapis.com/storage/v1/b/jscc-dev-ops-state?fields=name,location,lifecycle,updated');
 const value=await response.json();
 const expected=JSON.parse(await readFile(new URL('./remote_executor_dev_lifecycle.json',import.meta.url),'utf8'));
 require(value.name==='jscc-dev-ops-state'&&String(value.location).toUpperCase()==='EUROPE-WEST1'&&
  evidenceDigest(value.lifecycle)===evidenceDigest(expected)&&
  Number.isFinite(Date.parse(value.updated))&&now()-Date.parse(value.updated)>=86400000,
  'build_ledger_lifecycle_not_settled');
}
// Inspect only the top-level reviewed build YAML. The tar is never extracted
// to disk; the parser is a fixed stdlib program with bounded input/output.
export async function archiveConfigHash(bytes,{verifyConfig=false,configPath='cloudbuild.ops.yaml'}={}){
 require(['cloudbuild.ops.yaml','cloudbuild.workspace-manager-r2.yaml'].includes(configPath),'build_archive_config_path_denied');
 require(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024*1024,'build_archive_size_limit');
 const code=[
  'import sys,tarfile,hashlib,resource',
  'resource.setrlimit(resource.RLIMIT_CPU,(10,10))',
  'resource.setrlimit(resource.RLIMIT_AS,(384*1024*1024,384*1024*1024))',
  'seen=0; total=0; count=0; digest=None; data=None',
  'with tarfile.open(fileobj=sys.stdin.buffer,mode="r|gz") as archive:',
  '    for member in archive:',
  '        count+=1; total+=member.size',
  '        if count>20000 or total>128*1024*1024 or member.size<0: raise ValueError("archive_limit")',
  '        if member.name not in (sys.argv[2],"./"+sys.argv[2]): continue',
  '        seen+=1',
  '        if seen!=1 or not member.isfile() or member.size>65536: raise ValueError("config_member_invalid")',
  '        data=archive.extractfile(member).read(65537)',
  '        if len(data)!=member.size: raise ValueError("config_member_size")',
  '        digest=hashlib.sha256(data).hexdigest()',
  'if seen!=1 or digest is None: raise ValueError("config_member_missing")',
  'if sys.argv[1]=="verify":',
  '    import json,yaml',
  '    class UniqueLoader(yaml.SafeLoader): pass',
  '    def mapping(loader,node):',
  '        out={}',
  '        for k,v in node.value:',
  '            key=loader.construct_object(k)',
  '            if not isinstance(key,str) or key in out: raise ValueError("config_duplicate_key")',
  '            out[key]=loader.construct_object(v)',
  '        return out',
  '    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,mapping)',
  '    value=yaml.load(data,Loader=UniqueLoader)',
  '    print(json.dumps({"sha256":digest,"config":value},allow_nan=False,separators=(",",":")))',
  'else: print(digest)',
 ].join('\n');
 return new Promise((resolve,reject)=>{
  const child=spawn('python3',['-I','-c',code,verifyConfig?'verify':'hash',configPath],{stdio:['pipe','pipe','ignore'],timeout:20000});
  let out='',failed=false;
  const fail=()=>{if(!failed){failed=true;reject(Error('build_archive_config_invalid'));}};
  child.on('error',fail);
  child.stdin.on('error',fail);
  child.stdout.on('data',data=>{
   out+=data.toString('ascii');
   if(out.length>(verifyConfig?131072:128)){child.kill('SIGKILL');fail();}
  });
  child.on('close',status=>{
   if(failed)return;
   const value=out.trim();
   if(status!==0)return fail();
   if(!verifyConfig){if(!HEX.test(value))return fail();resolve(value);return;}
   try{
    const parsed=JSON.parse(value);
    if(!HEX.test(parsed?.sha256||'')||!parsed.config||typeof parsed.config!=='object')return fail();
    resolve(parsed);
   }catch{return fail();}
  });
  child.stdin.end(bytes);
 });
}
async function verifyArchive(request,archive,expectedConfig=null){
 const url='https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o/'+
  encodeURIComponent(archive.object)+'?'+new URLSearchParams({alt:'media',generation:archive.generation});
 const response=await request(url,{timeout:60000});
 const generation=response.headers.get('x-goog-generation');
 require(generation===null||generation===archive.generation,'build_archive_generation_mismatch');
 require(response.body,'build_archive_missing_body');
 const digest=createHash('sha256');
 let size=0;const chunks=[];
 for await(const chunk of response.body){
  size+=chunk.byteLength;
  require(size<=64*1024*1024,'build_archive_size_limit');
  digest.update(chunk);
  if(expectedConfig!==null)chunks.push(Buffer.from(chunk));
 }
 require(size>0&&'sha256:'+digest.digest('hex')===archive.sha256,'build_archive_digest_mismatch');
 if(expectedConfig!==null){
  const parsed=await archiveConfigHash(Buffer.concat(chunks),{verifyConfig:true,configPath:expectedConfig.configPath});
  require(parsed.sha256===expectedConfig.sha256&&evidenceDigest(parsed.config)===expectedConfig.config_hash,
   'build_archive_config_mismatch');
 }
}

/** Only an already admitted independent operator calls this function.
 * No public mutation handler is added. All GCS/Cloud Build calls use fixed
 * existing resources and current operator access; no fallback submission.
 */
export async function runApprovedBuild({bundle,trustedEvidenceHash}, {
 getToken=token,fetchImpl=fetch,store=operatorBuildStore({getToken,fetchImpl}),
 readSource=checkedSource,verifyStagedConfig=false,now=Date.now,
}={}){
 const a=admitBuildBundle(bundle,trustedEvidenceHash,now),x=a.bundle;
 const request=operatorTransport(getToken,fetchImpl);
 // Check the independently pinned cost and access evidence before these
 // observations; the actual financial proof is supplied out of band.
 // A deployed operator uses the independently reviewed staged archive, not
 // its own code checkout as the future candidate source. Cloud Build still
 // independently verifies the exact trusted Git ref before building.
 if(!verifyStagedConfig)require(await readSource(a.plan)===x.config_yaml_sha256,'build_config_yaml_mismatch');
 await verifyLifecycle(request,now);
 a.fresh();
 return executeApprovedDevBuildOnce(a.identity,store,{
  verifyApproval:async()=>{a.fresh();return {...a.proof('OWNER_APPROVAL'),approval_ref:x.evidence.approval};},
  verifyTrustedRef:async()=>{a.fresh();return a.proof('TRUSTED_REF');},
  verifySourceSnapshot:async()=>{
   a.fresh();await verifyArchive(request,x.archive,verifyStagedConfig?{sha256:x.config_yaml_sha256,config_hash:evidenceDigest(x.build_config),configPath:a.plan.config}:null);a.fresh();
   return {...a.proof('SOURCE_SNAPSHOT'),object:x.archive.object,
    generation:x.archive.generation,object_sha256:x.archive.sha256};
  },
  verifyCostAdmission:async()=>{a.fresh();return {...a.proof('COST_ADMISSION'),no_incremental_cost_proven:true};},
  dispatch:async approved=>{
   a.fresh();
   require(approved.source_sha===a.plan.source_sha&&approved.trusted_ref===a.plan.trusted_ref&&
    approved.config===a.plan.config&&approved.script===a.plan.script&&
    approved.approval_ref===x.evidence.approval&&approved.source_bucket===BUCKET&&
    approved.approved_source_object===x.archive.object&&approved.approved_source_generation===x.archive.generation&&
    approved.approved_source_sha256===x.archive.sha256,'build_dispatch_binding_mismatch');
   const body={...x.build_config,substitutions:{...x.build_config.substitutions,
     _GIT_SHA:a.plan.source_sha,_TRUSTED_REF:a.plan.trusted_ref},
    source:{storageSource:{bucket:BUCKET,object:x.archive.object,generation:x.archive.generation}}};
   const response=await request(ROOT+'?projectId=jscc-shared',{method:'POST',body});
   const operation=await response.json(),build=operation?.metadata?.build;
   require(!operation?.error&&build&&UUID.test(String(build.id))&&
    build.name==='projects/jscc-shared/locations/europe-west1/builds/'+build.id&&
    build.serviceAccount===SA&&build.substitutions?._GIT_SHA===a.plan.source_sha&&
    build.substitutions?._TRUSTED_REF===a.plan.trusted_ref&&
    evidenceDigest(build.source?.storageSource)===evidenceDigest(body.source.storageSource),
    'build_submit_receipt_unverified');
   return {build_id:build.id,project:'jscc-shared',region:'europe-west1',
    source_sha:a.plan.source_sha,approval_ref:x.evidence.approval};
  },
 });
}

export async function observeApprovedBuild(identity,{
 getToken=token,fetchImpl=fetch,store=operatorBuildStore({getToken,fetchImpl}),
}={}){
 const request=operatorTransport(getToken,fetchImpl);
 return observeDevBuildOnce(identity,store,{getBuild:async({build_id,project,region})=>{
  require(project==='jscc-shared'&&region==='europe-west1'&&UUID.test(String(build_id)),'build_observe_denied');
  return (await request(ROOT+'/'+build_id)).json();
 }});
}

// Cancellation requires a NEW authoritative approval and the exact original
// submitted build identity. The operator Job's immutable claim prevents
// automatic replay; an uncertain POST is reconciled by observation only.
export async function cancelApprovedBuild(original,expectedBuildId,{
 getToken=token,fetchImpl=fetch,store=operatorBuildStore({getToken,fetchImpl}),
 assertFresh,now=Date.now,
}={}){
 require(typeof assertFresh==='function'&&UUID.test(String(expectedBuildId)),
  'build_cancel_admission_missing');
 const plan=planDevOpsBuild(original.request);
 require(plan.work_item_ref==='#589'&&original.archive?.bucket===BUCKET,'build_cancel_scope_denied');
 const identity=operationIdentity({actor_sub_hash:original.actor_sub_hash,
  idempotency_key:original.idempotency_key,request:original.request});
 const current=await store.get(identity.path),rec=current?.data;
 require(current?.generation&&rec?.operation_id===identity.key&&
  rec.request_hash===identity.request_hash&&rec.actor_sub_hash===identity.actor_sub_hash&&
  rec.approval_ref===original.evidence?.approval&&rec.source_sha===plan.source_sha&&
  rec.trusted_ref===plan.trusted_ref&&rec.build_id===expectedBuildId&&
  rec.source_object===original.archive.object&&rec.source_generation===original.archive.generation&&
  rec.source_sha256===original.archive.sha256&&
  ['SUBMITTED','WORKING','SUCCEEDED','FAILED','CANCELLED'].includes(rec.state),
  'build_cancel_original_mismatch');
 const request=operatorTransport(getToken,fetchImpl);
 const url=ROOT+'/'+expectedBuildId;
 const expected={project:'jscc-shared',region:'europe-west1',build_id:expectedBuildId,source_sha:plan.source_sha};
 const verify=raw=>{
  const status=projectDevBuildStatus(raw,expected);
  require(raw.substitutions?._GIT_SHA===plan.source_sha&&raw.substitutions?._TRUSTED_REF===plan.trusted_ref&&
   evidenceDigest(raw.source?.storageSource)===evidenceDigest({bucket:BUCKET,
    object:original.archive.object,generation:original.archive.generation}),
   'build_cancel_provider_binding_mismatch');
  return status;
 };
 assertFresh();
 await verifyLifecycle(request,now);
 const before=verify(await (await request(url)).json());
 if(!before.terminal){
  require(['SUBMITTED','WORKING'].includes(rec.state)&&['PENDING','QUEUED','WORKING'].includes(before.status),
   'build_cancel_state_denied');
  assertFresh();
  // Re-read the durable original just before mutation. Observation may have
  // advanced the ledger; if so stop instead of racing that state transition.
  const latest=await store.get(identity.path);
  require(latest?.generation===current.generation&&evidenceDigest(latest.data)===evidenceDigest(rec),
   'build_cancel_ledger_changed');
  assertFresh();
  const reply=await request(url+':cancel',{method:'POST',body:{projectId:'jscc-shared',id:expectedBuildId}});
  verify(await reply.json());
 }
 // Only a fresh provider observation confirms CANCELLED (or a competing
 // terminal outcome). No automatic second cancellation.
 const afterRaw=await (await request(url)).json();
 const after=verify(afterRaw);
 const observed=await observeDevBuildOnce(identity,store,{getBuild:async()=>afterRaw});
 const state=after.status==='CANCELLED'?'CANCELLED':after.status==='SUCCESS'?'SUCCEEDED':
  after.terminal?'FAILED':'WORKING';
 require(observed.state===state,'build_cancel_ledger_provider_conflict');
 return {operation_id:identity.key,build_id:expectedBuildId,state,source_provenance:'UNVERIFIED'};
}


// Read exact original build evidence, even after its durable ledger has
// reached a terminal state. The same provider response feeds reconciliation.
// Never expose raw args, substitutions, URLs, secrets, logs or failure detail.
export async function observeApprovedBuildEvidence(original,{
 getToken=token,fetchImpl=fetch,store=operatorBuildStore({getToken,fetchImpl}),
}={}){
 const plan=planDevOpsBuild(original.request);
 const identity=operationIdentity({actor_sub_hash:original.actor_sub_hash,
  idempotency_key:original.idempotency_key,request:original.request});
 const stored=await store.get(identity.path),rec=stored?.data;
 require(plan.work_item_ref==='#589'&&stored?.generation&&rec?.operation_id===identity.key&&
  rec.request_hash===identity.request_hash&&rec.actor_sub_hash===identity.actor_sub_hash&&
  rec.approval_ref===original.evidence?.approval&&rec.source_sha===plan.source_sha&&
  rec.trusted_ref===plan.trusted_ref&&original.archive?.bucket===BUCKET&&
  rec.source_object===original.archive.object&&rec.source_generation===original.archive.generation&&
  rec.source_sha256===original.archive.sha256&&UUID.test(rec.build_id||'')&&
  ['SUBMITTED','WORKING','SUCCEEDED','FAILED','CANCELLED'].includes(rec.state),
  'build_observe_original_mismatch');
 const request=operatorTransport(getToken,fetchImpl);
 const raw=await (await request(ROOT+'/'+rec.build_id)).json();
 const status=projectDevBuildStatus(raw,{project:'jscc-shared',region:'europe-west1',
  build_id:rec.build_id,source_sha:plan.source_sha});
 const source={bucket:BUCKET,object:rec.source_object,generation:rec.source_generation};
 require(raw.substitutions?._GIT_SHA===plan.source_sha&&raw.substitutions?._TRUSTED_REF===plan.trusted_ref&&
  evidenceDigest(raw.source?.storageSource)===evidenceDigest(source),'build_observe_provider_binding_mismatch');
 const resolved=raw.sourceProvenance?.resolvedStorageSource;
 require(resolved===undefined||evidenceDigest(resolved)===evidenceDigest(source),
  'build_observe_resolved_source_mismatch');
 const steps=raw.steps;
 const allowedStatus=new Set(['STATUS_UNKNOWN','PENDING','QUEUED','WORKING','SUCCESS','FAILURE',
  'INTERNAL_ERROR','TIMEOUT','CANCELLED','EXPIRED']);
 require(steps===undefined||Array.isArray(steps)&&steps.length===stepsFor(plan).length&&
  steps.every((x,i)=>x?.id===stepsFor(plan)[i]&&(x.status===undefined||allowedStatus.has(x.status))),
  'build_observe_step_identity_mismatch');
 const observations=(steps||[]).map(x=>({id:x.id,status:x.status||'STATUS_UNKNOWN'}));
 const next=await observeDevBuildOnce(identity,store,{getBuild:async()=>raw});
 const expectedState=status.status==='SUCCESS'?'SUCCEEDED':status.status==='CANCELLED'?'CANCELLED':
  status.terminal?'FAILED':'WORKING';
 require(next.state===expectedState,'build_observe_ledger_provider_conflict');
 return {operation_id:identity.key,build_id:rec.build_id,state:next.state,source_provenance:'UNVERIFIED',
  build_observation:{...(plan.build_kind?{build_kind:plan.build_kind}:{}),source_sha:plan.source_sha,archive_generation:rec.source_generation,
   archive_binding:resolved===undefined?'REQUEST_MATCH_ONLY':'RESOLVED_MATCH',
   build_status:status.status,steps:observations,immutable_image_count:status.immutable_image_count}};
}


// Independent review identifies one exact build from submission audit, not
// merely a matching SHA. Legacy arbitrary archive names cannot be recovered.
export async function reconcileApprovedBuild(original,buildId,{getToken,fetchImpl=fetch,
 store=operatorBuildStore({getToken,fetchImpl}),assertFresh,now=Date.now}={}){
 require(typeof getToken==='function'&&typeof assertFresh==='function'&&UUID.test(buildId||''),'build_recovery_admission_missing');
 const a=admitBuildBundle(original,evidenceDigest(original),()=>original.issued_at_ms),x=a.bundle;
 require(x.archive.object==='source/dev-'+a.plan.source_sha+'-'+hash(x.evidence.approval)+'.tar.gz',
  'build_recovery_unique_archive_required');
 const request=operatorTransport(getToken,fetchImpl);
 assertFresh();await verifyLifecycle(request,now);
 return reconcileDevBuildSubmission(a.identity,store,{approvalRef:x.evidence.approval,archive:x.archive,buildId,assertFresh,
  verifyBuild:async record=>{
   const raw=await (await request(ROOT+'/'+buildId)).json();
   const storage={bucket:BUCKET,object:x.archive.object,generation:x.archive.generation};
   const substitutions={...x.build_config.substitutions,_GIT_SHA:a.plan.source_sha,_TRUSTED_REF:a.plan.trusted_ref};
   const created=Date.parse(raw.createTime),intent=Date.parse(record.created_at);
   require(Number.isFinite(created)&&Number.isFinite(intent)&&created>=Math.max(intent,x.issued_at_ms)&&
    created<=x.expires_at_ms&&raw.serviceAccount===SA&&raw.name==='projects/jscc-shared/locations/europe-west1/builds/'+buildId&&
    evidenceDigest(raw.source?.storageSource)===evidenceDigest(storage)&&
    evidenceDigest(raw.sourceProvenance?.resolvedStorageSource)===evidenceDigest(storage)&&
    Object.entries(substitutions).every(([k,v])=>raw.substitutions?.[k]===v)&&
    Object.keys(raw.substitutions||{}).filter(k=>k.startsWith('_')).every(k=>Object.hasOwn(substitutions,k))&&
    raw.options?.logging==='CLOUD_LOGGING_ONLY'&&Array.isArray(raw.steps)&&raw.steps.length===x.build_config.steps.length&&
    raw.steps.every((step,i)=>Object.entries(x.build_config.steps[i]).every(([k,v])=>evidenceDigest(step[k])===evidenceDigest(v))),
    'build_recovery_provider_binding_mismatch');
   return raw;
  }});
}
