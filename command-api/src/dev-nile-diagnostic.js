import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createHash} from 'node:crypto';
import {readNomenclatures} from './index.js';
import {observeDevNilePlan} from './multiuser-repository.js';
import {BUILD_IDENTITY} from './build-identity.generated.js';

const JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const DIAGNOSTIC_PATH='/admin/dev/nile-diagnostic';
const AUDIENCE='urn:jscc:dev:nile-diagnostic';
const OPERATIONS=new Set(['fit_verify_plan','global_listing_plan','fit_verify_analyze','global_listing_analyze','schema_inventory','runtime_health','migration_013_preflight','tenant_invariants','account_readiness']);
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
export async function handleDevNileDiagnostic(request,env,{authorize=verifyDiagnosticCaller,read=readNomenclatures,observe=observeDevNilePlan,sourceSha=BUILD_IDENTITY.sourceSha}={}){
  if(env.APP_ENV!=='dev'||env.JSCC_DEV_NILE_DIAGNOSTICS!=='true')return reply({error:'not_found'},404);
  if(request.method!=='GET')return reply({error:'method_denied'},405);
  if(!(await authorize(request,env)))return reply({error:'forbidden'},403);
  const url=new URL(request.url);
  const keys=[...url.searchParams.keys()];
  const operation=url.searchParams.get('operation');
  if(keys.length!==2||!keys.includes('operation')||!keys.includes('expected_source_sha')||!OPERATIONS.has(operation))return reply({error:'invalid_operation'},400);
  const expected=url.searchParams.get('expected_source_sha');
  if(!/^[0-9a-f]{40}$/.test(expected||'')||sourceSha!==expected)return reply({error:'source_mismatch'},409);
  if(active||Date.now()-lastStart<10000)return reply({error:'diagnostic_busy'},429);
  active=true;
  lastStart=Date.now();
  try{
    const nomenclatures=['schema_inventory','runtime_health','migration_013_preflight','tenant_invariants','account_readiness'].includes(operation)?null:(await read(env)).payload;
    const result=await observe(operation,nomenclatures,env);
    console.log(JSON.stringify({event:'dev_nile_diagnostic',operation,status:result.status}));
    const runtimeRevision=typeof env.K_REVISION==='string'&&/^jscc-command-api-dev-[a-z0-9-]{1,44}$/.test(env.K_REVISION)?env.K_REVISION:null;
    // The hash binds the actual configured Origin without exposing an
    // arbitrary configuration string. It does not prove any browser request.
    let originState='MISSING',originSha=null;
    if(typeof env.FRONTEND_ORIGIN==='string'&&env.FRONTEND_ORIGIN.length){
      originState='INVALID';
      try{
        const u=new URL(env.FRONTEND_ORIGIN);
        if(u.protocol==='https:'&&u.origin===env.FRONTEND_ORIGIN&&!u.username&&!u.password){
          originState='HTTPS_ORIGIN';
          originSha=createHash('sha256').update(u.origin).digest('hex');
        }
      }catch{}
    }
    const extra=operation==='account_readiness'?{origin_config:{state:originState,sha256:originSha}}:{};
    return reply({...result,...extra,source_sha:sourceSha,runtime_revision:runtimeRevision},result.status==='COLLECTED'?200:503);
  }catch{
    return reply({status:'ERROR',operation,stage:'route',sqlstate:null,source_sha:sourceSha},503);
  }finally{active=false;}
}
