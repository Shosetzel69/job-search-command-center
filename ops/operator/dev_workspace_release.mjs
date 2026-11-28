// #589: extend the existing workspace pair release, not product deployment.
// Each stage/tag/cutover/rollback/retirement is independently admitted,
// one etag-bound Cloud Run update; operator's existing durable claim prevents
// replay on uncertain responses. Never mutate the Search Job or Command API.
import {gcpFetch} from '../src/lib.mjs';
import {operatorHash,operatorRequire,operatorLro,OPERATOR_ROOT,WORKSPACE_RELEASE_SERVICES as SERVICES,
 WORKSPACE_RELEASE_PACKAGES as PACKAGES,workspaceRevision,workspaceImage,validateWorkspaceReleaseBundle} from '../src/dev_operator_contract.mjs';
import {executeDevGcpMetadata} from './dev_gcp_metadata.mjs';
const RUN='https://run.googleapis.com/v2/';
const REGISTRY='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const TYPE='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
const roles=['manager','worker'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const servicePath=role=>OPERATOR_ROOT+'/services/'+SERVICES[role];
const sameName=(actual,path)=>actual===path||actual===path.replace('projects/jscc-dev/','projects/828902654738/');
const short=x=>typeof x==='string'?x.split('/').at(-1):'';
const candidateRev=(role,sha)=>SERVICES[role]+'-r2-'+sha.slice(0,12);
const candidateImage=(role,x)=>REGISTRY+PACKAGES[role]+'@'+x.candidate[role];
const tagFor=x=>'r2-'+x.source_sha.slice(0,12);
const equal=(a,b)=>operatorHash(a)===operatorHash(b);
function stablePolicy(value){
 const keys=['description','labels','annotations','launchStage','binaryAuthorization','ingress','customAudiences',
  'scaling','invokerIamDisabled','defaultUriDisabled','multiRegionSettings','iapEnabled','sshEnabled','buildConfig'];
 return Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
}
function normalizedTemplate(template){
 const t=structuredClone(template);
 for(const key of ['client','clientVersion'])delete t[key];
 if(t.labels){
  delete t.labels['client.knative.dev/nonce'];
  if(Object.keys(t.labels).length===0)delete t.labels;
 }
 if(t.revision)t.revision=short(t.revision);
 return t;
}
function trafficRows(role,rows,{observed=false}={}){
 operatorRequire(Array.isArray(rows)&&rows.length>0&&rows.length<=21,'workspace_release_traffic_invalid');
 const mapped=rows.map(x=>{
  const revision=short(x.revision),percent=x.percent??0,tag=x.tag||'';
  operatorRequire(workspaceRevision(role,revision)&&Number.isSafeInteger(percent)&&percent>=0&&percent<=100&&
   (tag===''||/^[a-z0-9][a-z0-9-]{0,62}$/.test(tag))&&
   (observed||x.type===TYPE),'workspace_release_requires_pinned_traffic');
  return {type:TYPE,revision,percent,...(tag?{tag}:{})};
 });
 const positive=mapped.filter(x=>x.percent>0),tags=mapped.filter(x=>x.tag);
 operatorRequire(positive.length===1&&positive[0].percent===100&&!positive[0].tag&&
  new Set(tags.map(x=>x.tag)).size===tags.length&&mapped.every(x=>x.percent===100||x.tag),
  'workspace_release_traffic_split_or_ambiguous');
 return mapped.sort((a,b)=>(a.tag||'').localeCompare(b.tag||''));
}
async function json(fetchImpl,path,{method='GET',body}={}){
 const response=await fetchImpl(RUN+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 operatorRequire(response.ok,'workspace_release_api_error');
 const raw=await response.text();
 operatorRequire(Buffer.byteLength(raw)<=262144,'workspace_release_response_limit');
 return JSON.parse(raw);
}
async function revision(fetchImpl,role,rev,expectedImage,serviceAccount){
 operatorRequire(workspaceRevision(role,rev),'workspace_release_revision_denied');
 const path=servicePath(role)+'/revisions/'+rev;
 const value=await json(fetchImpl,path);
 operatorRequire(sameName(value.name,path)&&value.reconciling!==true&&
  value.serviceAccount===serviceAccount&&value.containers?.length===1&&
  workspaceImage(role,value.containers[0].image)&&(!expectedImage||value.containers[0].image===expectedImage)&&
  Array.isArray(value.conditions)&&value.conditions.some(x=>x.type==='Ready'&&x.state==='CONDITION_SUCCEEDED'),
  'workspace_release_revision_mismatch');
 return value.containers[0].image;
}
async function capture(fetchImpl,role){
 const path=servicePath(role),raw=await json(fetchImpl,path);
 operatorRequire(sameName(raw.name,path)&&raw.reconciling!==true&&
  raw.terminalCondition?.state==='CONDITION_SUCCEEDED'&&raw.generation&&raw.generation===raw.observedGeneration&&
  typeof raw.etag==='string'&&raw.etag.length>0&&raw.etag.length<=1024&&
  raw.template?.containers?.length===1&&workspaceImage(role,raw.template.containers[0].image)&&
  typeof raw.template.serviceAccount==='string'&&/^[a-z][a-z0-9-]+@jscc-dev\.iam\.gserviceaccount\.com$/.test(raw.template.serviceAccount),
  'workspace_release_service_not_reconciled');
 const template=normalizedTemplate(raw.template),policy=stablePolicy(raw);
 const desired=trafficRows(role,raw.traffic),observed=trafficRows(role,raw.trafficStatuses,{observed:true});
 operatorRequire(equal(desired,observed),'workspace_release_traffic_drift');
 const active=observed.find(x=>x.percent===100).revision,latest=short(raw.latestReadyRevision);
 operatorRequire(workspaceRevision(role,latest)&&latest===short(raw.latestCreatedRevision),'workspace_release_latest_unverified');
 const image=await revision(fetchImpl,role,active,null,template.serviceAccount);
 const configuration_sha256=operatorHash({template,policy,traffic:desired,active,image,latest,etag:raw.etag,uri:raw.uri});
 return {raw,template,policy,traffic:desired,summary:{service:SERVICES[role],revision:active,image,latest_ready_revision:latest,
  configuration_sha256,tags:desired.filter(x=>x.tag).map(x=>({tag:x.tag,revision:x.revision}))}};
}
async function capturePair(fetchImpl){
 const pair={};
 for(const role of roles)pair[role]=await capture(fetchImpl,role);
 const services=Object.fromEntries(roles.map(role=>[role,pair[role].summary]));
 return {pair,services,pair_sha256:operatorHash(services)};
}
function report(p,phase=null,role=null){
 return {state:phase===null?'OBSERVED':'SUCCEEDED',workspace_release:{pair_sha256:p.pair_sha256,services:p.services,
  phase,role,functional_acceptance:'PENDING',automatic_retry:false}};
}
export async function observeWorkspaceRelease({fetchImpl=gcpFetch}={}){
 return report(await capturePair(fetchImpl));
}
function canonicalOrigin(uri){
 const u=new URL(uri);
 operatorRequire(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&
  /^[a-z0-9-]+(?:\.a)?\.run\.app$/.test(u.hostname),'workspace_release_origin_denied');
 return u.origin;
}
async function health(role,raw,{tag=null,fetchImpl=fetch}={}){
 const base=canonicalOrigin(raw.uri);
 operatorRequire(new URL(base).hostname.startsWith(SERVICES[role]+'-'),'workspace_release_service_origin_mismatch');
 let target=base;
 if(tag!==null){
  const entries=raw.trafficStatuses.filter(x=>x.tag===tag);
  operatorRequire(entries.length===1&&(entries[0].percent??0)===0,'workspace_release_tag_not_staged');
  target=canonicalOrigin(entries[0].uri);
  operatorRequire(new URL(target).hostname===tag+'---'+new URL(base).hostname,'workspace_release_tag_origin_mismatch');
 }
 const token=await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?'+
  new URLSearchParams({audience:base,format:'full'}),{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(5000)});
 operatorRequire(token.ok,'workspace_release_health_identity_denied');
 const jwt=(await token.text()).trim();
 operatorRequire(jwt.length<=8192&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt),'workspace_release_health_identity_invalid');
 const response=await fetchImpl(target+'/health',{headers:{Authorization:'Bearer '+jwt},redirect:'error',signal:AbortSignal.timeout(15000)});
 operatorRequire(response.ok,'workspace_release_health_denied');
 const body=await response.text();
 operatorRequire(Buffer.byteLength(body)<=4096,'workspace_release_health_limit');
 const data=JSON.parse(body);
 operatorRequire(data.ok===true&&data.component===SERVICES[role]&&
  (role==='manager'?data.backend==='gcs'&&data.git_required===false:data.gcp_permissions==='none'),
  'workspace_release_health_invalid');
}
async function awaitOperation(value,fetchImpl,wait){
 for(let i=0;i<24;i++){
  operatorRequire(value&&!value.error&&operatorLro(value.name),'workspace_release_operation_uncertain');
  if(value.done===true)return;
  await wait(1500);
  value=await json(fetchImpl,value.name);
 }
 throw Error('workspace_release_operation_unconfirmed');
}
function isPrevious(p,role,x){
 return p.services[role].revision===x.previous[role].revision&&p.services[role].image===x.previous[role].image;
}
function isCandidate(p,role,x){
 return p.services[role].revision===candidateRev(role,x.source_sha)&&p.services[role].image===candidateImage(role,x);
}
export async function executeWorkspaceReleaseStep(bundle,{
 fetchImpl=gcpFetch,healthProbe=health,observeBuild,metadata=executeDevGcpMetadata,
 assertFresh,wait=sleep,
}={}){
 const x=validateWorkspaceReleaseBundle(bundle),role=x.role,other=role==='manager'?'worker':'manager';
 operatorRequire(typeof observeBuild==='function'&&typeof assertFresh==='function','workspace_release_admission_missing');
 assertFresh();
 const build=await observeBuild();
 operatorRequire(build.state==='SUCCEEDED'&&build.build_observation?.build_kind==='workspace_r2'&&
  build.build_observation.source_sha===x.source_sha&&build.build_observation.archive_binding==='RESOLVED_MATCH',
  'workspace_release_build_evidence_missing');
 if(x.phase!=='rollback'&&x.phase!=='retire_tag')for(const target of roles){
  const evidence=await metadata({environment:'dev',kind:'artifact_tag',package:PACKAGES[target],source_sha:x.source_sha});
  operatorRequire(evidence.state==='OBSERVED'&&evidence.metadata?.immutable_tags===true&&
   evidence.metadata.package===PACKAGES[target]&&evidence.metadata.source_sha===x.source_sha&&
   evidence.metadata.uri===candidateImage(target,x)&&evidence.metadata.digest===x.candidate[target],
   'workspace_release_registry_mismatch');
 }
 const p=await capturePair(fetchImpl);
 operatorRequire(p.pair_sha256===x.expected_pair_sha256&&roles.every(k=>isPrevious(p,k,x)||isCandidate(p,k,x)),
  'workspace_release_pair_drift');
 const current=p.pair[role],raw=current.raw,target=candidateRev(role,x.source_sha),tag=tagFor(x);
 const existing=current.traffic.find(t=>t.tag===tag);
 const previous=x.previous[role].revision;
 let expectedTraffic=structuredClone(current.traffic),expectedTemplate=structuredClone(current.template);
 let mask='traffic',expectedActive=current.summary.revision;
 if(x.phase==='stage'){
  operatorRequire(isPrevious(p,role,x)&&current.summary.latest_ready_revision===previous&&!existing&&
   (role==='manager'||isPrevious(p,'manager',x)),'workspace_release_stage_denied');
  mask='template';
  expectedTemplate.revision=target;expectedTemplate.containers[0].image=candidateImage(role,x);
 }else if(x.phase==='tag'){
  operatorRequire(isPrevious(p,role,x)&&current.summary.latest_ready_revision===target&&!existing,'workspace_release_tag_denied');
  await revision(fetchImpl,role,target,candidateImage(role,x),current.template.serviceAccount);
  expectedTraffic.push({type:TYPE,revision:target,percent:0,tag});
 }else if(x.phase==='cutover'){
  operatorRequire(isPrevious(p,role,x)&&existing?.revision===target&&existing.percent===0&&
   current.summary.latest_ready_revision===target&&
   (role==='manager'?isCandidate(p,'worker',x):isPrevious(p,'manager',x)),'workspace_release_cutover_order_denied');
  await revision(fetchImpl,role,target,candidateImage(role,x),current.template.serviceAccount);
  await healthProbe(role,raw,{tag});
  expectedTraffic=expectedTraffic.map(t=>t.percent===100?{...t,revision:target}:t);
  expectedActive=target;
 }else if(x.phase==='rollback'){
  operatorRequire(isCandidate(p,role,x)&&(role==='manager'||isPrevious(p,'manager',x)),
   'workspace_release_rollback_order_denied');
  await revision(fetchImpl,role,previous,x.previous[role].image,current.template.serviceAccount);
  expectedTraffic=expectedTraffic.map(t=>t.percent===100?{...t,revision:previous}:t);
  expectedActive=previous;
 }else{
  operatorRequire(existing?.revision===target&&existing.percent===0,'workspace_release_retire_tag_denied');
  expectedTraffic=expectedTraffic.filter(t=>t.tag!==tag);
 }
 expectedTraffic=trafficRows(role,expectedTraffic);
 const body={name:raw.name,etag:raw.etag,...(mask==='template'?{template:expectedTemplate}:{traffic:expectedTraffic})};
 const path=servicePath(role)+'?'+new URLSearchParams({updateMask:mask,allowMissing:'false'});
 assertFresh();
 await awaitOperation(await json(fetchImpl,path+'&validateOnly=true',{method:'PATCH',body}),fetchImpl,wait);
 const check=await capturePair(fetchImpl);
 operatorRequire(check.pair_sha256===p.pair_sha256,'workspace_release_prepatch_drift');
 assertFresh();
 await awaitOperation(await json(fetchImpl,path+'&validateOnly=false',{method:'PATCH',body}),fetchImpl,wait);
 const after=await capturePair(fetchImpl),observed=after.pair[role];
 operatorRequire(after.services[other].configuration_sha256===p.services[other].configuration_sha256&&
  equal(observed.policy,current.policy)&&equal(observed.template,expectedTemplate)&&
  equal(observed.traffic,expectedTraffic)&&observed.summary.revision===expectedActive&&
  (x.phase==='stage'?observed.summary.latest_ready_revision===target:true),'workspace_release_readback_drift');
 if(x.phase==='stage'||x.phase==='tag')await revision(fetchImpl,role,target,candidateImage(role,x),current.template.serviceAccount);
 if(x.phase==='tag')await healthProbe(role,observed.raw,{tag});
 if(['cutover','rollback'].includes(x.phase)){
  operatorRequire(x.phase==='cutover'?isCandidate(after,role,x):isPrevious(after,role,x),'workspace_release_effective_digest_mismatch');
  await healthProbe(role,observed.raw);
 }
 // No automatic rollback/replay across separate approval steps. Unknown receipt
 // or failed health -> existing operator RECOVERY_REQUIRED; observe then admit
 // an explicit compensating traffic step. Never delete revisions.
 return report(after,x.phase,role);
}
