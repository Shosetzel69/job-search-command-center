// W02-5 fixed integration outcome ledger. A passing log alone does not override the process exit code.
import { readFileSync } from 'node:fs';
const IDS=Object.freeze('H01 H02 H03 M01 M02 T01 T02 T03 T04 T05 U01 U02 U03 U04 U05 F01 F02 U06 L01 L02 R01 R02 R03 R04 R05 D1 G1 M04 E86'.split(' '));
const EXPECTED=new Set(IDS);
export function validateNileLedger(text,{sourceSha,processOk=true}={}){
  if(!/^[a-f0-9]{40}$/.test(String(sourceSha||''))) throw new Error('W025_GATE_FAIL: missing exact source SHA');
  if(!processOk) throw new Error('W025_GATE_FAIL: test command failed');
  const map=new Map();
  for(const line of text.split(/\r?\n/)){
    if(!line.startsWith('W025_TEST=')) continue;
    const m=/^W025_TEST=([A-Z][0-9]{1,2}|D1|G1|M04|E86) STATUS=(PASS|FAIL|SKIP|NOT_COVERED) MODE=(NATIVE|MOCK|HARNESS) SHA=([a-f0-9]{40})$/.exec(line.trim());
    if(!m) throw new Error('W025_GATE_FAIL: invalid record '+line);
    const [,id,status,mode,sha]=m;
    if(!EXPECTED.has(id)||map.has(id)||status!=='PASS'||sha!==sourceSha)
      throw new Error('W025_GATE_FAIL: invalid, duplicate, or failed '+id);
    const wanted=/^(M0[12]|T0[1-5]|U0[1-6]|F0[12]|L0[12]|R0[1-5])$/.test(id)?'NATIVE'
      :['D1','G1','M04'].includes(id)?'MOCK':'HARNESS';
    if(mode!==wanted)throw new Error('W025_GATE_FAIL: wrong evidence type '+id);
    map.set(id,status);
  }
  const missing=IDS.filter(id=>!map.has(id));
  if(missing.length) throw new Error('W025_GATE_FAIL: missing '+missing.join(','));
  if(!/W025_TAP_COMPLETE=PASS/.test(text)) throw new Error('W025_GATE_FAIL: incomplete TAP');
  if(!/W025_CONTAINER_CLEANUP=PASS/.test(text)) throw new Error('W025_GATE_FAIL: cleanup unproven');
  return {ready:true,mandatory:IDS.length,passed:map.size,source_sha:sourceSha};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const [file,sha]=process.argv.slice(2);
  if(!file||!sha)throw new Error('Usage: nile-ci-test-gate.mjs ledger-file 40charSHA');
  console.log('W025_GATE=PASS',JSON.stringify(validateNileLedger(readFileSync(file,'utf8'),{sourceSha:sha})));
}
