import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNileCi,verifyTarget,CI_USER,TEST_IMAGE,TARGET_KEYS} from '../scripts/nile-ci-local-admission.mjs';
const url='postgresql://'+CI_USER+':password@127.0.0.1:55432/jobsearch_dev';
const valid=()=>Object.fromEntries([
 ['CI','true'],['GITHUB_ACTIONS','true'],['GITHUB_REPOSITORY','Shosetzel69/job-search-command-center'],
 ['RUNNER_OS','Linux'],['APP_ENV','dev'],['NILE_TESTING_DB_NAME','jobsearch_dev'],
 ['JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE','true'],['W025_NILE_CONTAINER_ID','a'.repeat(64)],
 ...TARGET_KEYS.map(k=>[k,url]),
]);
const record=()=>[{Id:'a'.repeat(64),State:{Running:true,Status:'running'},
 Config:{Image:TEST_IMAGE,Env:['NILE_TESTING_DB_NAME=jobsearch_dev']},
 HostConfig:{PortBindings:{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}},
 NetworkSettings:{Ports:{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}}}];
test('W025-H01 admits exact ephemeral Nile identity without connecting',()=>{
 let calls=0;const r=admitNileCi({env:valid(),exec:()=>{calls++;return JSON.stringify(record());}});
 assert.equal(r.port,55432);assert.equal(calls,1);
});
test('W025-H02 rejects each external database URL before any container inspect or connection',()=>{
 const bad=[
  url.replace('127.0.0.1','nile.example.com'),url.replace('55432','5432'),
  url.replace('jobsearch_dev','jobsearch_test'),url.replace(CI_USER,'postgres'),
  url+'?sslmode=disable','postgresql://'+CI_USER+':password@127.0.0.1:55432/test',
 ];
 for(const key of TARGET_KEYS) for(const value of bad){
  let calls=0;const env={...valid(),[key]:value};
  assert.throws(()=>admitNileCi({env,exec:()=>{calls++;return JSON.stringify(record());}}),/ADMISSION_DENIED/);
  assert.equal(calls,0,key);
 }
});
test('W025-H02 rejects altered runner, env, container, image, missing target',()=>{
 const variations=[['CI','false'],['GITHUB_ACTIONS','false'],['GITHUB_REPOSITORY','another/repo'],
  ['RUNNER_OS','Windows'],['APP_ENV','prod'],['NILE_TESTING_DB_NAME','test'],
  ['JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE','false'],['W025_NILE_CONTAINER_ID','oops'],
  ['NILE_TEST_DATABASE_URL','IGNORED']];
 for(const [key,value] of variations.slice(0,-1)){
  assert.throws(()=>admitNileCi({env:{...valid(),[key]:value},exec:()=>JSON.stringify(record())}),/ADMISSION_DENIED/);
 }
 for(const c of [
   {...record()[0],Config:{...record()[0].Config,Image:'ghcr.io/niledatabase/testingcontainer:latest'}},
   {...record()[0],NetworkSettings:{Ports:{'5432/tcp':[{'HostIp':'0.0.0.0',HostPort:'55432'}]}}},
   {...record()[0],State:{Running:false,Status:'exited'}},
 ]) assert.throws(()=>admitNileCi({env:valid(),exec:()=>JSON.stringify([c])}),/ADMISSION_DENIED/);
 for(const key of TARGET_KEYS) assert.throws(()=>admitNileCi({env:{...valid(),[key]:undefined},exec:()=>JSON.stringify(record())}),/ADMISSION_DENIED/);
});
