import importlib.util
import pathlib
import unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('entrypoint',ROOT/'runner/job-entrypoint.py')
import sys
sys.path.insert(0,str(ROOT/'runner'))
entrypoint=importlib.util.module_from_spec(spec);spec.loader.exec_module(entrypoint)

class ContractTests(unittest.TestCase):
    def test_gcs_generation_validation(self):
        with self.assertRaisesRegex(entrypoint.GateError,'invalid_gcs_generation'):
            entrypoint.gs_read('jscc-testbucket','executor-patches/a.patch','token',100,'0')
        with self.assertRaisesRegex(entrypoint.GateError,'invalid_gcs_generation'):
            entrypoint.gs_read('jscc-testbucket','executor-patches/a.patch','token',100,'1&alt=json')
    def test_generation_appears_in_media_url(self):
        class FakeResponse:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return b'test'
        seen=[]
        def fake_open(req,timeout):
            seen.append(req.full_url)
            return FakeResponse()
        with patch.object(entrypoint.urllib.request,'urlopen',fake_open):
            self.assertEqual(entrypoint.gs_read('jscc-testbucket','executor-patches/a.patch','token',100,'567'),b'test')
        self.assertIn('generation=567',seen[0])

if __name__=='__main__':unittest.main()
