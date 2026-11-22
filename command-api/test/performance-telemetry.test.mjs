import test from 'node:test';
import assert from 'node:assert/strict';
import {measureNileSql,measureNileHttpRequest,performanceTelemetryEnabled} from '../src/performance-telemetry.js';

test('Nile telemetry is DEV-only and explicitly opt-in',()=>{
  assert.equal(performanceTelemetryEnabled({APP_ENV:'dev',JSCC_PERF_TELEMETRY:'1'}),true);
  for(const env of [{APP_ENV:'dev'},{APP_ENV:'test',JSCC_PERF_TELEMETRY:'1'},
                    {APP_ENV:'prod',JSCC_PERF_TELEMETRY:'1'}])
    assert.equal(performanceTelemetryEnabled(env),false);
});

test('disabled telemetry preserves query result and writes no logs',async()=>{
  const messages=[],previous=console.info;
  console.info=(...args)=>messages.push(args);
  try{
    const tx={query:async(sql,values)=>({rows:[{value:values[0]}]})};
    const result=await measureNileSql('global_listing_sql',tx,'SELECT $1',['ok'],{APP_ENV:'dev'});
    assert.equal(result.rows[0].value,'ok');
    assert.deepEqual(messages,[]);
  }finally{console.info=previous;}
});

test('enabled telemetry emits only allowlisted diagnostic dimensions',async()=>{
  const messages=[],previous=console.info;
  console.info=message=>messages.push(JSON.parse(message));
  try{
    const sensitive='not-for-logs';
    const tx={query:async()=>({rows:[{sensitive}]})};
    const result=await measureNileSql('advance_batch_sql',tx,'SELECT $1',[sensitive],
      {APP_ENV:'dev',JSCC_PERF_TELEMETRY:'1',SOURCE_SHA:'a'.repeat(40)});
    assert.equal(result.rows[0].sensitive,sensitive);
    assert.equal(messages.length,1);
    const event=messages[0];
    assert.deepEqual(Object.keys(event),['event','operation','request_id','duration_ms','outcome','source_sha']);
    assert.equal(event.event,'JSCC_PERF_SQL_V1');
    assert.equal(event.operation,'advance_batch_sql');
    assert.equal(event.outcome,'PASS');
    assert.ok(event.duration_ms>=0);
    assert.equal(JSON.stringify(event).includes(sensitive),false);
  }finally{console.info=previous;}
});

test('Nile HTTP duration correlates SQL timing without raw URLs or user data',async()=>{
  const messages=[],original=console.info;
  console.info=message=>messages.push(JSON.parse(message));
  try{
    const env={APP_ENV:'dev',JSCC_PERF_TELEMETRY:'1'};
    const req={method:'GET',url:'/me/jobs?query=secret&email=private@example.test'};
    const res={statusCode:200};
    await measureNileHttpRequest(req,res,async()=>{
      const db={query:async()=>({rows:[{ok:true}]})};
      await measureNileSql('global_listing_sql',db,'SELECT $1',['secret'],env);
    },env);
    assert.equal(messages.length,2);
    const [sql,api]=messages;
    assert.equal(sql.event,'JSCC_PERF_SQL_V1');
    assert.equal(api.event,'JSCC_PERF_API_V1');
    assert.equal(api.operation,'jobs_page');
    assert.equal(api.status,200);
    assert.match(api.request_id,/^[0-9a-f-]{36}$/);
    assert.equal(sql.request_id,api.request_id);
    for(const line of messages) {
      const text=JSON.stringify(line);
      assert.doesNotMatch(text,/private@example|SELECT |secret/);
    }
  } finally {console.info=original;}
});

test('unknown API routes and TEST/PROD produce no telemetry',async()=>{
  const messages=[],original=console.info;
  console.info=message=>messages.push(message);
  try{
    const env={APP_ENV:'dev',JSCC_PERF_TELEMETRY:'1'};
    await measureNileHttpRequest({method:'GET',url:'/applications/secret-id'},
      {statusCode:200},async()=>{},env);
    await measureNileHttpRequest({method:'GET',url:'/me/jobs'},
      {statusCode:200},async()=>{},
      {APP_ENV:'prod',JSCC_PERF_TELEMETRY:'1'});
    assert.equal(messages.length,0);
  } finally {console.info=original;}
});

test('query error is rethrown without emitting query bindings',async()=>{
  const messages=[],original=console.info;
  console.info=message=>messages.push(JSON.parse(message));
  try{
    const error=Object.assign(new Error('not-for-logs'),{code:'57014'});
    await assert.rejects(measureNileSql('advance_batch_sql',
      {query:async()=>{throw error;}},'SELECT private',['secret'],
      {APP_ENV:'dev',JSCC_PERF_TELEMETRY:'1'}),e=>e===error);
    assert.equal(messages[0]?.outcome,'ERROR');
    assert.doesNotMatch(JSON.stringify(messages),/not-for-logs|SELECT private|secret/);
  } finally {console.info=original;}
});
