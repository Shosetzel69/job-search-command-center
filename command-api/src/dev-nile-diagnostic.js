import {createRemoteJWKSet,jwtVerify} from 'jose';
import {readNomenclatures} from './index.js';
import {observeDevNilePlan} from './multiuser-repository.js';
import {BUILD_IDENTITY} from './build-identity.generated.js';

const JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const DIAGNOSTIC_PATH='/admin/dev/nile-diagnostic';
const AUDIENCE='urn:jscc:dev:nile-diagnostic';
const OPERATIONS=new Set(['fit_verify_plan','global_listing_plan']);
let active=false;
let lastStart=0;
const reply=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function verifyDiagnosticCaller(request,env,verify=jwtVerify){
  if(!/^[0-9]+$/.test(env.JSCC_DEV_NILE_DIAGNOSTIC_CALLER_SUB||'')) return false;
  if(request.headers.has('Origin')||request.headers.has('Cookie')) return false;
  const token=request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if(!token||token.length>8192)return false;
  try {
    const {payload}=await verify(token,JWKS,{issuer:['https://accounts.google.com','accounts.google.com'],audience:AUDIENCE,algorithms:['RS256'],requiredClaims:['sub','iat','exp'],maxTokenAge:'1h'});
    return payload.sub===env.JSCC_DEV_NILE_DIAGNOSTIC_CALLER_SUB && payload.aud===AUDIENCE;
  }catch{return false;}
}
export async function handleDevNileDiagnostic(request,env,{authorize=verifyDiagnosticCaller,read=readNomenclatures,observe=observeDevNilePlan}={}){
  if(env.APP_ENV!=='dev'||env.JSCC_DEV_NILE_DIAGNOSTICS!=='true')return reply({error:'not_found'},404);
  if(request.method!=='GET')return reply({error:'method_denied'},405);
  if(!(await authorize(request,env)))return reply({error:'forbidden'},403);
  const url=new URL(request.url);
  const keys=[...url.searchParams.keys()];
  const operation=url.searchParams.get('operation');
  if(keys.length!==2||!keys.includes('operation')||!keys.includes('expected_source_sha')||!OPERATIONS.has(operation))return reply({error:'invalid_operation'},400);
  const expected=url.searchParams.get('expected_source_sha');
  if(!/^[0-9a-f]{40}$/.test(expected||'')||BUILD_IDENTITY.sourceSha!==expected)return reply({error:'source_mismatch'},409);
  if(active||Date.now()-lastStart<10000)return reply({error:'diagnostic_busy'},429);
  active=true;
  lastStart=Date.now();
  try{
    const result=await observe(operation,(await read(env)).payload,env);
    console.log(JSON.stringify({event:'dev_nile_diagnostic',operation,status:result.status}));
    return reply({...result,source_sha:BUILD_IDENTITY.sourceSha},result.status==='COLLECTED'?200:503);
  }catch{
    return reply({status:'ERROR',operation,stage:'route',sqlstate:null,source_sha:BUILD_IDENTITY.sourceSha},503);
  }finally{active=false;}
}
