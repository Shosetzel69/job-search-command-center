// #589 R1 — privileged API access remains restricted to this dedicated
// Cloud Run identity. Runtime must be private and require roles/run.invoker.
// Do not place this server in the gateway or the sandbox worker image.
import http from 'node:http';
import { createDevObserver } from './dev-runtime-observer.mjs';
import { gcpFetch } from '../src/lib.mjs';

const PROJECT=process.env.GCP_PROJECT;
const SERVICE=process.env.K_SERVICE;
if(PROJECT!=='jscc-dev' || SERVICE!=='jscc-dev-runtime-observer')
 throw new Error('observer_environment_denied');
const PORT=Number(process.env.PORT||8080);
const APIs=new Set(['run.googleapis.com','cloudbuild.googleapis.com']);

async function apiTransport({api,path}) {
 if(!APIs.has(api) || typeof path!=='string' || path.length>350 || !path.startsWith('/v'))
   throw new Error('transport_request_denied');
 const response=await gcpFetch('https://'+api+path,{signal:AbortSignal.timeout(9000)});
 if(!response.ok) return {status:response.status,body:null};
 const len=Number(response.headers.get('content-length')||0);
 if(len>128*1024) throw new Error('upstream_response_too_large');
 const raw=await response.text();
 if(Buffer.byteLength(raw)>128*1024) throw new Error('upstream_response_too_large');
 let body;
 try{body=JSON.parse(raw);}catch{throw new Error('upstream_invalid_json');}
 return {status:response.status,body};
}
const observer=createDevObserver({transport:apiTransport});
function send(res,status,data) {
 res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
 res.end(JSON.stringify(data));
}
const server=http.createServer(async(req,res)=>{
 if(req.method==='GET' && req.url==='/health')
   return send(res,200,{ok:true,service:'jscc-dev-runtime-observer',environment:'dev'});
 if(req.method!=='POST'||req.url!=='/v1/observe')
   return send(res,404,{error:'not_found'});
 try{
   const contentType=String(req.headers['content-type']||'');
   if(!contentType.startsWith('application/json'))return send(res,415,{error:'invalid_content_type'});
   let raw='',size=0;
   for await(const chunk of req){
     size+=chunk.length;
     if(size>4096)return send(res,413,{error:'request_too_large'});
     raw+=chunk.toString('utf8');
   }
   const request=JSON.parse(raw);
   const result=await observer.describe(request);
   return send(res,200,result);
 }catch(e){
   const error=String(e?.message||'unknown');
   const clientDenied=['environment_denied','task_denied','resource_denied','invalid_request'].includes(error);
   const status=clientDenied?403:error==='PERMISSION_BLOCKED'?403:503;
   const safe=clientDenied?'request_denied':error==='PERMISSION_BLOCKED'?'PERMISSION_BLOCKED':'OBSERVATION_UNAVAILABLE';
   return send(res,status,{error:safe});
 }
});
server.listen(PORT,()=>console.log(JSON.stringify({event:'observer_started',environment:'dev'})));
