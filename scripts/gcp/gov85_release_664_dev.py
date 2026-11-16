#!/usr/bin/env python3
"""GOV85 #664: coordinated DEV release, including additive migration 013.
Preparation template: binding to a merged exact-CI application SHA is mandatory.
"""
import argparse, copy, json, re, subprocess, tempfile, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
APP="163aae97159a5c71235d414e5cda8b901bbf8ebe"
CTRL="9257b18cf441ccafec85622055de33a44dd5b416"
BASELINE="d5bb1637809ac56e00f6959f7c44cc8f4a23d7e2"
P,R="jscc-dev","europe-west1"
S,J,M="jscc-command-api-dev","jscc-search-dev","jscc-db-migrate-dev"
B="jscc-dev-runtime-828902654738"
REG="europe-west1-docker.pkg.dev/jscc-shared/jscc/"
LOCK="locks/heavy-search.lock"
TAG="gov85-664"
SHA=re.compile(r"^[0-9a-f]{40}$")
DIG=re.compile(r"^sha256:[0-9a-f]{64}$")
FLAGS=["--project="+P,"--region="+R,"--quiet"]
ROOT=f"https://run.googleapis.com/v2/projects/{P}/locations/{R}"
STORAGE=f"https://storage.googleapis.com/storage/v1/b/{B}/o/"
def need(ok, msg):
    if not ok: raise RuntimeError(msg)
def cmd(*args, timeout=900):
    r=subprocess.run(args, capture_output=True,text=True,timeout=timeout)
    need(r.returncode==0,"COMMAND_FAILED:"+ " ".join(args[:4]))
    return r.stdout.strip()
def gc(*args): return cmd("gcloud",*args)
def api(url,method="GET",data=None,missing=False):
    token=gc("auth","print-access-token")
    headers={"Authorization":"Bearer "+token,"Accept":"application/json"}
    if data is not None: headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=data,method=method,headers=headers)
    # Retry only GETs: a transient 503 during verification must not mask
    # known evidence. Do not automatically repeat any provider mutation.
    for attempt in range(5 if method=="GET" else 1):
        try:
            with urllib.request.urlopen(req,timeout=45) as resp:
                body=resp.read()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            if missing and e.code==404:return None
            if method=="GET" and e.code in (429,500,502,503,504) and attempt<4:
                time.sleep(2**attempt);continue
            raise RuntimeError("PROVIDER_HTTP_"+str(e.code)+" method="+method) from None
        except (urllib.error.URLError,TimeoutError):
            if method=="GET" and attempt<4:
                time.sleep(2**attempt);continue
            raise RuntimeError("PROVIDER_TRANSPORT_UNCERTAIN method="+method) from None
def get(kind,name): return api(f"{ROOT}/{kind}/{name}")
def meta(name): return api(STORAGE+urllib.parse.quote(name,safe=""),missing=True)
def env(c,name):
    e=[e for e in c.get("env",[]) if e["name"]==name]
    need(len(e)==1,"ENV_MISSING_OR_DUPLICATE_"+name)
    return e[0].get("value")
def pin(c):
    entries=[e for e in c.get("env",[]) if e["name"]=="NILE_DATABASE_URL"]
    need(len(entries)==1,"NILE_SECRET_MISSING")
    ref=entries[0].get("valueSource",{}).get("secretKeyRef",{})
    need(ref.get("secret")=="NILE_DATABASE_URL" and str(ref.get("version"))=="1","NILE_SECRET_PIN")
def container(d):
    cs=d.get("containers",[])
    need(len(cs)==1,"CONTAINER_LAYOUT")
    return cs[0]
def serving(s):
    active=[t for t in s.get("trafficStatuses",[]) if t.get("percent",0)>0]
    need(len(active)==1 and active[0]["percent"]==100 and active[0].get("revision"),"TRAFFIC_NOT_SINGLE_REVISION")
    return active[0]["revision"].rsplit("/",1)[-1]
def rev(name): return get("services/"+S+"/revisions",name)
def jobc(j): return container(j["template"]["template"])
def sc(s): return container(s["template"])
def image(c,role):
    value=c.get("image","")
    need(value.startswith(REG+role+"@") and DIG.fullmatch(value.rsplit("@",1)[-1]),"IMMUTABLE_IMAGE_"+role)
    return value
def health(uri,sha):
    need(uri.startswith("https://") and uri.endswith(".run.app"),"HEALTH_URI")
    for _ in range(12):
        try:
            with urllib.request.urlopen(uri+"/health",timeout=15) as f: h=json.load(f)
            with urllib.request.urlopen(uri+"/health/db",timeout=15) as f: d=json.load(f)
            if all(h.get(k)==v for k,v in {"status":"ok","environment":"dev","source_sha":sha,"runtime_data_sha":sha,"runtime_backend":"gcp","search_mode":"disabled"}.items()) and all(d.get(k)==v for k,v in {"status":"ok","environment":"dev","database":"jobsearch_dev"}.items()):return
        except (OSError,ValueError):pass
        time.sleep(5)
    raise RuntimeError("HEALTH_OR_DB_HEALTH_FAILED")
def quiet():
    need(meta("active.json") is None,"ACTIVE_MARKER")
    for name in (J,M):
        page=""
        seen=set()
        while True:
            q={"pageSize":100}
            if page:q["pageToken"]=page
            data=api(f"{ROOT}/jobs/{name}/executions?"+urllib.parse.urlencode(q))
            need(all(e.get("completionTime") for e in data.get("executions",[])),"ACTIVE_EXECUTION_"+name)
            page=data.get("nextPageToken","")
            if not page:break
            need(page not in seen,"PAGINATION_LOOP")
            seen.add(page)
def lock():
    payload=json.dumps({"purpose":"GOV85_RELEASE_664","source_sha":APP}).encode()
    url=f"https://storage.googleapis.com/upload/storage/v1/b/{B}/o?"+urllib.parse.urlencode({"uploadType":"media","name":LOCK,"ifGenerationMatch":"0"})
    gen=str(api(url,"POST",payload).get("generation",""))
    need(gen.isdigit(),"LOCK_GENERATION_UNVERIFIED")
    return gen
def owned(gen):
    need(str((meta(LOCK) or {}).get("generation"))==gen,"LOCK_OWNERSHIP_LOST")
def release(gen):
    owned(gen)
    api(STORAGE+urllib.parse.quote(LOCK,safe="")+"?ifGenerationMatch="+gen,"DELETE")
def stage_service(img,sha,tag=None):
    args=["run","services","update",S,"--image="+img,"--update-env-vars=SOURCE_SHA="+sha+",RUNTIME_DATA_SHA="+sha,"--no-traffic",*FLAGS]
    if tag:args.append("--tag="+tag)
    gc(*args)
def traffic(revision):
    gc("run","services","update-traffic",S,"--to-revisions="+revision+"=100",*FLAGS)
def remove_tag():
    if any(t.get("tag")==TAG for t in get("services",S).get("trafficStatuses",[])):
        gc("run","services","update-traffic",S,"--remove-tags="+TAG,*FLAGS)
def update_job(img,sha,override):
    values="SOURCE_SHA="+sha
    if override:values+=",JSCC_JOB_BUILD_SHA="+sha
    gc("run","jobs","update",J,"--image="+img,"--update-env-vars="+values,*FLAGS)
def verify_job(img,sha,override):
    c=jobc(get("jobs",J))
    need(image(c,"jscc")==img and env(c,"SOURCE_SHA")==sha,"JOB_DRIFT")
    pin(c)
    if override:need(env(c,"JSCC_JOB_BUILD_SHA")==sha,"JOB_BUILD_SHA_DRIFT")
# All provider writes use the existing Cloud Shell principal and existing Job.
# Do not alter IAM, secrets, runtime service account, VPC or legacy migration path.
MIG_SCRIPT="command-api/scripts/db-evaluation-migrate-013.mjs"
def pinned(c,name):
    matches=[e for e in c.get("env",[]) if e.get("name")==name]
    need(len(matches)==1,"MIGRATION_BINDING_MISSING_"+name)
    ref=matches[0].get("valueSource",{}).get("secretKeyRef",{})
    need(ref.get("secret")=="NILE_DATABASE_URL" and str(ref.get("version"))=="1","MIGRATION_SECRET_PIN_"+name)
def set_literals(c,values,remove=()):
    c["env"]=[x for x in c.get("env",[]) if x["name"] not in values and x["name"] not in remove]
    c["env"] += [{"name":k,"value":v} for k,v in values.items()]
def wait_op(op,timeout=900):
    name=op.get("name","")
    need(name.startswith(f"projects/{P}/locations/{R}/operations/"),"OPERATION_SCOPE_UNVERIFIED")
    deadline=time.monotonic()+timeout
    while not op.get("done"):
        need(time.monotonic()<deadline,"OPERATION_RESULT_UNCERTAIN")
        time.sleep(3)
        op=api("https://run.googleapis.com/v2/"+name)
    need(not op.get("error"),"PROVIDER_OPERATION_FAILED")
    return op.get("response") or {}
def patch_template(expected,template):
    current=get("jobs",M)
    need(current.get("template")==expected and current.get("etag"),"MIGRATION_TEMPLATE_DRIFT")
    body={"name":current["name"],"etag":current["etag"],"template":template}
    # Cloud Run v2 Jobs PATCH rejects updateMask (confirmed validateOnly HTTP 400).
    # Validate exactly the request before applying; keep optimistic etag and readback.
    api(f"{ROOT}/jobs/{M}?validateOnly=true","PATCH",json.dumps(body).encode())
    result=api(f"{ROOT}/jobs/{M}","PATCH",json.dumps(body).encode())
    wait_op(result)
    need(get("jobs",M).get("template")==template,"MIGRATION_TEMPLATE_READBACK_MISMATCH")
def execution_logs(execution,marker):
    # Exact job/execution filter; never print raw output or database URLs.
    short=execution.rsplit("/",1)[-1]
    need(re.fullmatch(r"jscc-db-migrate-dev-[a-z0-9-]+",short),"MIGRATION_EXECUTION_SCOPE")
    filter_text='resource.type="cloud_run_job" AND resource.labels.job_name="'+M+'" AND labels."run.googleapis.com/execution_name"="'+short+'"'
    for _ in range(15):
        entries=json.loads(gc("logging","read",filter_text,"--project="+P,"--freshness=24h","--limit=100","--format=json"))
        found=[]
        for e in entries:
            structured=e.get("jsonPayload")
            if marker=="LOCK_DIAGNOSTIC" and isinstance(structured,dict) and structured.get("diagnostic")=="EVALUATION013_LOCK_CAPABILITIES":
                found.append({k:structured.get(k) for k in ("diagnostic","privilege","hashtext","advisory","row_nowait","statement_timeout","row_plain","row_contention","row_reacquire","contention_ms")})
                continue
            if isinstance(structured,dict) and marker!="PROBE" and structured.get("migration")=="013_profile_job_evaluation_listing.sql":
                found.append({k:structured.get(k) for k in ("status","environment","mode","source_sha","before","after","applied","migration","checksum")})
                continue
            raw=e.get("textPayload")
            if not isinstance(raw,str) and isinstance(structured,dict):raw=structured.get("message")
            if not isinstance(raw,str):continue
            for line in raw.splitlines():
                if marker=="PROBE":
                    if line=="EVALUATION013_MANAGED_PROBE=PASS":found.append(True)
                elif marker=="LOCK_DIAGNOSTIC":
                    try:x=json.loads(line)
                    except ValueError:continue
                    if isinstance(x,dict) and x.get("diagnostic")=="EVALUATION013_LOCK_CAPABILITIES":
                        found.append({k:x.get(k) for k in ("diagnostic","privilege","hashtext","advisory","row_nowait","statement_timeout","row_plain","row_contention","row_reacquire","contention_ms")})
                else:
                    try:x=json.loads(line)
                    except ValueError:continue
                    if isinstance(x,dict) and x.get("migration")=="013_profile_job_evaluation_listing.sql":
                        found.append({k:x.get(k) for k in ("status","environment","mode","source_sha","before","after","applied","migration","checksum")})
        if len(found)==1:return found[0]
        need(not found,"DUPLICATE_MIGRATION_EVIDENCE")
        time.sleep(4)
    raise RuntimeError("MIGRATION_LOG_EVIDENCE_UNAVAILABLE")
def run_migration(args,env_overrides,marker):
    c=jobc(get("jobs",M))
    override={"args":args,"env":[{"name":k,"value":v} for k,v in env_overrides.items()]}
    if c.get("name"):override["name"]=c["name"]
    op=api(f"{ROOT}/jobs/{M}:run","POST",json.dumps({"overrides":{"containerOverrides":[override]}}).encode())
    response=wait_op(op)
    execution=response.get("name","")
    need(execution.startswith(f"projects/{P}/locations/{R}/jobs/{M}/executions/"),"MIGRATION_EXECUTION_UNVERIFIED")
    result=api("https://run.googleapis.com/v2/"+execution)
    need(result.get("completionTime") and result.get("succeededCount")==result.get("taskCount")==1 and not result.get("failedCount"),"MIGRATION_EXECUTION_NOT_SUCCESSFUL")
    print("MIGRATION_EXECUTION="+execution.rsplit("/",1)[-1]+" TERMINAL=PASS",flush=True)
    return execution_logs(execution,marker)
PROBE=r"""
import {getPool,closePool} from './command-api/src/db/pool.js';
import {runtimePrivilegeReadiness} from './command-api/src/db/privilege-readiness.js';
import {randomUUID} from 'node:crypto';
const db=getPool();let a,b;
try{
  const p=await runtimePrivilegeReadiness();
  if(p.status!=='ok')throw Error('RUNTIME_PRIVILEGE_DENIED');
  a=await db.connect();b=await db.connect();
  await a.query('BEGIN');await b.query('BEGIN');
  const sql='SELECT pg_try_advisory_xact_lock($1::integer,hashtext($2::text)) AS acquired';
  const args=[5910401,'r6-managed-preflight-'+randomUUID()];
  if((await a.query(sql,args)).rows[0]?.acquired!==true)throw Error('LOCK_ACQUIRE_DENIED');
  if((await b.query(sql,args)).rows[0]?.acquired!==false)throw Error('LOCK_EXCLUSION_DENIED');
  await a.query('ROLLBACK');await b.query('ROLLBACK');
  await b.query('BEGIN');
  if((await b.query(sql,args)).rows[0]?.acquired!==true)throw Error('LOCK_RELEASE_DENIED');
  await b.query('ROLLBACK');
  console.log('EVALUATION013_MANAGED_PROBE=PASS');
}catch(e){
  console.error('EVALUATION013_MANAGED_PROBE_FAILED '+(/^[0-9A-Z]{5}$/.test(e?.code||'')?e.code:'UNVERIFIED'));
  process.exitCode=86;
}finally{
  for(const c of [a,b])if(c){await c.query('ROLLBACK').catch(()=>{});c.release();}
  await closePool();
}
"""
LOCK_DIAGNOSTIC=r"""
import {getPool,closePool} from './command-api/src/db/pool.js';
import {runtimePrivilegeReadiness} from './command-api/src/db/privilege-readiness.js';
import {establishTenantContext} from './command-api/src/db/tenant-gateway.js';
import {randomUUID} from 'node:crypto';
const db=getPool();
const result={diagnostic:'EVALUATION013_LOCK_CAPABILITIES'};
const code=e=>/^[0-9A-Z]{5}$/.test(e?.code||'')?e.code:'UNVERIFIED';
const check=async (name,fn)=>{try{result[name]=await fn();}catch(e){result[name]=code(e);}};
let a,b;
const begin=async c=>{await c.query('BEGIN');await c.query("SELECT set_config('statement_timeout','3500',true)");};
const rollback=async c=>{await c.query('ROLLBACK');};
try{
 if(process.env.APP_ENV!=='dev'||process.env.CLOUD_RUN_JOB!=='jscc-db-migrate-dev'||(await db.query('SELECT current_database() AS db')).rows[0]?.db!=='jobsearch_dev')throw Error('SCOPE_DENIED');
 await check('privilege',async()=> (await runtimePrivilegeReadiness()).status==='ok'?'PASS':'DENIED');
 await check('hashtext',async()=> {await db.query("SELECT hashtext('r6-lock-diagnostic')");return 'PASS';});
 a=await db.connect();b=await db.connect();
 await check('statement_timeout',async()=>{
   try{await begin(a);return 'PASS';}finally{await rollback(a);}
 });
 await check('advisory',async()=>{
   const q='SELECT pg_try_advisory_xact_lock($1::integer,hashtext($2::text)) AS acquired',p=[5910401,randomUUID()];
   try{
     await begin(a);await begin(b);
     return (await a.query(q,p)).rows[0]?.acquired===true&&(await b.query(q,p)).rows[0]?.acquired===false?'PASS':'EXCLUSION_DENIED';
   }finally{await rollback(a);await rollback(b);}
 });
 await check('row_nowait',async()=>{
   const owner=(await a.query("SELECT p.profile_id FROM profile p JOIN app_user u ON u.user_id=p.user_id WHERE u.role='ADMIN' AND u.status='ACTIVE' AND p.provisioned_at IS NOT NULL ORDER BY p.profile_id LIMIT 1")).rows[0];
   if(!owner?.profile_id)return 'NO_ACTIVE_ADMIN';
   const tenant=String(owner.profile_id);
   const q="SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND status='ACTIVE' FOR UPDATE NOWAIT";
   try{
     await begin(a);await establishTenantContext(a,tenant);
     if((await a.query(q,[tenant])).rows.length!==1)return 'NO_UNIQUE_ACTIVE_PROFILE';
     let excluded=false;
     await begin(b);await establishTenantContext(b,tenant);
     try{await b.query(q,[tenant]);}catch(e){if(e.code!=='55P03')throw e;excluded=true;}
     await rollback(b);await rollback(a);
     if(!excluded)return 'EXCLUSION_DENIED';
     await begin(b);await establishTenantContext(b,tenant);
     return (await b.query(q,[tenant])).rows.length===1?'PASS':'REACQUIRE_DENIED';
   }finally{await rollback(a);await rollback(b);}
 });
 await check('row_plain',async()=>{
   const owner=(await a.query("SELECT p.profile_id FROM profile p JOIN app_user u ON u.user_id=p.user_id WHERE u.role='ADMIN' AND u.status='ACTIVE' AND p.provisioned_at IS NOT NULL ORDER BY p.profile_id LIMIT 1")).rows[0];
   if(!owner?.profile_id)return 'NO_ACTIVE_ADMIN';
   const tenant=String(owner.profile_id);
   const q="SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND status='ACTIVE' FOR UPDATE";
   const start=async c=>{await c.query('BEGIN');await establishTenantContext(c,tenant);};
   try{
     await start(a);
     if((await a.query(q,[tenant])).rows.length!==1)return 'NO_UNIQUE_ACTIVE_PROFILE';
     // Ensure timeout configuration is independently supported and bounds the waiter.
     await start(b);
     try{await b.query("SET LOCAL statement_timeout = '1500ms'");}
     catch(e){result.row_contention='TIMEOUT_CONFIG_'+code(e);return 'PASS';}
     const t=Date.now();
     // Independent watchdog releases holder even if the server ignores statement timeout.
     // In that case the waiter succeeds and the diagnostic explicitly fails.
     let watchdog;
     const pending=b.query(q,[tenant]).then(()=> 'EXCLUSION_TIMEOUT_DENIED',e=>code(e));
     const expiry=new Promise(resolve=>{watchdog=setTimeout(()=>resolve('WATCHDOG'),4000);});
     let outcome=await Promise.race([pending,expiry]);
     clearTimeout(watchdog);
     result.contention_ms=Date.now()-t;
     if(outcome==='WATCHDOG'){await rollback(a);await pending;result.row_contention='TIMEOUT_UNBOUNDED';await rollback(b);return 'PASS';}
     result.row_contention=(['55P03','57014'].includes(outcome)&&result.contention_ms<3500)?'PASS':outcome;
     await rollback(b);await rollback(a);
     await start(b);
     result.row_reacquire=(await b.query(q,[tenant])).rows.length===1?'PASS':'REACQUIRE_DENIED';
     return 'PASS';
   }finally{await rollback(a);await rollback(b);}
 });
 console.log(JSON.stringify(result));
}finally{for(const c of [a,b])if(c){await c.query('ROLLBACK').catch(()=>{});c.release();}await closePool();}
"""
def attest_migration(result,checksum,mode):
    need(isinstance(result,dict) and result.get("status")=="ok" and result.get("environment")=="dev"
        and result.get("mode")==mode and result.get("source_sha")==APP and result.get("checksum")==checksum
        and result.get("migration")=="013_profile_job_evaluation_listing.sql"
        and result.get("before") in ("PENDING_013","ALREADY_APPLIED"),"MIGRATION_EVIDENCE_MISMATCH")
    if mode=="apply":need(result.get("after")=="ALREADY_APPLIED","MIGRATION_APPLY_UNVERIFIED")
    else:need(result.get("applied") is False and result.get("before")==result.get("after"),"MIGRATION_INSPECT_NOT_READONLY")
def managed_migration(img,checksum,gen,preflight_only=False,diagnostic_locks=False):
    owned(gen);quiet()
    original=get("jobs",M)["template"]
    c=container(original["template"])
    need(env(c,"APP_ENV")=="dev" and env(c,"DB_MIGRATION_MODE")=="refuse","MIGRATION_BASELINE_DENIED")
    pinned(c,"NILE_DATABASE_URL");pinned(c,"NILE_MIGRATION_DATABASE_URL")
    need(image(c,"jscc-service")==REG+"jscc-service@sha256:e00a6d7e7145640830262b4cc3983c00ac67e502aaf1d6c719e85f127a5beea3" and env(c,"SOURCE_SHA")=="25a046fffdeccc8c5f877a8c8cac01110f3c7324","MIGRATION_BASELINE_IDENTITY_DRIFT")
    staged=copy.deepcopy(original)
    new=container(staged["template"])
    new["image"]=img
    new["command"]=["node"];new["args"]=[MIG_SCRIPT]
    set_literals(new,{"SOURCE_SHA":APP,"EVALUATION013_MODE":"inspect"},("EVALUATION013_OWNER_GATE",))
    # Patch only the existing Job's template. All other fields are preserved.
    try:
        patch_template(original,staged)
        owned(gen);quiet()
        before=run_migration([MIG_SCRIPT],{"EVALUATION013_MODE":"inspect"},"INSPECT")
        attest_migration(before,checksum,"inspect")
        print("MANAGED_NILE_013_INSPECT=PASS state="+before["before"]+" checksum="+checksum,flush=True)
        owned(gen);quiet()
        if diagnostic_locks:
            evidence=run_migration(["--input-type=module","-e",LOCK_DIAGNOSTIC],{"DB_POOL_MAX":"2"},"LOCK_DIAGNOSTIC")
            print("LOCK_DIAGNOSTIC="+json.dumps(evidence,sort_keys=True),flush=True)
            return
        need(run_migration(["--input-type=module","-e",PROBE],{"DB_POOL_MAX":"2"},"PROBE") is True,"MANAGED_LOCK_PROBE_DENIED")
        print("MANAGED_NILE_013_LOCK_PROBE=PASS",flush=True)
        if preflight_only:return
        if before.get("before")=="PENDING_013":
            owned(gen);quiet()
            applied=run_migration([MIG_SCRIPT],{"EVALUATION013_MODE":"apply","EVALUATION013_OWNER_GATE":"APPROVE_EVALUATION_DEV_NILE_013_"+APP},"APPLY")
            attest_migration(applied,checksum,"apply")
        owned(gen);quiet()
        after=run_migration([MIG_SCRIPT],{"EVALUATION013_MODE":"inspect"},"INSPECT")
        attest_migration(after,checksum,"inspect")
        need(after.get("after")=="ALREADY_APPLIED","MIGRATION_POSTCHECK_DENIED")
        print("MANAGED_NILE_013=PASS checksum="+checksum,flush=True)
    finally:
        # Only restore when no execution remains active and the observed template
        # is either the staged template or the unchanged original. Unknown state
        # MUST stop with the release sentinel retained by main().
        owned(gen);quiet()
        current=get("jobs",M).get("template")
        if current==staged:patch_template(staged,original)
        else:need(current==original,"MIGRATION_TEMPLATE_STATE_UNVERIFIED")
        print("MIGRATION_TEMPLATE_RESTORED=PASS",flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--resume-generation")
    parser.add_argument("--preflight-only",action="store_true")
    parser.add_argument("--diagnostic-locks",action="store_true")
    opts=parser.parse_args()
    # The failed release's sentinel is retained. No lock deletion/reacquisition.
    need(opts.preflight_only,"EXACT_SQL_REVIEW_AND_MANAGED_PROBE_REQUIRED_BEFORE_APPLY")
    if opts.resume_generation:
        need(re.fullmatch(r"[0-9]+",opts.resume_generation),"RESUME_GENERATION_INVALID")
    need(SHA.fullmatch(APP) and SHA.fullmatch(CTRL),"UNBOUND_RELEASE_TEMPLATE")
    need(gc("artifacts","repositories","describe","jscc","--project=jscc-shared","--location="+R,"--format=value(dockerConfig.immutableTags)").lower()=="true","REGISTRY_NOT_IMMUTABLE")
    builds=json.loads(gc("builds","list","--project=jscc-shared","--region="+R,"--filter=substitutions._GIT_SHA="+APP,"--format=json"))
    matches=[b for b in builds if b.get("status")=="SUCCESS" and b.get("substitutions",{}).get("_GIT_SHA")==APP and b.get("substitutions",{}).get("_CONTROL_SHA")==CTRL and b.get("serviceAccount","").endswith("/jscc-build@jscc-shared.iam.gserviceaccount.com")]
    need(len(matches)==1,"EXACT_BUILD_RECORD_UNVERIFIED")
    need([s.get("id") for s in matches[0].get("steps",[])]==["verify-exact-source-and-registry","test-python-collection-contract","test-frontend-pagination-progress","build-search-job","build-service","push-search-job","push-service","verify-two-digests"],"BUILD_STEPS_UNVERIFIED")
    imgs={}
    for role in ("jscc","jscc-service"):
        digest=gc("artifacts","docker","images","describe",REG+role+":"+APP,"--project=jscc-shared","--format=value(image_summary.digest)")
        need(DIG.fullmatch(digest),"ARTIFACT_DIGEST_"+role)
        imgs[role]=REG+role+"@"+digest
    print("ARTIFACT_PAIR=PASS build="+matches[0]["id"],flush=True)
    s=get("services",S); j=get("jobs",J); oldrev=serving(s); effective=container(rev(oldrev)); oldsc=sc(s); oldjc=jobc(j)
    oldsha=env(oldsc,"SOURCE_SHA")
    need(oldsha==BASELINE and oldsha!=APP and env(effective,"SOURCE_SHA")==oldsha and env(oldsc,"RUNTIME_DATA_SHA")==oldsha and env(effective,"RUNTIME_DATA_SHA")==oldsha and env(oldjc,"SOURCE_SHA")==oldsha,"BASELINE_SHA_DRIFT")
    need(s["latestReadyRevision"].rsplit("/",1)[-1]==oldrev,"SERVICE_TEMPLATE_DRIFT")
    oldservice=image(effective,"jscc-service"); oldjob=image(oldjc,"jscc")
    need(image(oldsc,"jscc-service")==oldservice,"SERVICE_IMAGE_DRIFT")
    for c in (oldsc,effective,oldjc):
        need(env(c,"APP_ENV")=="dev" and env(c,"GCP_RUNTIME_BUCKET")==B,"DEV_BINDING")
        pin(c)
    need(env(oldsc,"GCP_SEARCH_JOB")==J and env(oldsc,"GCP_PROJECT_ID")==P and env(oldsc,"SEARCH_MODE")=="disabled" and env(oldsc,"JSCC_RUNTIME_BACKEND")=="gcp","SERVICE_SCOPE")
    need(not any(t.get("tag")==TAG for t in s.get("trafficStatuses",[])),"RELEASE_TAG_ALREADY_EXISTS")
    override=any(e.get("name")=="JSCC_JOB_BUILD_SHA" for e in oldjc.get("env",[]))
    if override:need(env(oldjc,"JSCC_JOB_BUILD_SHA")==oldsha,"BASELINE_JOB_BUILD_SHA")
    health(s["uri"],oldsha)
    with tempfile.TemporaryDirectory() as tmp:
        repo=str(Path(tmp)/"repo")
        cmd("git","clone","--no-checkout","--filter=blob:none","https://github.com/Shosetzel69/job-search-command-center.git",repo)
        need(cmd("git","-C",repo,"diff","--name-status",oldsha,APP,"--","command-api/migrations")=="A\tcommand-api/migrations/013_profile_job_evaluation_listing.sql","MIGRATION_SCOPE_DENIED")
        checksum=cmd("git","-C",repo,"show",APP+":command-api/migrations/013_profile_job_evaluation_listing.sql")
        need(checksum.startswith("--") or checksum.startswith("ALTER TABLE"),"MIGRATION_SOURCE_UNVERIFIED")
        import hashlib
        raw=subprocess.run(["git","-C",repo,"show",APP+":command-api/migrations/013_profile_job_evaluation_listing.sql"],capture_output=True,check=True,timeout=30).stdout
        checksum=hashlib.sha256(raw).hexdigest()
    if opts.resume_generation:
        owned(opts.resume_generation)
        marker=api(STORAGE+urllib.parse.quote(LOCK,safe="")+"?alt=media&generation="+opts.resume_generation)
        need(marker=={"purpose":"GOV85_RELEASE_664","source_sha":APP},"RESUME_SENTINEL_CONTENT_MISMATCH")
        owned(opts.resume_generation)
    else:
        need(meta(LOCK) is None,"EXISTING_LOCK")
    quiet()
    catalog=str((meta("seed/sources.json") or {}).get("generation",""))
    need(catalog.isdigit(),"CATALOG_GENERATION_UNVERIFIED")
    print("BASELINE=PASS old_sha="+oldsha+" revision="+oldrev+" old_job="+oldjob+" old_service="+oldservice,flush=True)
    gen=opts.resume_generation or lock()
    print(("LOCK_RESUMED" if opts.resume_generation else "LOCK_ACQUIRED")+" generation="+gen,flush=True)
    touched=False
    migration_complete=False
    migration_started=False
    try:
        owned(gen);quiet()
        fresh=get("services",S)
        need(serving(fresh)==oldrev and image(sc(fresh),"jscc-service")==oldservice,"SERVICE_DRIFT_AFTER_LOCK")
        verify_job(oldjob,oldsha,override)
        need(str((meta("seed/sources.json") or {}).get("generation"))==catalog,"CATALOG_DRIFT")
        migration_started=True
        managed_migration(imgs["jscc-service"],checksum,gen,preflight_only=opts.preflight_only,diagnostic_locks=opts.diagnostic_locks)
        if opts.preflight_only:
            owned(gen);quiet()
            health(fresh["uri"],oldsha)
            print(("LOCK_DIAGNOSTIC_COMPLETE" if opts.diagnostic_locks else "MANAGED_PREFLIGHT=PASS")+" LOCK_RETAINED generation="+gen,flush=True)
            return
        migration_complete=True
        health(fresh["uri"],oldsha)
        touched=True
        stage_service(imgs["jscc-service"],APP,TAG)
        staged=get("services",S)
        tags=[t for t in staged.get("trafficStatuses",[]) if t.get("tag")==TAG]
        need(len(tags)==1 and tags[0].get("percent",0)==0 and serving(staged)==oldrev,"STAGING_TRAFFIC_DRIFT")
        newrev=tags[0]["revision"].rsplit("/",1)[-1]
        c=container(rev(newrev));pin(c)
        need(image(c,"jscc-service")==imgs["jscc-service"] and env(c,"SOURCE_SHA")==APP and env(c,"RUNTIME_DATA_SHA")==APP,"STAGED_REVISION_DRIFT")
        health(tags[0]["uri"],APP)
        print("STAGED_HEALTH=PASS",flush=True)
        owned(gen);quiet()
        update_job(imgs["jscc"],APP,override)
        verify_job(imgs["jscc"],APP,override)
        traffic(newrev);remove_tag()
        final=get("services",S)
        need(serving(final)==newrev and image(sc(final),"jscc-service")==imgs["jscc-service"],"FINAL_SERVICE_DRIFT")
        health(final["uri"],APP);verify_job(imgs["jscc"],APP,override)
        quiet();need(str((meta("seed/sources.json") or {}).get("generation"))==catalog,"CATALOG_DRIFT")
        print("PAIRED_ROLLOUT=PASS HEALTH=PASS DB_HEALTH=PASS",flush=True)
    except BaseException:
        if touched:
            print("ROLLOUT_FAILED: attempting paired rollback",flush=True)
            try:
                owned(gen);quiet()
                update_job(oldjob,oldsha,override)
                stage_service(oldservice,oldsha)
                traffic(oldrev);remove_tag()
                verify_job(oldjob,oldsha,override)
                restored=get("services",S)
                need(serving(restored)==oldrev and image(sc(restored),"jscc-service")==oldservice,"ROLLBACK_SERVICE_DRIFT")
                health(restored["uri"],oldsha);quiet()
                release(gen)
                print("ROLLBACK=PASS LOCK_RELEASED=PASS",flush=True)
            except BaseException:
                print("ROLLBACK_UNVERIFIED: LOCK_RETAINED generation="+gen,flush=True)
                raise
        elif migration_started and not migration_complete:
            print("MIGRATION_UNVERIFIED: LOCK_RETAINED generation="+gen,flush=True)
        else:
            owned(gen);quiet();release(gen)
            print("PREFLIGHT_ABORTED LOCK_RELEASED=PASS",flush=True)
        raise
    release(gen)
    print("LOCK_RELEASED=PASS DEV_DEPLOY=PASS SHA="+APP,flush=True)
if __name__=="__main__":
    try:main()
    except BaseException as e:
        print("DEV_RELEASE_STOPPED: "+str(e).splitlines()[0][:200],flush=True)
        raise SystemExit(1)
