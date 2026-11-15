#!/usr/bin/env python3
"""Recover exact owner-held reset lock. Separate Nile tenant and shared transactions."""
import json, os, re, shutil, subprocess, urllib.parse
from gov85_release_652_dev import APP, P, S, LOCK, STORAGE, api, gc, meta, quiet, owned, release, get, sc, env, need, health
GEN="1794754308254233"
PERSONAL=("profile_job_evaluation","profile_job_state","profile_job_count_snapshots","refresh_requests")
SHARED=("coverage_scope_state","source_run_results","source_postings","canonical_jobs","search_runs")
ALL=PERSONAL+SHARED
def fail(code): raise RuntimeError(code)
def main():
    need(shutil.which("psql") is not None,"PSQL_UNAVAILABLE")
    owned(GEN)
    url=STORAGE+urllib.parse.quote(LOCK,safe="")+"?alt=media&generation="+GEN+"&ifGenerationMatch="+GEN
    need(api(url)=={"purpose":"GOV85_RELEASE_652","source_sha":APP},"LOCK_PAYLOAD_MISMATCH")
    svc=get("services",S)
    need(env(sc(svc),"SOURCE_SHA")==APP,"DEV_VERSION_DRIFT")
    health(svc["uri"],APP);quiet()
    raw=gc("secrets","versions","access","1","--secret=NILE_DATABASE_URL","--project="+P)
    u=urllib.parse.urlsplit(raw)
    need(u.scheme in ("postgres","postgresql") and urllib.parse.unquote(u.path)=="/jobsearch_dev" and u.hostname and u.username and u.password,"DB_BINDING")
    q=urllib.parse.parse_qs(u.query,strict_parsing=True)
    need(set(q)<={"sslmode","channel_binding","connect_timeout"} and all(len(v)==1 for v in q.values()),"DB_URL_OPTIONS")
    mode=q.get("sslmode",["require"])[0]
    need(mode in ("require","verify-ca","verify-full"),"TLS_REQUIRED")
    child={k:v for k,v in os.environ.items() if not k.startswith("PG")}
    child.update(PGHOST=u.hostname,PGPORT=str(u.port or 5432),PGDATABASE="jobsearch_dev",PGUSER=urllib.parse.unquote(u.username),PGPASSWORD=urllib.parse.unquote(u.password),PGSSLMODE=mode,PGCONNECT_TIMEOUT="15")
    if "channel_binding" in q:child["PGCHANNELBINDING"]=q["channel_binding"][0]
    def sql(query,label):
        r=subprocess.run(["psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-f","-"],input=query,env=child,text=True,capture_output=True,timeout=600)
        if r.returncode:
            m=re.search(r"(?:ERROR|FATAL):\\s+([A-Z0-9]{5}):",r.stderr)
            line=re.search(r"psql:<stdin>:(\\d+):",r.stderr)
            print("SQL_FAILED phase="+label+" sqlstate="+(m.group(1) if m else "UNKNOWN")+" line="+(line.group(1) if line else "UNKNOWN"),flush=True)
            fail("SQL_FAILED_"+label)
        return r.stdout.strip()
    need(sql("SELECT current_database();","database")=="jobsearch_dev","DATABASE_MISMATCH")
    need(sql("SELECT count(*) FROM scheduler_config WHERE enabled;","scheduler")=="0","SCHEDULER_ENABLED")
    need(sql("SELECT count(*) FROM search_runs WHERE status NOT IN ('completed','completed_with_errors','failed','cancelled','canceled','timed_out');","runs")=="0","UNRESOLVED_RUN_STATE")
    counts={t:int(sql("SELECT count(*) FROM "+t+";","count_"+t)) for t in ALL}
    print("BEFORE_COUNTS="+json.dumps(counts,sort_keys=True),flush=True)
    # Use physical Nile tenants, no content or identifiers logged. Each tenant in
    # its own transaction; shared writes never mix with tenant-aware writes.
    ids=sql("SELECT id FROM tenants ORDER BY id;","tenants").splitlines()
    need(all(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",i) for i in ids),"INVALID_TENANT_ID")
    print("TENANTS="+str(len(ids)),flush=True)
    for i in ids:
        owned(GEN);quiet()
        tx="BEGIN;\nSET LOCAL nile.tenant_id = '"+i+"';\n"
        tx+="SELECT 1/CASE WHEN current_setting('nile.tenant_id',true)='"+i+"' THEN 1 ELSE 0 END;\n"
        tx+="\n".join("DELETE FROM "+t+" WHERE tenant_id='"+i+"'::uuid;" for t in PERSONAL)+"\n"
        tx+="\n".join("SELECT 1/CASE WHEN NOT EXISTS(SELECT 1 FROM "+t+" WHERE tenant_id='"+i+"'::uuid) THEN 1 ELSE 0 END;" for t in PERSONAL)+"\nCOMMIT;\n"
        sql(tx,"tenant_cleanup")
    owned(GEN);quiet()
    tx="BEGIN;\n"
    tx+="\n".join("DELETE FROM "+t+";" for t in SHARED)+"\n"
    tx+="UPDATE scheduler_state SET last_triggered_at=NULL,last_run_id=NULL,state='{}'::jsonb,updated_at=now() WHERE singleton=true;\n"
    tx+="\n".join("SELECT 1/CASE WHEN NOT EXISTS(SELECT 1 FROM "+t+") THEN 1 ELSE 0 END;" for t in SHARED)+"\nCOMMIT;\n"
    sql(tx,"shared_cleanup")
    after={t:int(sql("SELECT count(*) FROM "+t+";","verify_"+t)) for t in ALL}
    need(all(v==0 for v in after.values()),"NONZERO_AFTER_RESET")
    print("AFTER_COUNTS="+json.dumps(after,sort_keys=True),flush=True)
    owned(GEN);quiet()
    latest=meta("latest-run.json")
    if latest:
        g=str(latest.get("generation",""))
        need(g.isdigit(),"LATEST_POINTER_UNKNOWN")
        api(STORAGE+urllib.parse.quote("latest-run.json",safe="")+"?ifGenerationMatch="+g,"DELETE")
    owned(GEN);quiet();release(GEN)
    print("DEV_CORPUS_RESET=PASS LOCK_RELEASED=PASS",flush=True)
if __name__=="__main__":
    try:main()
    except BaseException as e:
        print("RESET_STOPPED="+str(e).splitlines()[0][:120]+"; DO_NOT_REMOVE_LOCK_WITHOUT_RECONCILIATION",flush=True)
        raise SystemExit(1)
