// #589 R1 — DEV-only OIDC transport to a separately-authorized observer.
// No GCP credential, CLI, secret or privileged API executes in gateway.
import { admitDevRequest } from './dev-runtime-observer.mjs';

const OBSERVER_HOST='jscc-dev-runtime-observer-828902654738.europe-west1.run.app';
export function checkedObserverUrl(raw) {
  if (typeof raw!=='string' || !raw) throw new Error('observer_not_configured');
  let url;
  try { url=new URL(raw); } catch { throw new Error('observer_url_invalid'); }
  if (url.protocol!=='https:' || url.username || url.password || url.port ||
      url.pathname!=='/' || url.search || url.hash ||
      url.hostname!==OBSERVER_HOST)
    throw new Error('observer_url_invalid');
  return url.origin;
}

export async function invokeDevObserver(args, observerUrl, { fetchImpl=fetch, identityToken } = {}) {
  const request=admitDevRequest(args);
  const url=checkedObserverUrl(observerUrl);
  let token=identityToken;
  if (!token) {
    const metadata='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+
      encodeURIComponent(url)+'&format=full';
    const r=await fetchImpl(metadata,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});
    if (!r.ok) throw new Error('observer_identity_unavailable');
    token=(await r.text()).trim();
  }
  if (typeof token!=='string' || token.length<20 || token.length>8192) throw new Error('observer_identity_unavailable');
  const r=await fetchImpl(url+'/v1/observe',{
    method:'POST',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(request),
    signal:AbortSignal.timeout(12000),
  });
  if(r.status===401 || r.status===403) throw new Error('PERMISSION_BLOCKED');
  if(!r.ok) throw new Error('OBSERVATION_UNAVAILABLE');
  const raw=await r.text();
  if(Buffer.byteLength(raw,'utf8')>16384) throw new Error('observer_response_too_large');
  let response;
  try{response=JSON.parse(raw);}catch{throw new Error('observer_invalid_response');}
  if(!response || typeof response!=='object' || Array.isArray(response) ||
     response.environment!=='dev' || response.task!==request.task)
    throw new Error('observer_invalid_response');
  const expected=request.task==='describe_dev_runtime'
    ? 'projects/jscc-dev/locations/europe-west1/services/'+request.service
    : 'projects/jscc-shared/locations/europe-west1/builds/'+request.buildId;
  if(response.resource!==expected || response.source_sha!=='UNKNOWN' ||
     typeof response.observed_at!=='string' ||
     response.observed_at.length>60)
    throw new Error('observer_invalid_response');
  const core={
    environment:'dev',task:request.task,resource:expected,
    source_sha:'UNKNOWN',observed_at:response.observed_at,
  };
  if(request.task==='describe_dev_build'){
    if(response.build_id!==request.buildId ||
       typeof response.build_status!=='string' ||
       !/^[A-Z_]{1,36}$/.test(response.build_status))
      throw new Error('observer_invalid_response');
    return Object.freeze({...core,build_id:request.buildId,build_status:response.build_status});
  }
  const revisions=response.effective_revisions;
  if(!Array.isArray(revisions) || revisions.length===0 || revisions.length>10)
    throw new Error('observer_invalid_response');
  const output=[];
  for(const rev of revisions){
    if(!rev || typeof rev.revision!=='string' ||
       !rev.revision.startsWith(request.service+'-') ||
       !/^[a-z0-9-]{1,100}$/.test(rev.revision) ||
       !Number.isInteger(rev.percent) || rev.percent<0 || rev.percent>100 ||
       !(rev.image_digest==='UNKNOWN' || /^sha256:[0-9a-f]{64}$/.test(rev.image_digest)))
      throw new Error('observer_invalid_response');
    output.push({revision:rev.revision,percent:rev.percent,image_digest:rev.image_digest});
  }
  if(output.reduce((a,r)=>a+r.percent,0)!==100) throw new Error('observer_invalid_response');
  return Object.freeze({
    ...core,effective_revisions:output,
    service_account:typeof response.service_account==='string' &&
      /^[a-z][a-z0-9-]{3,120}@(jscc-dev|jscc-shared)\.iam\.gserviceaccount\.com$/.test(response.service_account)
      ? response.service_account : 'UNKNOWN',
    environment_variable_count:Number.isInteger(response.environment_variable_count) &&
      response.environment_variable_count>=0 && response.environment_variable_count<=500
      ? response.environment_variable_count : null,
  });
}
