// #589: trusted independent approval-publisher boundary, NOT packaged in MCP or Job.
// The publisher must select the authoritative record through the standard GitHub
// connector and verify owner/reviewer/cost/target evidence before calling this.
// A client-generated hash is not approval. IAM must restrict creation to the
// separate authorized publisher; Gateway and operator must have read-only access.
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {operatorHash,operatorPaths,operatorRequire,validateOperatorApproval,OPERATOR_BUCKET}
 from '../../ops/src/dev_operator_contract.mjs';
const exec=promisify(execFile);
async function token(){
 const {stdout}=await exec('gcloud',['auth','print-access-token','--quiet'],{timeout:30000,maxBuffer:65536});
 return stdout.trim();
}
export async function publishIndependentApproval(record,{
 trustedRecordHash,sourceSha,actor,now=Date.now,getToken=token,fetchImpl=fetch,
}={}){
 operatorRequire(typeof trustedRecordHash==='string'&&/^[a-f0-9]{64}$/.test(trustedRecordHash)&&
  operatorHash(record)===trustedRecordHash,'approval_publisher_pin_mismatch');
 const a=validateOperatorApproval({generation:'1',data:record},{
  ref:record.approval_ref,actor,sourceSha,now:now()
 });
 const value=JSON.stringify(record);
 operatorRequire(Buffer.byteLength(value)<=131072,'approval_record_size_limit');
 const access=await getToken();
 operatorRequire(typeof access==='string'&&access.length>0,'approval_publisher_identity_missing');
 const headers={Authorization:'Bearer '+access,Accept:'application/json'};
 const path=a.paths.approval;
 const q=new URLSearchParams({uploadType:'media',name:path,ifGenerationMatch:'0'});
 const response=await fetchImpl('https://storage.googleapis.com/upload/storage/v1/b/'+OPERATOR_BUCKET+'/o?'+q,{
  method:'POST',headers:{...headers,'Content-Type':'application/json'},body:value,
  redirect:'error',signal:AbortSignal.timeout(20000)
 });
 if(response.status===412)throw Error('approval_already_published');
 operatorRequire(response.ok,'approval_publish_uncertain');
 const metadata=await response.json();
 operatorRequire(metadata.name===path&&metadata.bucket===OPERATOR_BUCKET&&
  /^[1-9][0-9]{0,19}$/.test(metadata.generation||''),'approval_publish_uncertain');
 const readback=await fetchImpl('https://storage.googleapis.com/storage/v1/b/'+OPERATOR_BUCKET+'/o/'+
  encodeURIComponent(path)+'?alt=media&generation='+metadata.generation,{
  headers,redirect:'error',signal:AbortSignal.timeout(20000)
 });
 operatorRequire(readback.ok,'approval_readback_uncertain');
 const saved=await readback.json();
 operatorRequire(operatorHash(saved)===trustedRecordHash,'approval_readback_mismatch');
 return {approval_ref:record.approval_ref,operation_id:operatorPaths(record.approval_ref).key,
  generation:metadata.generation,record_hash:trustedRecordHash};
}
