import io
import json
import urllib.error
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

class StorageTest(unittest.TestCase):
    def storage(self, responses):
        request = Mock(side_effect=responses)
        return supervisor.Storage("test-bucket", request=request), request

    @staticmethod
    def token(value):
        return io.BytesIO(json.dumps({"access_token": value}).encode())

    @staticmethod
    def error(code):
        return urllib.error.HTTPError("https://storage.googleapis.com/", code, "error", {}, None)

    def test_read_refreshes_after_401_and_pins_media_generation(self):
        store, request = self.storage([
            self.token("old"), self.error(401),
            self.token("fresh"), io.BytesIO(b'{"generation":"11"}'),
            self.token("media"), io.BytesIO(b'{"run_id":"owned"}'),
        ])
        self.assertEqual(store.read(supervisor.LOCK), ("11", {"run_id": "owned"}))
        calls = [call.args[0] for call in request.call_args_list]
        self.assertEqual(calls[1].full_url, calls[3].full_url)
        self.assertEqual(calls[3].get_header("Authorization"), "Bearer fresh")
        self.assertTrue(calls[5].full_url.endswith("?alt=media&generation=11"))
        self.assertEqual(calls[5].get_header("Authorization"), "Bearer media")

    def test_delete_refresh_preserves_generation(self):
        store, request = self.storage([
            self.token("old"), self.error(401),
            self.token("fresh"), io.BytesIO(b""),
        ])
        store.delete(supervisor.ACTIVE, "12")
        first, second = [request.call_args_list[i].args[0] for i in (1, 3)]
        self.assertEqual(first.full_url, second.full_url)
        self.assertTrue(second.full_url.endswith("?ifGenerationMatch=12"))
        self.assertEqual(second.get_method(), "DELETE")
        self.assertEqual(second.get_header("Authorization"), "Bearer fresh")

    def test_persistent_401_stops_after_one_retry(self):
        store, request = self.storage([
            self.token("old"), self.error(401), self.token("fresh"), self.error(401),
        ])
        with self.assertRaises(urllib.error.HTTPError) as error:
            store.read(supervisor.LOCK)
        self.assertEqual(error.exception.code, 401)
        self.assertEqual(request.call_count, 4)

    def test_other_errors_do_not_retry_delete(self):
        for failure in (self.error(403), self.error(412), TimeoutError("uncertain")):
            with self.subTest(failure=failure):
                store, request = self.storage([self.token("fresh"), failure])
                with self.assertRaises(type(failure)):
                    store.delete(supervisor.LOCK, "11")
                self.assertEqual(request.call_count, 2)


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
    def test_admission_denials_identify_only_failed_predicate(self):
        cases = (
            ("APP_ENV", "APP_ENV", "prod"),
            ("CLOUD_RUN_JOB", "CLOUD_RUN_JOB", "other-job"),
            ("GCP_RUNTIME_BUCKET", "GCP_RUNTIME_BUCKET", "different-bucket"),
            ("JSCC_RUN_ID", "JSCC_RUN_ID", "invalid"),
            ("SOURCE_SHA_FORMAT", "SOURCE_SHA", "bad"),
            ("SOURCE_SHA_BUILD_MATCH", "JSCC_JOB_BUILD_SHA", "b" * 40),
        )
        for reason, key, value in cases:
            with self.subTest(reason=reason):
                proposed = dict(self.env, **{key: value})
                with self.assertRaisesRegex(RuntimeError, "DEV supervisor scope denied: " + reason):
                    supervisor.admit(proposed)
        # Never disclose the actual mismatching value.
        with self.assertRaises(RuntimeError) as mismatch:
            supervisor.admit(dict(self.env, JSCC_JOB_BUILD_SHA="c" * 40))
        self.assertNotIn("c" * 40, str(mismatch.exception))

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
