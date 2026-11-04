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

if __name__ == '__main__':
    unittest.main()
