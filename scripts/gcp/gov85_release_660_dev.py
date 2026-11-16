#!/usr/bin/env python3
"""GOV85 #660: exact-pair DEV release using existing authenticated Cloud Shell."""
import json, re, subprocess, tempfile, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
APP="1c10c4f49b8999a0e0eff0510e28923500669c94"
CTRL="4f47431e682f378f10b29afd96003ad2d1db08e7"
P,R="jscc-dev","europe-west1"
S,J,M="jscc-command-api-dev","jscc-search-dev","jscc-db-migrate-dev"
B="jscc-dev-runtime-828902654738"
REG="europe-west1-docker.pkg.dev/jscc-shared/jscc/"
LOCK="locks/heavy-search.lock"
TAG="gov85-660"
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
    try:
        with urllib.request.urlopen(req,timeout=45) as resp:
            body=resp.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        if missing and e.code==404:return None
        raise RuntimeError("PROVIDER_HTTP_"+str(e.code)) from None
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
    payload=json.dumps({"purpose":"GOV85_RELEASE_660","source_sha":APP}).encode()
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
def main():
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
    need(SHA.fullmatch(oldsha) and oldsha!=APP and env(effective,"SOURCE_SHA")==oldsha and env(oldsc,"RUNTIME_DATA_SHA")==oldsha and env(effective,"RUNTIME_DATA_SHA")==oldsha and env(oldjc,"SOURCE_SHA")==oldsha,"BASELINE_SHA_DRIFT")
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
        need(cmd("git","-C",repo,"diff","--name-only",oldsha,APP,"--","command-api/migrations")=="","SCHEMA_CHANGE_REQUIRES_SEPARATE_ADMISSION")
    need(meta(LOCK) is None,"EXISTING_LOCK")
    quiet()
    catalog=str((meta("seed/sources.json") or {}).get("generation",""))
    need(catalog.isdigit(),"CATALOG_GENERATION_UNVERIFIED")
    print("BASELINE=PASS old_sha="+oldsha+" revision="+oldrev+" old_job="+oldjob+" old_service="+oldservice,flush=True)
    gen=lock()
    print("LOCK_ACQUIRED generation="+gen,flush=True)
    touched=False
    try:
        owned(gen);quiet()
        fresh=get("services",S)
        need(serving(fresh)==oldrev and image(sc(fresh),"jscc-service")==oldservice,"SERVICE_DRIFT_AFTER_LOCK")
        verify_job(oldjob,oldsha,override)
        need(str((meta("seed/sources.json") or {}).get("generation"))==catalog,"CATALOG_DRIFT")
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
