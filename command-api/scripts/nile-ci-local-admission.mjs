// #531 W02-5: ephemeral Nile CI target admission. Never import pg here.
import { execFileSync } from 'node:child_process';

export const TEST_IMAGE='ghcr.io/niledatabase/testingcontainer@sha256:8e670df2a40b0cde96e01cccd62fc34d93bf97c065307d653a5cac940a82b869';
export const CI_USER='00000000-0000-0000-0000-000000000000';
export const CI_PORT=55432;
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
  if(c.Config?.Image!==TEST_IMAGE) deny('non-pinned image');
  if(c.Config?.Env?.includes('NILE_TESTING_DB_NAME=jobsearch_dev')!==true) deny('container database override');
  const binds=c.NetworkSettings?.Ports?.['5432/tcp'];
  if(!Array.isArray(binds)||binds.length!==1
      ||binds[0]?.HostIp!=='127.0.0.1'||Number(binds[0]?.HostPort)!==CI_PORT) deny('port bind');
  if(!c.HostConfig?.PortBindings?.['5432/tcp']) deny('missing Docker port binding');
  return Object.freeze({container_id:c.Id,image:TEST_IMAGE,database:'jobsearch_dev',port:CI_PORT});
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  const result=admitNileCi();
  console.log('W025_ADMISSION=PASS',JSON.stringify(result));
}
