// #589: observe the existing product release, never deploy or acquire/release Retrieve locks.
import {gcpFetch} from '../src/lib.mjs';
import {operatorExact,operatorRequire,operatorHash} from '../src/dev_operator_contract.mjs';
const ROOT='projects/jscc-dev/locations/europe-west1';
const RUN='https://run.googleapis.com/v2/';
const REGISTRY='projects/jscc-shared/locations/europe-west1/repositories/jscc';
const IMAGES='europe-west1-docker.pkg.dev/jscc-shared/jscc/';
const BUILD='projects/jscc-shared/locations/europe-west1/builds/';
const SA='jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com';
const BUILDER='projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com';
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const OP=/^op-[a-z0-9_-]{10,100}$/;
const GEN=/^[1-9][0-9]{0,19}$/;
const match=(re,x)=>typeof x==='string'&&re.test(x);
const bound=(value,path)=>value===path||value===path.replace('projects/jscc-dev/','projects/828902654738/');
async function get(fetchImpl,url,{optional=false}={}){
 const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(optional&&[403,404].includes(response.status))return null;
 operatorRequire(response.ok,'product_release_observation_http_error');
 const raw=await response.text();
 operatorRequire(Buffer.byteLength(raw)<=262144,'product_release_observation_limit');
 return JSON.parse(raw);
}
function resource(task,role,revision=null){
 operatorRequire(task?.serviceAccount===SA&&Array.isArray(task.containers)&&task.containers.length===1,
  'product_release_template_denied');
 const c=task.containers[0],entries=c.env||[];
 operatorRequire(Array.isArray(entries)&&entries.length<=128&&entries.every(x=>typeof x.name==='string')&&
  new Set(entries.map(x=>x.name)).size===entries.length,'product_release_env_invalid');
 const env=Object.fromEntries(entries.map(x=>[x.name,x]));
 const plain=k=>env[k]&&!env[k].valueSource?env[k].value:null;
 const secret=k=>{
  const v=env[k]?.valueSource?.secretKeyRef;
  return v&&['NILE_DATABASE_URL','projects/jscc-dev/secrets/NILE_DATABASE_URL',
   'projects/828902654738/secrets/NILE_DATABASE_URL'].includes(v.secret)&&v.version==='1'&&!Object.hasOwn(env[k],'value');
 };
 const pkg=role==='search'?'jscc':'jscc-service';
 const image=typeof c.image==='string'&&c.image.startsWith(IMAGES+pkg+'@')&&
  match(DIGEST,c.image.slice((IMAGES+pkg+'@').length))?c.image.slice((IMAGES+pkg+'@').length):'UNKNOWN';
 const environment_bound=plain('APP_ENV')==='dev'&&
  (role==='service'?plain('JSCC_RUNTIME_BACKEND')==='gcp'&&plain('SEARCH_MODE')==='disabled'&&
   plain('RUNTIME_DATA_SHA')===plain('SOURCE_SHA'):true);
 return {name:{service:'jscc-command-api-dev',search:'jscc-search-dev',migration:'jscc-db-migrate-dev'}[role],
  source_sha:match(SHA,plain('SOURCE_SHA'))?plain('SOURCE_SHA'):'UNKNOWN',digest:image,revision,
  environment_bound,secret_pin_bound:Boolean(secret('NILE_DATABASE_URL')&&(role!=='migration'||secret('NILE_MIGRATION_DATABASE_URL'))),
  build_id:null,registry_binding:'UNVERIFIED',build_binding:'UNVERIFIED'};
}
async function capture(fetchImpl){
 const path=ROOT+'/services/jscc-command-api-dev',svc=await get(fetchImpl,RUN+path);
 operatorRequire(bound(svc.name,path)&&svc.reconciling!==true&&Array.isArray(svc.trafficStatuses)&&
  svc.trafficStatuses.length>0&&svc.trafficStatuses.length<=20,'product_release_service_unverified');
 const traffic=svc.trafficStatuses,positive=traffic.filter(x=>(x.percent??0)>0);
 operatorRequire(positive.length===1&&positive[0].percent===100&&
  traffic.every(x=>Number.isInteger(x.percent??0)&&(x.percent??0)>=0&&(x.percent??0)<=100),
  'product_release_traffic_ambiguous');
 const rev=positive[0].revision?.split('/').at(-1);
 operatorRequire(match(/^jscc-command-api-dev-[a-z0-9-]{1,44}$/,rev),'product_release_revision_unverified');
 const revPath=path+'/revisions/'+rev,revision=await get(fetchImpl,RUN+revPath);
 operatorRequire(bound(revision.name,revPath)&&revision.reconciling!==true&&
  Array.isArray(revision.conditions)&&revision.conditions.some(x=>x.type==='Ready'&&x.state==='CONDITION_SUCCEEDED'),
  'product_release_revision_mismatch');
 const resources={service:resource(revision,'service',rev)},snap={service:svc,revision};
 for(const role of ['search','migration']){
  const name=role==='search'?'jscc-search-dev':'jscc-db-migrate-dev',path=ROOT+'/jobs/'+name;
  const raw=await get(fetchImpl,RUN+path);
  operatorRequire(bound(raw.name,path)&&raw.reconciling!==true&&raw.template?.taskCount===1&&raw.template?.parallelism===1,
   'product_release_job_unverified');
  resources[role]=resource(raw.template.template,role);
  snap[role]=raw;
 }
 // Only configuration/traffic/generation are fingerprinted, not volatile
 // execution counters, status timestamps, or raw resource contents in evidence.
 const baseline_sha256=operatorHash({service:{template:svc.template,traffic:svc.trafficStatuses,etag:svc.etag??null},
  revision:{name:revision.name,containers:revision.containers,serviceAccount:revision.serviceAccount},
  search:{template:snap.search.template,etag:snap.search.etag??null},
  migration:{template:snap.migration.template,etag:snap.migration.etag??null}});
 return {resources,baseline_sha256};
}
async function registry(fetchImpl,pkg,sha,digest){
 const repo=await get(fetchImpl,'https://artifactregistry.googleapis.com/v1/'+REGISTRY,{optional:true});
 if(!repo)return 'UNVERIFIED';
 operatorRequire(repo.name===REGISTRY&&repo.dockerConfig?.immutableTags===true,'product_release_registry_unverified');
 const parent=REGISTRY+'/packages/'+pkg,name=parent+'/tags/'+sha;
 const tag=await get(fetchImpl,'https://artifactregistry.googleapis.com/v1/'+name,{optional:true});
 if(!tag)return 'UNVERIFIED';
 operatorRequire(tag.name===name&&typeof tag.version==='string'&&tag.version.startsWith(parent+'/versions/')&&
  match(DIGEST,tag.version.slice((parent+'/versions/').length)),'product_release_registry_tag_mismatch');
 return tag.version===parent+'/versions/'+digest?'MATCH':'MISMATCH';
}
async function build(fetchImpl,id,pkg,sha,digest){
 if(id===null)return 'UNVERIFIED';
 const raw=await get(fetchImpl,'https://cloudbuild.googleapis.com/v1/'+BUILD+id,{optional:true});
 if(!raw)return 'UNVERIFIED';
 operatorRequire(raw.id===id&&raw.name===BUILD+id&&raw.serviceAccount===BUILDER,'product_release_build_identity_mismatch');
 if(raw.status!=='SUCCESS'||raw.substitutions?._GIT_SHA!==sha)return 'MISMATCH';
 const tag=IMAGES+pkg+':'+sha;
 const results=raw.results?.images;
 if(!Array.isArray(results)||results.length===0)return 'UNVERIFIED';
 operatorRequire(results.length<=20,'product_release_build_result_limit');
 const matches=results.filter(x=>x?.name===tag);
 return matches.length===1&&matches[0].digest===digest?'PROVIDER_RESULT_MATCH':'MISMATCH';
}
async function nileEvidence(id,actor,sha,revision,readEvidence,now){
 if(id===null||typeof readEvidence!=='function')return {nile_status:'UNVERIFIED',nile_checksum:null};
 const op=await readEvidence('operations/'+id+'.json'),res=await readEvidence('results/'+id+'.json');
 if(!op||!res)return {nile_status:'UNVERIFIED',nile_checksum:null};
 const a=op.data,b=res.data;
 operatorRequire(match(GEN,op.generation)&&match(GEN,res.generation)&&a?.operation_id===id&&b?.operation_id===id&&
  a.actor_sub_hash===actor&&a.work_item_ref==='#589'&&b.work_item_ref==='#589'&&a.task==='observe_dev_nile'&&
  b.task===a.task&&a.operation_state==='SUCCEEDED'&&b.operation_state==='SUCCEEDED'&&b.exit_code===0&&
  operatorExact(a.args,['environment','operation','expected_source_sha'])&&a.args.environment==='dev'&&
  a.args.operation==='schema_inventory'&&a.args.expected_source_sha===sha&&b.target_source_sha===sha&&
  a.ops_source_sha===b.ops_source_sha&&a.worker_image_digest===b.worker_image_digest&&
  a.gateway_image_digest===b.gateway_image_digest&&b.assertions?.nile_status==='COLLECTED'&&
  typeof b.assertions.nile_evidence_json==='string'&&Buffer.byteLength(b.assertions.nile_evidence_json)<=32768,
  'product_release_nile_evidence_mismatch');
 const finished=Date.parse(b.finished_at);
 if(!Number.isFinite(finished)||finished>now||now-finished>600000)
  return {nile_status:'UNVERIFIED',nile_checksum:null};
 const m=JSON.parse(b.assertions.nile_evidence_json);
 if(m.runtime_revision!==revision)return {nile_status:'UNVERIFIED',nile_checksum:null};
 const s=m.schema;
 operatorRequire(m.operation==='schema_inventory'&&s?.database==='jobsearch_dev'&&s.read_only===true&&
  match(HEX,s.migration_checksum)&&['MATCH','DRIFT'].includes(s.migration_state)&&['PRESENT','MISSING'].includes(s.table_state),
  'product_release_nile_schema_invalid');
 return {nile_status:s.migration_state==='MATCH'&&s.table_state==='PRESENT'?'MATCH':'DRIFT',nile_checksum:s.migration_checksum};
}
async function lock(fetchImpl){
 const url='https://storage.googleapis.com/storage/v1/b/jscc-dev-runtime-828902654738/o/locks%2Fheavy-search.lock?fields=bucket,name,generation';
 const r=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(r.status===404)return 'ABSENT';
 if(r.status===403)return 'UNVERIFIED';
 operatorRequire(r.ok,'product_release_lock_http_error');
 const raw=await r.text();
 operatorRequire(Buffer.byteLength(raw)<=4096,'product_release_lock_limit');
 const v=JSON.parse(raw);
 operatorRequire(v.bucket==='jscc-dev-runtime-828902654738'&&v.name==='locks/heavy-search.lock'&&match(GEN,v.generation),
  'product_release_lock_mismatch');
 return 'PRESENT';
}
export async function observeProductRelease(x,{actor,readEvidence,fetchImpl=gcpFetch,now=Date.now}={}){
 operatorRequire(operatorExact(x,['environment','source_sha','service_build_id','search_build_id','nile_operation_id'])&&
  x.environment==='dev'&&match(SHA,x.source_sha)&&[x.service_build_id,x.search_build_id].every(y=>y===null||match(ID,y))&&
  (x.nile_operation_id===null||match(OP,x.nile_operation_id))&&match(HEX,actor),'product_release_observation_denied');
 const first=await capture(fetchImpl),resources=first.resources;
 for(const role of ['service','search','migration']){
  const v=resources[role],id=role==='search'?x.search_build_id:x.service_build_id,pkg=role==='search'?'jscc':'jscc-service';
  v.build_id=id;
  if(v.source_sha!==x.source_sha||v.digest==='UNKNOWN')continue;
  v.registry_binding=await registry(fetchImpl,pkg,x.source_sha,v.digest);
  v.build_binding=await build(fetchImpl,id,pkg,x.source_sha,v.digest);
 }
 const retrieve_lock=await lock(fetchImpl);
 const nile=resources.service.source_sha===x.source_sha?await nileEvidence(x.nile_operation_id,actor,x.source_sha,
  resources.service.revision,readEvidence,now()):{nile_status:'UNVERIFIED',nile_checksum:null};
 const last=await capture(fetchImpl);
 operatorRequire(last.baseline_sha256===first.baseline_sha256,'product_release_baseline_drift');
 // Observation only: absence of lock at read time is not a quiescence guarantee.
 return {state:'OBSERVED',product_release:{source_sha:x.source_sha,baseline_sha256:first.baseline_sha256,
  resources,retrieve_lock,...nile,release_authorized:false,source_provenance:'UNVERIFIED'}};
}
