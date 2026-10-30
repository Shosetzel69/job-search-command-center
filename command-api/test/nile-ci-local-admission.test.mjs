import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNileCi,attestNativeDatabase,verifyTarget,CI_USER,TEST_IMAGE,TARGET_KEYS,NILE_NATIVE_BACKEND_PORT} from '../scripts/nile-ci-local-admission.mjs';
import {validateNileLedger} from '../scripts/nile-ci-test-gate.mjs';
const url='postgresql://'+CI_USER+':password@127.0.0.1:55432/jobsearch_dev';
const valid=()=>Object.fromEntries([
 ['CI','true'],['GITHUB_ACTIONS','true'],['GITHUB_REPOSITORY','Shosetzel69/job-search-command-center'],
 ['RUNNER_OS','Linux'],['APP_ENV','dev'],['NILE_TESTING_DB_NAME','jobsearch_dev'],
 ['JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE','true'],['W025_NILE_CONTAINER_ID','a'.repeat(64)],
 ...TARGET_KEYS.map(k=>[k,url]),
]);
const record=()=>[{Id:'a'.repeat(64),Image:'sha256:'+'1'.repeat(64),State:{Running:true,Status:'running'},
 Config:{Image:TEST_IMAGE,Env:['NILE_TESTING_DB_NAME=jobsearch_dev']},
 HostConfig:{PortBindings:{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}},
 NetworkSettings:{Ports:{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}}}];
const mockExec=(container=record()[0])=>(program,args)=>{
 if(args[0]==='inspect')return JSON.stringify([container]);
 if(args[0]==='image')return JSON.stringify([{Id:'sha256:'+'1'.repeat(64),RepoDigests:[TEST_IMAGE]}]);
 if(args[0]==='buildx')return 'Digest: '+TEST_IMAGE.split('@')[1];
 throw Error('unexpected docker command');
};
test('W025-H02 rejects locally substituted images and incorrect manifest digest',()=>{
 const swapped={...record()[0],Image:'sha256:'+'2'.repeat(64)};
 assert.throws(()=>admitNileCi({env:valid(),exec:mockExec(swapped)}),/ADMISSION_DENIED/);
 assert.throws(()=>admitNileCi({env:valid(),exec:(program,args)=>{
  if(args[0]==='buildx')return 'Digest: sha256:'+'f'.repeat(64);
  return mockExec()(program,args);
 }}),/ADMISSION_DENIED/);
});
test('W025-H01 admits exact ephemeral Nile identity without connecting',()=>{
 let calls=0;const r=admitNileCi({env:valid(),exec:(program,args)=>{calls++;return mockExec()(program,args);}});
 assert.equal(r.port,55432);assert.equal(calls,3);
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

test('W025-S03 rejects forged or absent native SQL provenance and broken TAP outcomes',()=>{
 const sha='a'.repeat(40),imageId='b'.repeat(64),challenge='c'.repeat(32);
 const ids='H01 H02 H03 M01 M02 T01 T02 T03 T04 T05 U01 U02 U03 U04 U05 F01 F02 U06 L01 L02 R01 R02 R03 R04 R05 D1 G1 M04 E86'.split(' ');
 const native=new Set('M01 M02 T01 T02 T03 T04 T05 U01 U02 U03 U04 U05 F01 F02 U06 L01 L02 R01 R02 R03 R04 R05'.split(' '));
 const mock=new Set(['D1','G1','M04']);
 const tap={tests:1,passed:1,failed:0,skipped:0,todo:0,cancelled:0,complete:true};
 const evidence={
  source_sha:sha,checkout_sha:sha,
  native_container:{verified:true,id:imageId,database:'jobsearch_dev',cleaned_up:true},
  runs:ids.map(id=>{
   const run_id=id.toLowerCase(),isNative=native.has(id),mode=isNative?'NATIVE':mock.has(id)?'MOCK':'HARNESS';
   return {id:run_id,mode,command:'node --test native-evidence',exit_code:0,checkout_sha:sha,tap:{...tap},
    observed_ids:[id],...(isNative?{
      native_container_id:imageId,native_db_observed:true,native_challenge:challenge,
      native_db_readback:{run:run_id,challenge,db_name:'jobsearch_dev',principal:'synthetic',
       backend_pid:123,server_port:NILE_NATIVE_BACKEND_PORT}
    }:{})};
  }),
  results:ids.map(id=>({id,status:'PASS',sha,run_id:id.toLowerCase()}))
 };
 assert.equal(validateNileLedger(evidence,{sourceSha:sha}).passed,29);
 const find=id=>evidence.runs.find(r=>r.id===id.toLowerCase());
 for(const broken of [
  ()=>(find('R03').native_db_readback=null),
  ()=>(find('R03').native_challenge='d'.repeat(32)),
  ()=>(find('T02').native_db_observed=false),
  ()=>(find('R04').native_db_readback.server_port=5444),
  ()=>(find('R04').tap.skipped=1),
  ()=>(find('R05').exit_code=1),
  ()=>(evidence.native_container.cleaned_up=false),
  ()=>(evidence.results.push({...evidence.results[0]})),
 ]){
  const snapshot=structuredClone(evidence);
  broken();
  assert.throws(()=>validateNileLedger(evidence,{sourceSha:sha}),/W025_GATE_FAIL/);
  Object.assign(evidence,snapshot);
 }
});
test('W025-S03 live readback requires valid challenge and real SQL identity',async()=>{
 const env={W025_NATIVE_RUN_ID:'tenant',W025_NATIVE_CHALLENGE:'a'.repeat(32)};
 let calls=0;
 await assert.rejects(
  attestNativeDatabase({query:async()=>{calls++;throw Error('should not query');}},
    {env:{...env,W025_NATIVE_CHALLENGE:'invalid'}}),/ADMISSION_DENIED/);
 assert.equal(calls,0);
 const db={query:async(_sql,args)=>{
  calls++;
  assert.deepEqual(args,[env.W025_NATIVE_CHALLENGE]);
  return {rows:[{db_name:'wrong_database',principal:'user',backend_pid:123,server_port:5432,
     challenge:args[0]}]};
 }};
 await assert.rejects(attestNativeDatabase(db,{env}),/ADMISSION_DENIED/);
 assert.equal(calls,1);
});

test('W025-NILE-PORT pinned 5420 and 5421 internal backends accepted; 5432 gateway and other ports denied',async()=>{
 const env={W025_NATIVE_RUN_ID:'migration',W025_NATIVE_CHALLENGE:'c'.repeat(32)};
 const row={db_name:'jobsearch_dev',principal:'Nile runtime SQL principal',backend_pid:456,
  server_port:NILE_NATIVE_BACKEND_PORT,challenge:env.W025_NATIVE_CHALLENGE};
 assert.equal(NILE_NATIVE_BACKEND_PORT,5420,'pinned provider-native SQL backend contract changed');
 let queries=0;
 const db={query:async(sql,args)=>{
  queries++;
  assert.match(sql,/inet_server_port\(\)/);
  assert.deepEqual(args,[env.W025_NATIVE_CHALLENGE]);
  return {rows:[row]};
 }};
 const attested=await attestNativeDatabase(db,{env});
 assert.equal(attested.server_port,5420);
 assert.equal(attested.run,'migration');
 const alternate=await attestNativeDatabase({query:async()=>({rows:[{...row,server_port:5421}]})},{env});
 assert.equal(alternate.server_port,5421);
 assert.equal(queries,1);
 for(const port of [5432,5444,55432,null]){
  await assert.rejects(attestNativeDatabase({query:async()=>({rows:[{...row,server_port:port}]})},{env}),/ADMISSION_DENIED/,
   'unexpected backend port '+port+' must not be accepted');
 }
 await assert.rejects(attestNativeDatabase({query:async()=>({rows:[{...row,challenge:'forged'}]})},{env}),/ADMISSION_DENIED/);
});
