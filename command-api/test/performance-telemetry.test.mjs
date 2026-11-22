import test from 'node:test';
import assert from 'node:assert/strict';
import {measureNileSql,performanceTelemetryEnabled} from '../src/performance-telemetry.js';

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
    assert.deepEqual(Object.keys(event),['event','operation','duration_ms','outcome','source_sha']);
    assert.equal(event.event,'JSCC_PERF_SQL_V1');
    assert.equal(event.operation,'advance_batch_sql');
    assert.equal(event.outcome,'PASS');
    assert.ok(event.duration_ms>=0);
    assert.equal(JSON.stringify(event).includes(sensitive),false);
  }finally{console.info=previous;}
});
