// #589: isolated Google-authenticated approval delivery, never an MCP route.
// The independent authority must validate actual owner/review/cost evidence
// through the existing GitHub authority. This service authenticates that
// authority, not the authorship or independence of arbitrary GitHub comments.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {metadataAccessToken} from '../src/lib.mjs';
import {operatorExact,operatorRequire} from '../src/dev_operator_contract.mjs';
import {publishIndependentApproval,stageIndependentDevSource} from '../../scripts/gcp/remote_executor_dev_publish_approval.mjs';
const SERVICE='jscc-ops-publisher-dev';
const SA=SERVICE+'@jscc-dev.iam.gserviceaccount.com';
const AUD='urn:jscc:ops:dev:publisher';
const JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const META='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const SUB=/^[0-9]{6,40}$/;
const EMAIL=/^[a-z][a-z0-9-]{4,62}@jscc-dev\.iam\.gserviceaccount\.com$/;
const EXCLUDED=new Set([SERVICE,'jscc-ops-gateway-dev','jscc-diagnostics-dev','jscc-ops-operator-dev',
 'jscc-dev-runtime','jscc-app-deployer-dev','jscc-ops-deployer-dev','jscc-dev-workspace-manager','jscc-dev-sandbox-worker']);
const MAX_ARCHIVE=16*1024*1024;
const MAX_SOURCE_BODY=23*1024*1024;
const MAX_RECORD_BODY=131072+1024;
const match=(re,v)=>typeof v==='string'&&re.test(v);
const reply=(status,value)=>new Response(JSON.stringify(value),{status,
 headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function publisherRuntimeConfig(env=process.env,{fetchImpl=fetch,readSource=()=>readFile(
 new URL('../publisher-source-sha',import.meta.url),'utf8')}={}){
 if(env.JSCC_DEV_PUBLISHER_ENABLED!=='true')return null;
 const email=env.JSCC_DEV_PUBLISHER_CALLER_EMAIL,sub=env.JSCC_DEV_PUBLISHER_CALLER_SUB;
 operatorRequire(env.K_SERVICE===SERVICE&&env.GCP_PROJECT==='jscc-dev'&&env.GCP_REGION==='europe-west1'&&
  match(SHA,env.SOURCE_SHA)&&match(SHA,env.JSCC_DEV_PUBLISHER_OPERATOR_SOURCE_SHA)&&
  match(HEX,env.JSCC_DEV_PUBLISHER_ACTOR_SUB_HASH)&&match(EMAIL,email)&&
  !EXCLUDED.has(email.split('@')[0])&&match(SUB,sub),'publisher_config_denied');
 operatorRequire((await readSource()).trim()===env.SOURCE_SHA,'publisher_source_mismatch');
 const r=await fetchImpl(META,{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(5000)});
 operatorRequire(r.ok&&(await r.text()).trim()===SA,'publisher_runtime_identity_denied');
 return Object.freeze({email,sub,actor:env.JSCC_DEV_PUBLISHER_ACTOR_SUB_HASH,
  operatorSourceSha:env.JSCC_DEV_PUBLISHER_OPERATOR_SOURCE_SHA});
}
export async function authorizePublisher(request,config,verify=jwtVerify){
 if(!config||request.headers.has('Origin')||request.headers.has('Cookie'))return false;
 const token=request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
 if(!token||token.length>8192)return false;
 try{
  const {payload}=await verify(token,JWKS,{issuer:['https://accounts.google.com','accounts.google.com'],
   audience:AUD,algorithms:['RS256'],requiredClaims:['sub','iat','exp','email','email_verified'],maxTokenAge:'10m'});
  return payload.aud===AUD&&payload.sub===config.sub&&payload.email===config.email&&payload.email_verified===true;
 }catch{return false;}
}
async function jsonBody(request,max){
 operatorRequire(request.headers.get('Content-Type')?.toLowerCase()==='application/json','publisher_content_type_denied');
 const length=request.headers.get('Content-Length');
 operatorRequire(length===null||/^[0-9]{1,10}$/.test(length)&&Number(length)<=max,'publisher_body_limit');
 operatorRequire(request.body,'publisher_body_required');
 const chunks=[];let size=0;
 for await(const chunk of request.body){
  size+=chunk.byteLength;
  operatorRequire(size<=max,'publisher_body_limit');
  chunks.push(Buffer.from(chunk));
 }
 operatorRequire(size>0&&(length===null||size===Number(length)),'publisher_body_mismatch');
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function distinctEvidence(record){
 const refs=[record?.approval_ref,record?.review_ref,record?.cost_ref];
 return refs.every(x=>typeof x==='string'&&/^#589\/[1-9][0-9]{0,19}$/.test(x))&&new Set(refs).size===3;
}
export function createPublisherHandler(config,{authorize=authorizePublisher,publish=publishIndependentApproval,
 stage=stageIndependentDevSource,getToken=()=>metadataAccessToken(),now=Date.now,fetchImpl=fetch}={}){
 let active=false;
 return async request=>{
  if(!config)return reply(404,{error:'not_found'});
  const url=new URL(request.url),source=url.pathname==='/v1/source';
  if(url.search||(!source&&url.pathname!=='/v1/approval'))return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_denied'});
  if(!(await authorize(request,config)))return reply(403,{error:'forbidden'});
  if(active)return reply(429,{error:'publisher_busy'});
  active=true;
  try{
   let input;
   try{
    input=await jsonBody(request,source?MAX_SOURCE_BODY:MAX_RECORD_BODY);
    operatorRequire(operatorExact(input,source?['record','trusted_record_hash','archive_base64']:['record','trusted_record_hash'])&&
     match(HEX,input.trusted_record_hash)&&distinctEvidence(input.record),'publisher_request_denied');
    if(!source)operatorRequire(input.record.actor_sub_hash===config.actor&&
     input.record.operator_source_sha===config.operatorSourceSha,'publisher_actor_source_denied');
   }catch{return reply(400,{error:'invalid_request'});}
   try{
    let result;
    const options={trustedRecordHash:input.trusted_record_hash,getToken,fetchImpl,now};
    if(source){
     operatorRequire(typeof input.archive_base64==='string'&&input.archive_base64.length<=Math.ceil(MAX_ARCHIVE/3)*4,
      'publisher_archive_limit');
     const archive=Buffer.from(input.archive_base64,'base64');
     operatorRequire(archive.length>0&&archive.length<=MAX_ARCHIVE&&archive.toString('base64')===input.archive_base64,
      'publisher_archive_invalid');
     // Caller already materialized exact trusted source. Independent pin binds
     // bytes to that evidence; no private Git credential or GitHub calls here.
     result=await stage(input.record,{...options,materialize:async()=>archive});
    }else result=await publish(input.record,{...options,actor:config.actor,sourceSha:config.operatorSourceSha});
    return reply(200,result);
   }catch{
    // May have reached GCS; never advertise safe retry or echo provider details.
    return reply(503,{error:'publisher_outcome_unverified',automatic_retry:false});
   }
  }finally{active=false;}
 };
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const handler=createPublisherHandler(await publisherRuntimeConfig());
  createServer(async(req,res)=>{
   try{
    const method=req.method||'GET';
    const request=new Request('http://localhost'+req.url,{method,headers:req.headers,
     ...(!['GET','HEAD'].includes(method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const result=await handler(request);
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
   }catch{res.writeHead(400,{'cache-control':'no-store'});res.end();}
  }).listen(Number(process.env.PORT||8080),'0.0.0.0');
 }catch{console.error('publisher_runtime_denied');process.exitCode=1;}
}
