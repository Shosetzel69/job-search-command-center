// #589 R1 — DEV-only OIDC transport to a separately-authorized observer.
// No GCP credential, CLI, secret or privileged API executes in gateway.
import { admitDevRequest } from './dev-runtime-observer.mjs';

const PREFIX='jscc-dev-runtime-observer-';
export function checkedObserverUrl(raw) {
  if (typeof raw!=='string' || !raw) throw new Error('observer_not_configured');
  let url;
  try { url=new URL(raw); } catch { throw new Error('observer_url_invalid'); }
  if (url.protocol!=='https:' || url.username || url.password || url.port ||
      url.pathname!=='/' || url.search || url.hash ||
      !url.hostname.startsWith(PREFIX) || !url.hostname.endsWith('.europe-west1.run.app'))
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
  if(!response || response.environment!=='dev' || response.task!==request.task ||
     typeof response.resource!=='string' || response.resource.length>300 ||
     Object.hasOwn(response,'access_token') || Object.hasOwn(response,'secret'))
    throw new Error('observer_invalid_response');
  return response;
}
