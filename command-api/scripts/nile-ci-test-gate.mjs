// W02-5 mandatory test gate. This program consumes process-bound structured evidence,
// never unauthenticated PASS lines from an arbitrary test log.
import {readFileSync} from 'node:fs';
const IDS=Object.freeze('H01 H02 H03 M01 M02 T01 T02 T03 T04 T05 U01 U02 U03 U04 U05 F01 F02 U06 L01 L02 R01 R02 R03 R04 R05 D1 G1 M04 E86'.split(' '));
const EXPECTED=new Set(IDS);
const NATIVE=new Set('M01 M02 T01 T02 T03 T04 T05 U01 U02 U03 U04 U05 F01 F02 U06 L01 L02 R01 R02 R03 R04 R05'.split(' '));
const MOCK=new Set(['D1','G1','M04']);
function deny(reason){throw Error('W025_GATE_FAIL: '+reason);}
export function validateNileLedger(evidence,{sourceSha}={}){
 if(!/^[a-f0-9]{40}$/.test(String(sourceSha||'')))deny('exact source SHA absent');
 if(typeof evidence==='string'){
  try{evidence=JSON.parse(evidence);}catch{deny('expected structured process evidence, not text markers');}
 }
 if(!evidence || !Array.isArray(evidence.runs) || !Array.isArray(evidence.results))deny('missing process/test records');
 if(evidence.source_sha!==sourceSha || evidence.checkout_sha!==sourceSha)deny('checkout revision mismatch');
 if(evidence.native_container?.verified!==true ||
    !/^[a-f0-9]{64}$/.test(String(evidence.native_container.id||'')) ||
    evidence.native_container.database!=='jobsearch_dev' ||
    evidence.native_container.cleaned_up!==true)deny('native container admission or cleanup missing');
 const runs=new Map();
 for(const run of evidence.runs){
  if(!run || !/^[a-z0-9_-]+$/.test(String(run.id||'')) ||
      runs.has(run.id) || run.exit_code!==0 ||
      run.checkout_sha!==sourceSha ||
      !['NATIVE','MOCK','HARNESS'].includes(run.mode) ||
      typeof run.command!=='string' || !run.command.trim() ||
      (run.tap===null
        ? !(run.mode==='HARNESS' && run.probe_verified===true &&
             ['admission','retired_entrypoint','cleanup'].includes(run.id))
        : (!Number.isSafeInteger(run.tap?.tests) || run.tap.tests<1 ||
           !Number.isSafeInteger(run.tap?.passed) ||
           run.tap.passed!==run.tap.tests || run.tap.failed!==0 ||
           run.tap.skipped!==0 || run.tap.todo!==0 || run.tap.cancelled!==0 ||
           run.tap.complete!==true)))deny('invalid suite exit/TAP provenance');
  if(run.mode==='NATIVE' && (run.native_container_id!==evidence.native_container.id ||
      run.native_db_observed!==true))deny('native run without observed database binding');
  runs.set(run.id,run);
 }
 const results=new Map();
 for(const result of evidence.results){
  if(!result || !EXPECTED.has(result.id) || results.has(result.id) ||
      result.status!=='PASS' || result.sha!==sourceSha)deny('missing, duplicate or failed mandatory ID');
  const required=NATIVE.has(result.id)?'NATIVE':MOCK.has(result.id)?'MOCK':'HARNESS';
  const run=runs.get(result.run_id);
  if(!run || run.mode!==required ||
     !Array.isArray(run.observed_ids) ||
     run.observed_ids.filter(id=>id===result.id).length!==1)deny('ID lacks authentic suite provenance');
  results.set(result.id,result);
 }
 const missing=IDS.filter(id=>!results.has(id));
 if(missing.length)deny('missing '+missing.join(','));
 for(const run of runs.values()){
  if(run.observed_ids.some(id=>!EXPECTED.has(id) || results.get(id)?.run_id!==run.id))deny('unmatched observed ID');
 }
 return {ready:true,mandatory:IDS.length,passed:results.size,source_sha:sourceSha};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 const [file,sha]=process.argv.slice(2);
 if(!file||!sha)deny('usage: gate.mjs structured-evidence.json exact-source-sha');
 console.log('W025_GATE=PASS',JSON.stringify(validateNileLedger(readFileSync(file,'utf8'),{sourceSha:sha})));
}
