// #589 R5: trusted operator-side Cloud Build API composition, not an MCP handler.
// The independently obtained pin is mandatory; a caller must never hash its own
// request to manufacture approval. No gateway/diagnostics/sandbox credentials.
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {planDevOpsBuild} from '../../ops/build/dev-cloud-build-controller.mjs';
import {operationIdentity,executeApprovedDevBuildOnce,observeDevBuildOnce}
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
 'build-gateway','build-worker','verify-image-source','push-gateway','push-worker','evidence'];
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
 // JSON translation of the existing reviewed YAML is attested out-of-band
 // by config_equivalence. No alternate config, identity or extra fields.
 require(exact(config,['steps','substitutions','serviceAccount','options'])&&
  config.serviceAccount===SA&&exact(config.options,['logging'])&&config.options.logging==='CLOUD_LOGGING_ONLY'&&
  exact(config.substitutions,['_GIT_SHA','_TRUSTED_REF','_GATEWAY_IMAGE','_WORKER_IMAGE'])&&
  config.substitutions._GIT_SHA===''&&config.substitutions._TRUSTED_REF===''&&
  config.substitutions._GATEWAY_IMAGE===REGISTRY+'jscc-ops-gateway'&&
  config.substitutions._WORKER_IMAGE===REGISTRY+'jscc-diagnostics'&&
  Array.isArray(config.steps)&&config.steps.length===STEPS.length&&
  config.steps.every((s,i)=>s&&s.id===STEPS[i])&&JSON.stringify(config).length<=65536,
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
 return hash(await readFile(REPO+'cloudbuild.ops.yaml'));
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
export async function archiveConfigHash(bytes){
 require(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024*1024,'build_archive_size_limit');
 const code=[
  'import sys,tarfile,hashlib,resource',
  'resource.setrlimit(resource.RLIMIT_CPU,(10,10))',
  'resource.setrlimit(resource.RLIMIT_AS,(384*1024*1024,384*1024*1024))',
  'seen=0; total=0; count=0; digest=None',
  'with tarfile.open(fileobj=sys.stdin.buffer,mode="r|gz") as archive:',
  '    for member in archive:',
  '        count+=1; total+=member.size',
  '        if count>20000 or total>128*1024*1024 or member.size<0: raise ValueError("archive_limit")',
  '        if member.name not in ("cloudbuild.ops.yaml","./cloudbuild.ops.yaml"): continue',
  '        seen+=1',
  '        if seen!=1 or not member.isfile() or member.size>65536: raise ValueError("config_member_invalid")',
  '        data=archive.extractfile(member).read(65537)',
  '        if len(data)!=member.size: raise ValueError("config_member_size")',
  '        digest=hashlib.sha256(data).hexdigest()',
  'if seen!=1 or digest is None: raise ValueError("config_member_missing")',
  'print(digest)',
 ].join('\n');
 return new Promise((resolve,reject)=>{
  const child=spawn('python3',['-I','-c',code],{stdio:['pipe','pipe','ignore'],timeout:20000});
  let out='',failed=false;
  const fail=()=>{if(!failed){failed=true;reject(Error('build_archive_config_invalid'));}};
  child.on('error',fail);
  child.stdin.on('error',fail);
  child.stdout.on('data',data=>{
   out+=data.toString('ascii');
   if(out.length>128){child.kill('SIGKILL');fail();}
  });
  child.on('close',status=>{
   if(failed)return;
   const value=out.trim();
   if(status!==0||!HEX.test(value))return fail();
   resolve(value);
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
 if(expectedConfig!==null)require(await archiveConfigHash(Buffer.concat(chunks))===expectedConfig,'build_archive_config_mismatch');
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
   a.fresh();await verifyArchive(request,x.archive,verifyStagedConfig?x.config_yaml_sha256:null);a.fresh();
   return {...a.proof('SOURCE_SNAPSHOT'),object:x.archive.object,
    generation:x.archive.generation,object_sha256:x.archive.sha256};
  },
  verifyCostAdmission:async()=>{a.fresh();return {...a.proof('COST_ADMISSION'),no_incremental_cost_proven:true};},
  dispatch:async approved=>{
   a.fresh();
   require(approved.source_sha===a.plan.source_sha&&approved.trusted_ref===a.plan.trusted_ref&&
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
