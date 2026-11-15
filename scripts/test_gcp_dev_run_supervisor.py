import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from scripts import gcp_dev_run_supervisor as supervisor

class Store:
    def __init__(self, descriptor):
        self.descriptor=descriptor
        self.deleted=[]
    def read(self, name):
        return ("11" if name==supervisor.LOCK else "12", self.descriptor)
    def delete(self,name,generation):
        self.deleted.append((name,generation))

class SupervisorTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        (self.root/"seed").mkdir()
        for name in ("search-config.json","run-history.json","search-state.json"):
            (self.root/"seed"/name).write_text("{}")
        (self.root/"seed"/"run-status.json").write_text('{"run_id":"old","status":"completed","jobs_published":110}')
        self.id="run-00000000-0000-4000-8000-000000000001"
        self.env={"APP_ENV":"dev","CLOUD_RUN_JOB":"jscc-search-dev",
                  "GCP_RUNTIME_BUCKET":"jscc-dev-runtime-828902654738",
                  "SOURCE_SHA":"a"*40,"JSCC_JOB_BUILD_SHA":"a"*40,
                  "JSCC_RUN_ID":self.id,"CLOUD_RUN_TASK_ATTEMPT":"0",
                  "JSCC_REQUEST_SIGNATURE":"b"*64,"JSCC_RETRIEVE_SCOPE_JSON":"{}"}
        self.descriptor={"run_id":self.id,"source_sha":"a"*40,"request_signature":"b"*64,"retrieve_scope":None}
        self.store=Store(self.descriptor)
        self.path=self.root/"runs"/self.id/"run-status.json"
        self.published=[]
    def publish(self,*,env):
        self.published.append(json.loads(self.path.read_text()))
    def execute(self,args,env):
        s=json.loads(self.path.read_text())
        self.assertEqual(s["run_id"],self.id)
        self.assertEqual(s["jobs_published"],0)
        self.assertIn("faulthandler",args)
        return SimpleNamespace(returncode=-11 if "job_search_runner.py" in args[-1] else 0)
    def call(self,**kwargs):
        return supervisor.run(self.env,root=self.root,storage=self.store,
                              execute=kwargs.get("execute",self.execute),publish=kwargs.get("publish",self.publish))
    def test_native_crash_finalizes_new_run_and_releases_owned_generations(self):
        self.assertEqual(self.call(),1)
        self.assertEqual(self.published[0]["status"],"failed")
        self.assertEqual(self.published[0]["run_id"],self.id)
        self.assertEqual(self.published[0]["jobs_published"],0)
        self.assertEqual(self.store.deleted,[(supervisor.ACTIVE,"12"),(supervisor.LOCK,"11")])
    def test_retry_never_touches_storage_or_runs_collector(self):
        self.env["CLOUD_RUN_TASK_ATTEMPT"]="1"
        self.store.read=Mock(side_effect=AssertionError("unexpected storage read"))
        self.assertEqual(self.call(execute=Mock(side_effect=AssertionError("unexpected execute"))),1)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.store.deleted,[])
    def test_finalize_failure_keeps_lock(self):
        with self.assertRaises(RuntimeError):
            self.call(publish=Mock(side_effect=RuntimeError("publish failed")))
        self.assertEqual(self.store.deleted,[])
    def test_snapshot_error_is_terminal_without_collector(self):
        execute=Mock(return_value=SimpleNamespace(returncode=1))
        self.assertEqual(self.call(execute=execute),1)
        self.assertEqual(execute.call_count,1)
        self.assertEqual(self.published[0]["status"],"failed")
    def test_wrong_owner_fails_before_mutation(self):
        self.store.descriptor={**self.descriptor,"run_id":"another"}
        with self.assertRaises(RuntimeError):self.call()
        self.assertFalse(self.path.exists())
        self.assertEqual(self.store.deleted,[])
    def test_success_preserves_status_and_releases(self):
        def execute(args,env):
            if "job_search_runner.py" in args[-1]:
                s=json.loads(self.path.read_text());s.update(status="completed",jobs_published=7)
                self.path.write_text(json.dumps(s))
            return SimpleNamespace(returncode=0)
        self.assertEqual(self.call(execute=execute),0)
        self.assertEqual(self.published[0]["jobs_published"],7)
        self.assertFalse((self.path.parent/"jobs.json").exists())
        self.assertEqual(self.store.deleted,[(supervisor.ACTIVE,"12"),(supervisor.LOCK,"11")])

    def test_dev_finalizer_publishes_completion_not_current(self):
        import io
        self.path.parent.mkdir(parents=True)
        self.path.write_text(json.dumps({"run_id":self.id,"status":"completed","completed_at":"2026-11-15T00:00:00+00:00"}))
        calls=[]
        def request(req):
            calls.append(req.full_url)
            if "metadata.google.internal" in req.full_url:
                return io.BytesIO(b'{"access_token":"fake"}')
            return io.BytesIO(b'{"generation":"1"}')
        supervisor.finalize(env={**self.env,"JSCC_RUNTIME_DATA_DIR":str(self.path.parent)},request=request)
        self.assertTrue(any("run-completions" in url for url in calls))
        self.assertTrue(any("latest-run.json" in url for url in calls))
        self.assertFalse(any("current.json" in url or "jobs.json" in url for url in calls))
