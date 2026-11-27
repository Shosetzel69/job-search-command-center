// #589: trusted independent approval-publisher boundary, NOT packaged in MCP or Job.
// The publisher must select the authoritative record through the standard GitHub
// connector and verify owner/reviewer/cost/target evidence before calling this.
// A client-generated hash is not approval. IAM must restrict creation to the
// separate authorized publisher; Gateway and operator must have read-only access.
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {planDevOpsBuild} from '../../ops/build/dev-cloud-build-controller.mjs';
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

// Source staging is performed by the independently authorized publisher,
// never by the Gateway, operator Job, diagnostics or sandbox identities.
const SOURCE_BUCKET='jscc-shared-ops-cloudbuild-source';
const SOURCE_REMOTE='https://github.com/Shosetzel69/job-search-command-center.git';
const REPO=fileURLToPath(new URL('../../',import.meta.url));
const LIMIT=64*1024*1024;
const REF=/^#589\/[1-9][0-9]{0,19}$/;
const HEX=/^[a-f0-9]{64}$/;
const GEN=/^[1-9][0-9]{0,19}$/;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

async function gitArchive(plan){
 // Reuse the exact-source admission from the existing operator build script.
 const git=async(...args)=>(await exec('git',args,{cwd:REPO,timeout:30000,maxBuffer:65536})).stdout.trim();
 operatorRequire(await git('rev-parse','HEAD')===plan.source_sha&&
  await git('status','--porcelain')==='','stage_checkout_mismatch');
 operatorRequire(await git('ls-remote',SOURCE_REMOTE,plan.trusted_ref)===
  plan.source_sha+'\t'+plan.trusted_ref,'stage_trusted_ref_mismatch');
 const {stdout}=await exec('git',['archive','--format=tar.gz',plan.source_sha],{
  cwd:REPO,encoding:'buffer',timeout:60000,maxBuffer:LIMIT
 });
 return stdout;
}

export async function prepareDevSourceArchive(request,{materialize=gitArchive}={}){
 const plan=planDevOpsBuild(request);
 operatorRequire(plan.work_item_ref==='#589','stage_scope_denied');
 const bytes=await materialize(plan);
 operatorRequire(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=LIMIT,'stage_archive_limit');
 return {bytes,sha256:'sha256:'+sha256(bytes),size:bytes.length};
}

/** The trusted pin must be obtained from authenticated owner/review/cost
 * evidence by the independent publisher, not generated from MCP input.
 * No new bucket, Git credential, build dispatch or permission grant. */
export async function stageIndependentDevSource(record,{
 trustedRecordHash,now=Date.now,getToken=token,fetchImpl=fetch,materialize=gitArchive,
}={}){
 operatorRequire(typeof trustedRecordHash==='string'&&HEX.test(trustedRecordHash)&&
  exact(record,['schema_version','request','approval_ref','review_ref','cost_ref','archive_sha256',
   'issued_at_ms','expires_at_ms'])&&operatorHash(record)===trustedRecordHash&&
  record.schema_version==='1.0'&&REF.test(record.approval_ref||'')&&REF.test(record.review_ref||'')&&
  REF.test(record.cost_ref||'')&&new Set([record.approval_ref,record.review_ref,record.cost_ref]).size===3&&
  /^sha256:[a-f0-9]{64}$/.test(record.archive_sha256||'')&&
  Number.isSafeInteger(record.issued_at_ms)&&Number.isSafeInteger(record.expires_at_ms)&&
  record.expires_at_ms>record.issued_at_ms&&record.expires_at_ms-record.issued_at_ms<=3600000,
  'stage_approval_denied');
 // Snapshot before awaiting any external dependency.
 const a=JSON.parse(JSON.stringify(record));
 const fresh=()=>operatorRequire(now()>=a.issued_at_ms&&now()<a.expires_at_ms,'stage_approval_expired');
 fresh();
 const plan=planDevOpsBuild(a.request);
 const archive=await prepareDevSourceArchive(a.request,{materialize});
 operatorRequire(archive.sha256===a.archive_sha256,'stage_archive_digest_mismatch');
 fresh();
 const access=await getToken();
 operatorRequire(typeof access==='string'&&access.length>0,'stage_identity_missing');
 const headers={Authorization:'Bearer '+access,Accept:'application/json'};
 const object='source/dev-'+plan.source_sha+'-'+sha256(a.approval_ref)+'.tar.gz';
 const q=new URLSearchParams({uploadType:'media',name:object,ifGenerationMatch:'0'});
 fresh();
 const response=await fetchImpl('https://storage.googleapis.com/upload/storage/v1/b/'+SOURCE_BUCKET+'/o?'+q,{
  method:'POST',headers:{...headers,'Content-Type':'application/gzip'},body:archive.bytes,
  redirect:'error',signal:AbortSignal.timeout(60000)
 });
 // A collision or uncertain receipt is NOT an authorization to overwrite
 // or repeat the upload. Reconcile the exact generation separately.
 operatorRequire(response.ok,'stage_upload_uncertain');
 const m=await response.json();
 operatorRequire(m.bucket===SOURCE_BUCKET&&m.name===object&&GEN.test(m.generation||'')&&
  m.size===String(archive.size),'stage_upload_receipt_mismatch');
 const url='https://storage.googleapis.com/storage/v1/b/'+SOURCE_BUCKET+'/o/'+
  encodeURIComponent(object)+'?'+new URLSearchParams({alt:'media',generation:m.generation});
 const readback=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(60000)});
 operatorRequire(readback.ok&&readback.body&&
  (!readback.headers.get('x-goog-generation')||readback.headers.get('x-goog-generation')===m.generation),
  'stage_readback_uncertain');
 const digest=createHash('sha256');
 let size=0;
 for await(const chunk of readback.body){
  size+=chunk.byteLength;
  operatorRequire(size<=archive.size,'stage_readback_size_mismatch');
  digest.update(chunk);
 }
 operatorRequire(size===archive.size&&'sha256:'+digest.digest('hex')===a.archive_sha256,
  'stage_readback_mismatch');
 return {bucket:SOURCE_BUCKET,object,generation:m.generation,sha256:a.archive_sha256};
}
