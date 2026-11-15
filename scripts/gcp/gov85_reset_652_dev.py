#!/usr/bin/env python3
"""Owner-authorized DEV corpus reset. No schema/identity/profile/config deletion."""
import os, subprocess, urllib.parse, shutil
from gov85_release_652_dev import APP, P, R, S, LOCK, gc, meta, quiet, lock, owned, release, get, sc, env, need, health

TABLES=("profile_job_evaluation","profile_job_state","profile_job_count_snapshots","refresh_requests","coverage_scope_state","source_run_results","source_postings","canonical_jobs","search_runs")
SQL="""BEGIN;
SELECT 1 / CASE WHEN current_database()='jobsearch_dev' AND COALESCE(current_setting('nile.tenant_id',true),'')='' THEN 1 ELSE 0 END AS dev_guard;
SELECT 1 / CASE WHEN NOT EXISTS (SELECT 1 FROM scheduler_config WHERE enabled) THEN 1 ELSE 0 END AS scheduler_guard;
SELECT 1 / CASE WHEN NOT EXISTS (SELECT 1 FROM search_runs WHERE status IN ('running','queued','pending','started','in_progress')) THEN 1 ELSE 0 END AS run_guard;
""" + "\n".join("DELETE FROM "+t+";" for t in TABLES) + """
UPDATE scheduler_state SET last_triggered_at=NULL,last_run_id=NULL,state='{}'::jsonb,updated_at=now() WHERE singleton=true;
""" + "\n".join("SELECT 1 / CASE WHEN NOT EXISTS (SELECT 1 FROM "+t+") THEN 1 ELSE 0 END AS zero_"+t+";" for t in TABLES) + """
COMMIT;
"""
def main():
    need(shutil.which("psql") is not None,"PSQL_UNAVAILABLE")
    service=get("services",S)
    need(env(sc(service),"SOURCE_SHA")==APP,"DEV_VERSION_DRIFT")
    health(service["uri"],APP)
    need(meta(LOCK) is None,"EXISTING_LOCK")
    quiet()
    raw=gc("secrets","versions","access","1","--secret=NILE_DATABASE_URL","--project="+P)
    u=urllib.parse.urlsplit(raw)
    need(u.scheme in ("postgres","postgresql") and urllib.parse.unquote(u.path)=="/jobsearch_dev" and u.hostname and u.username and u.password,"DB_BINDING_UNVERIFIED")
    q=urllib.parse.parse_qs(u.query,strict_parsing=True)
    need(set(q)<= {"sslmode","channel_binding","connect_timeout"} and all(len(v)==1 for v in q.values()),"UNSUPPORTED_DB_URL_OPTIONS")
    mode=q.get("sslmode",["require"])[0]
    need(mode in ("require","verify-ca","verify-full"),"TLS_REQUIRED")
    child={k:v for k,v in os.environ.items() if not k.startswith("PG")}
    child.update(PGHOST=u.hostname,PGPORT=str(u.port or 5432),PGDATABASE="jobsearch_dev",PGUSER=urllib.parse.unquote(u.username),PGPASSWORD=urllib.parse.unquote(u.password),PGSSLMODE=mode,PGCONNECT_TIMEOUT="15")
    if "channel_binding" in q:child["PGCHANNELBINDING"]=q["channel_binding"][0]
    gen=lock()
    print("RESET_LOCK_ACQUIRED="+gen,flush=True)
    try:
        owned(gen);quiet()
        r=subprocess.run(["psql","-X","-w","-v","ON_ERROR_STOP=1","-At","-f","-"],input=SQL,env=child,text=True,capture_output=True,timeout=600)
        if r.returncode != 0 or not r.stdout.rstrip().endswith("COMMIT"):
            print("RESET_NOT_ATTESTED; LOCK_RETAINED="+gen,flush=True)
            raise RuntimeError("SQL_TRANSACTION_UNVERIFIED")
        owned(gen);quiet()
        release(gen)
        print("DEV_CORPUS_RESET=PASS LOCK_RELEASED=PASS",flush=True)
    except BaseException:
        print("IF_LOCK_PRESENT_DO_NOT_DELETE_WITHOUT_VERIFYING_TRANSACTION; generation="+gen,flush=True)
        raise
if __name__=="__main__":
    try:main()
    except BaseException as e:
        print("RESET_STOPPED="+str(e).splitlines()[0][:120],flush=True)
        raise SystemExit(1)
