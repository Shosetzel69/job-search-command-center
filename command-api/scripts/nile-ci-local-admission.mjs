// #531 W02-5: ephemeral Nile CI target admission. Never import pg here.
import { execFileSync } from 'node:child_process';

export const TEST_IMAGE='ghcr.io/niledatabase/testingcontainer@sha256:8e670df2a40b0cde96e01cccd62fc34d93bf97c065307d653a5cac940a82b869';
export const CI_USER='00000000-0000-0000-0000-000000000000';
export const CI_PORT=55432;
// Pinned Nile Testing Container: PostgreSQL SQL backend is reached through the
// container's 5432/tcp gateway, but inet_server_port() reports internal PDB 5420.
// Keep gateway/loopback attestation in admitNileCi(); never relax URL matching.
export const NILE_NATIVE_BACKEND_PORT=5420;
export const TARGET_KEYS=Object.freeze([
  'NILE_TEST_DATABASE_URL','NILE_DATABASE_URL','NILE_MIGRATION_DATABASE_URL',
  'JSCC_INTEGRATION_DATABASE_URL','JSCC_TEST_ADMIN_DATABASE_URL',
]);

function deny(message){ throw new Error('W025_NILE_ADMISSION_DENIED: '+message); }

export function verifyTarget(url, name) {
  if(!url || typeof url!=='string') deny(name+' missing');
  let u;
  try { u=new URL(url); } catch { deny(name+' invalid URI'); }
  if(u.protocol!=='postgresql:' && u.protocol!=='postgres:') deny(name+' protocol');
  if(u.hostname!=='127.0.0.1' && u.hostname!=='localhost') deny(name+' nonloopback');
  if(Number(u.port)!==CI_PORT || u.pathname!=='/jobsearch_dev') deny(name+' port/database');
  if(decodeURIComponent(u.username)!==CI_USER || u.password!=='password') deny(name+' synthetic credentials');
  if(u.search || u.hash) deny(name+' URL options');
  return true;
}

export function admitNileCi({
  env=process.env,
  exec=(program,args)=>execFileSync(program,args,{encoding:'utf8',timeout:10000}),
}={}) {
  if(env.CI!=='true' || env.GITHUB_ACTIONS!=='true'
      || env.GITHUB_REPOSITORY!=='Shosetzel69/job-search-command-center'
      || env.RUNNER_OS!=='Linux') deny('GitHub runner identity');
  if(env.APP_ENV!=='dev' || env.NILE_TESTING_DB_NAME!=='jobsearch_dev') deny('app/database identity');
  if(env.JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE!=='true') deny('ephemeral test-only role mode');
  for(const key of TARGET_KEYS) verifyTarget(env[key],key);
  if(!env.W025_NILE_CONTAINER_ID || !/^[a-f0-9]{12,64}$/.test(env.W025_NILE_CONTAINER_ID)) deny('container id');
  let data;
  try { data=JSON.parse(exec('docker',['inspect',env.W025_NILE_CONTAINER_ID])); }
  catch { deny('container inspect failed'); }
  if(!Array.isArray(data)||data.length!==1) deny('container inspect cardinality');
  const c=data[0];
  if(c.Id?.slice(0,env.W025_NILE_CONTAINER_ID.length)!==env.W025_NILE_CONTAINER_ID) deny('container ID mismatch');
  if(!c.State?.Running || c.State?.Status!=='running') deny('container not running');
  if(c.Config?.Image!==TEST_IMAGE) deny('non-pinned image reference');
  // A configured reference is not the image the container is actually running.
  // Attest both the image object Docker resolved and the registry-pinned manifest.
  const expectedDigest=TEST_IMAGE.split('@')[1];
  let local, remote;
  try {
    const imageInfo=JSON.parse(exec('docker',['image','inspect',TEST_IMAGE]));
    if(!Array.isArray(imageInfo)||imageInfo.length!==1) deny('local image cardinality');
    local=imageInfo[0];
    remote=exec('docker',['buildx','imagetools','inspect',TEST_IMAGE]);
  } catch { deny('pinned image attestation unavailable'); }
  if(!/^sha256:[a-f0-9]{64}$/.test(String(local?.Id||''))
      || c.Image!==local.Id
      || !Array.isArray(local.RepoDigests)
      || !local.RepoDigests.includes(TEST_IMAGE)) deny('running image ID or pinned reference mismatch');
  const manifestDigest=/^Digest:\s*(sha256:[a-f0-9]{64})\s*$/m.exec(String(remote||''))?.[1];
  if(manifestDigest!==expectedDigest) deny('registry manifest digest mismatch');
  if(c.Config?.Env?.includes('NILE_TESTING_DB_NAME=jobsearch_dev')!==true) deny('container database override');
  const binds=c.NetworkSettings?.Ports?.['5432/tcp'];
  if(!Array.isArray(binds)||binds.length!==1
      ||binds[0]?.HostIp!=='127.0.0.1'||Number(binds[0]?.HostPort)!==CI_PORT) deny('port bind');
  if(!c.HostConfig?.PortBindings?.['5432/tcp']) deny('missing Docker port binding');
  return Object.freeze({container_id:c.Id,image:TEST_IMAGE,database:'jobsearch_dev',port:CI_PORT});
}


/**
 * S03: prove a live native DB session through an actual SQL round trip.
 * The per-process nonce is assigned by the CI orchestrator. Evidence is emitted
 * only after the database confirms its identity, port and server-side nonce.
 */
export async function attestNativeDatabase(db,{env=process.env}={}){
  const run=String(env.W025_NATIVE_RUN_ID||'');
  const challenge=String(env.W025_NATIVE_CHALLENGE||'');
  if(!['migration','provider','tenant','multiuser','role_family'].includes(run)
      || !/^[a-f0-9]{32}$/.test(challenge))deny('native challenge absent');
  if(!db||typeof db.query!=='function')deny('native SQL client missing');
  let result;
  try{
    result=await db.query(
      'SELECT current_database()::text AS db_name, current_user::text AS principal, pg_backend_pid()::int AS backend_pid, inet_server_port()::int AS server_port, $1::text AS challenge',
      [challenge]);
  }catch(error){deny('native SQL readback failed: '+String(error?.code||'query_error'));}
  if(result?.rows?.length!==1)deny('native readback cardinality');
  const row=result.rows[0];
  if(row.db_name!=='jobsearch_dev' ||
     typeof row.principal!=='string' || !row.principal.trim() ||
     !Number.isInteger(Number(row.backend_pid)) || Number(row.backend_pid)<=0 ||
     Number(row.server_port)!==NILE_NATIVE_BACKEND_PORT || row.challenge!==challenge)
    {
      console.error('W025_NATIVE_IDENTITY_DIAGNOSTIC='+JSON.stringify({
        database:String(row.db_name||''),
        principal_present:typeof row.principal==='string'&&Boolean(row.principal.trim()),
        pid_valid:Number.isInteger(Number(row.backend_pid))&&Number(row.backend_pid)>0,
        reported_port:Number(row.server_port),
        expected_port:NILE_NATIVE_BACKEND_PORT,
        challenge_match:row.challenge===challenge,
      }));
      deny('native SQL identity mismatch');
    }
  const attestation=Object.freeze({
    run,challenge,db_name:row.db_name,principal:row.principal,
    backend_pid:Number(row.backend_pid),server_port:Number(row.server_port)
  });
  console.log('W025_NATIVE_DB_READBACK='+JSON.stringify(attestation));
  return attestation;
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  const result=admitNileCi();
  console.log('W025_ADMISSION=PASS',JSON.stringify(result));
}
