"""#589 RE-02 contract tests against the real manager HTTP routing (local only)."""
import json
import os
import pathlib
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault('JSCC_LOCAL_BACKEND', tempfile.mkdtemp(prefix='jscc-r2-http-'))
os.environ.setdefault('WORKER_URL','http://127.0.0.1:9')
from service import manager
from service.backend import LocalBackend


class WorkspaceHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        manager.backend=LocalBackend(cls.temp.name)
        manager.backend.put('src/app.py',b'alpha\nsecret=private-value\n',0)
        manager.backend.put('src/changed.py',b'alpha\nchanged\n',0)
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),manager.Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        cls.temp.cleanup()

    @classmethod
    def request(cls,path,body=None,method=None):
        payload=None if body is None else json.dumps(body).encode('utf-8')
        req=urllib.request.Request(
            cls.url+path,data=payload,
            headers={'Content-Type':'application/json'},
            method=method or ('GET' if body is None else 'POST')
        )
        try:
            with urllib.request.urlopen(req,timeout=3) as r:
                return r.status,json.load(r)
        except urllib.error.HTTPError as e:
            return e.code,json.load(e)

    def test_read_only_new_endpoints_hide_source(self):
        status, data=self.request('/v1/search?term=private-value')
        self.assertEqual(status,200)
        self.assertEqual(data['matches'],[{'path':'src/app.py','line':2}])
        self.assertNotIn('private-value',json.dumps(data))
        status, data=self.request('/v1/checksum?path=src%2Fapp.py')
        self.assertEqual(status,200)
        self.assertEqual(data['generation'],1)
        self.assertEqual(len(data['sha256']),64)
        status, data=self.request('/v1/compare?left=src%2Fapp.py&right=src%2Fchanged.py')
        self.assertEqual(status,200)
        self.assertTrue(data['diff_available'])
        self.assertFalse(data['equal'])
        self.assertNotIn('secret=',json.dumps(data))

    def test_optimistic_patch_and_conflict(self):
        status,data=self.request('/v1/replace',{
            'path':'src/changed.py','old':'changed','new':'new-line','if_generation_match':1
        })
        self.assertEqual(status,200)
        self.assertEqual(data['generation'],2)
        status,data=self.request('/v1/replace',{
            'path':'src/changed.py','old':'new-line','new':'wrong','if_generation_match':1
        })
        self.assertEqual(status,409)
        self.assertEqual(data['error'],'generation_conflict')

    def test_delete_exact_path_and_stale_generation(self):
        manager.backend.put('tmp/discard.txt',b'data',0)
        status,result=self.request('/v1/file?path=tmp%2Fdiscard.txt&if_generation_match=2',method='DELETE')
        self.assertEqual(status,409)
        self.assertEqual(result['error'],'generation_conflict')
        status,result=self.request('/v1/file?path=tmp%2Fdiscard.txt&if_generation_match=1',method='DELETE')
        self.assertEqual(status,200)
        self.assertTrue(result['deleted'])
        status,result=self.request('/v1/file?path=tmp%2Fdiscard.txt&if_generation_match=1',method='DELETE')
        self.assertEqual(status,409)
        status,result=self.request('/v1/file?path=tmp%2Fdiscard.txt&if_generation_match=0',method='DELETE')
        self.assertEqual(status,400)

    def test_rejected_paths_extra_args_and_nonunique_patch(self):
        status,data=self.request('/v1/checksum?path=..%2Fprivate')
        self.assertEqual(status,400)
        status,data=self.request('/v1/search?term=&command=rm')
        self.assertEqual(status,400)
        status,data=self.request('/v1/replace',{
            'path':'src/app.py','old':'alpha','new':'x','if_generation_match':1,
            'command':'rm'
        })
        self.assertEqual(status,400)
        status,data=self.request('/v1/replace',{
            'path':'src/app.py','old':'a','new':'x','if_generation_match':1
        })
        self.assertEqual(status,400)
        self.assertEqual(data['error'],'replacement_not_unique')


    def test_run_cwd_validated_before_forwarding(self):
        from unittest.mock import patch
        with patch.object(manager, 'execute_worker', return_value={'exit_code':0}) as execute:
            for body, expected in [
                ({'task':'pytest'}, '.'),
                ({'task':'pytest','cwd':'.'}, '.'),
                ({'task':'command','argv':['python3','app.py'],'cwd':'src'}, 'src'),
            ]:
                status, result = self.request('/v1/run', body)
                self.assertEqual(status, 200)
                self.assertEqual(result['exit_code'], 0)
                self.assertEqual(execute.call_args.args[1:], (body['task'],body.get('argv'),expected))
            execute.reset_mock()
            for cwd in (None, '', '/tmp', '../tmp', 'src/..', 'src/.git',
                        'missing', 'src/app.py'):
                status, result = self.request('/v1/run', {'task':'pytest','cwd':cwd})
                self.assertEqual(status, 400, cwd)
            execute.assert_not_called()

    def test_manager_worker_payload_legacy_compatibility(self):
        from unittest.mock import patch, MagicMock
        response=MagicMock()
        response.__enter__.return_value.read.return_value='{"exit_code":0}'
        with patch.object(manager.urllib.request,'urlopen',return_value=response) as call:
            for cwd in ('.','src'):
                manager.execute_worker({'src/app.py':b'pass'},'pytest',cwd=cwd)
                payload=json.loads(call.call_args.args[0].data)
                self.assertEqual(payload.get('cwd'),None if cwd=='.' else 'src')
                self.assertEqual(payload['task'],'pytest')


    def test_snapshot_pin_matches_listing_and_rejects_drift_before_worker(self):
        from unittest.mock import patch
        status, listing = self.request('/v1/files')
        self.assertEqual(status,200)
        pin=listing['snapshot_sha256']
        self.assertEqual(len(pin),64)
        with patch.object(manager,'execute_worker',return_value={'exit_code':0,'snapshot_sha256':pin}) as run:
            status,result=self.request('/v1/run',{'task':'pytest','expected_snapshot_sha256':pin})
            self.assertEqual(status,200)
            self.assertEqual(result['snapshot_sha256'],pin)
            self.assertEqual(run.call_args.kwargs['expected_snapshot_sha256'],pin)
            run.reset_mock()
            for bad in (None,'0'*64,'A'*64):
                status,result=self.request('/v1/run',{'task':'pytest','expected_snapshot_sha256':bad})
                self.assertEqual(status,400)
            run.assert_not_called()
            run.return_value={'exit_code':0}
            status,result=self.request('/v1/run',{'task':'pytest','expected_snapshot_sha256':pin})
            self.assertEqual(status,502)
            self.assertEqual(result['error'],'worker_snapshot_unconfirmed')


    def test_atomic_move_local_backend_refuses_overwrite_and_stale_generation(self):
        manager.backend.put('move/src.txt',b'fixture',0)
        manager.backend.put('move/existing.txt',b'keep',0)
        args={'source':'move/src.txt','destination':'move/dst.txt','if_generation_match':1}
        for bad in ({**args,'destination':'move/existing.txt'},{**args,'if_generation_match':2}):
            status,result=self.request('/v1/move',bad)
            self.assertEqual(status,409)
            self.assertEqual(manager.backend.get('move/src.txt')[0],b'fixture')
        status,result=self.request('/v1/move',args)
        self.assertEqual(status,200)
        self.assertTrue(result['moved'])
        self.assertIsNone(manager.backend.get('move/src.txt'))
        self.assertEqual(manager.backend.get('move/dst.txt'),(b'fixture',result['generation']))


class WorkerCwdTests(unittest.TestCase):
    def test_actual_worker_runs_from_selected_snapshot_directory(self):
        import base64
        from service import worker
        files={'src/nested/value.txt':base64.b64encode(b'fixture').decode()}
        argv=['python3','-c','from pathlib import Path; print(Path("value.txt").read_text())']
        result=worker.execute(files,'command',argv,'src/nested')
        self.assertEqual(result['exit_code'],0)
        self.assertEqual(result['stdout'].strip(),'fixture')
        root_argv=['python3','-c','from pathlib import Path; print(Path("src/nested/value.txt").read_text())']
        for args in ((files,'command',root_argv),(files,'command',root_argv,'.')):
            result=worker.execute(*args)
            self.assertEqual(result['exit_code'],0)
            self.assertEqual(result['stdout'].strip(),'fixture')

    def test_worker_rechecks_snapshot_identity_before_process_launch(self):
        import base64
        from unittest.mock import patch
        from service import worker
        from service.common import snapshot_sha256
        files={'src/a.txt':base64.b64encode(b'abc').decode()}
        pin=snapshot_sha256({'src/a.txt':b'abc'})
        self.assertNotEqual(pin,snapshot_sha256({'src/b.txt':b'abc'}))
        self.assertNotEqual(pin,snapshot_sha256({'src/a.txt':b'abd'}))
        with patch.object(worker.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(ValueError,'snapshot_sha256_mismatch'):
                worker.execute(files,'pytest',expected_snapshot_sha256='0'*64)
            launch.assert_not_called()
        result=worker.execute(files,'command',['python3','-V'],expected_snapshot_sha256=pin)
        self.assertEqual(result['snapshot_sha256'],pin)

    def test_worker_denies_invalid_cwd_before_process_launch(self):
        import base64
        from unittest.mock import patch
        from service import worker
        files={'src/nested/value.txt':base64.b64encode(b'fixture').decode()}
        with patch.object(worker.subprocess,'Popen') as launch:
            for cwd in (None, '', '/tmp', '../tmp', 'src/..', 'src/.git',
                        'missing', 'src/nested/value.txt', 'src//nested'):
                with self.subTest(cwd=cwd), self.assertRaises(ValueError):
                    worker.execute(files,'command',['python3','-V'],cwd)
            launch.assert_not_called()

if __name__ == '__main__':
    unittest.main()
