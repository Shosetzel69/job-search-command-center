"""#589 RE-02 bounded workspace operations, Python stdlib tests."""
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from service.backend import GenerationConflict, LocalBackend
from service.workspace_ops import checksum, find_literal, compare, replace_once


class WorkspaceOpsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = LocalBackend(self.temp.name)
        self.store.put('src/app.py', b'hello world\nsecond line\n', 0)

    def test_hash_and_generation(self):
        import hashlib
        out=checksum(self.store,'src/app.py')
        self.assertEqual(out['generation'],1)
        self.assertEqual(out['sha256'],hashlib.sha256(b'hello world\nsecond line\n').hexdigest())
        self.assertEqual(out['bytes'],24)
        self.assertIsNone(checksum(self.store,'missing.txt'))

    def test_search_literal_no_source_snippets(self):
        result=find_literal(self.store,'hello')
        self.assertEqual(result['matches'],[{'path':'src/app.py','line':1}])
        self.assertNotIn('hello',str(result))
        self.assertEqual(find_literal(self.store,'nomatch')['matches'],[])
        for term in ('','a'*101,None):
            with self.assertRaises(ValueError):
                find_literal(self.store,term)

    def test_search_binary_ignored(self):
        self.store.put('binary.bin',b'\xffhello',0)
        self.assertEqual(len(find_literal(self.store,'hello')['matches']),1)

    def test_compare_returns_ranges_not_contents(self):
        self.store.put('src/changed.py',b'hello world\nchanged line\n',0)
        res=compare(self.store,'src/app.py','src/changed.py')
        self.assertFalse(res['equal'])
        self.assertTrue(res['diff_available'])
        self.assertEqual(res['changed_line_ranges'],[
            {'type':'replace','left_start':2,'left_end':2,'right_start':2,'right_end':2}
        ])
        self.assertNotIn('changed line',str(res))
        self.assertTrue(compare(self.store,'src/app.py','src/app.py')['equal'])
        self.assertIsNone(compare(self.store,'missing.txt','src/app.py'))

    def test_replace_generation_cas(self):
        out=replace_once(self.store,'src/app.py','second line','patched',1)
        self.assertEqual(out['generation'],2)
        self.assertEqual(self.store.get('src/app.py')[0],b'hello world\npatched\n')
        with self.assertRaises(GenerationConflict):
            replace_once(self.store,'src/app.py','patched','oops',1)
        self.assertEqual(self.store.get('src/app.py')[0],b'hello world\npatched\n')

    def test_replace_must_be_unique_and_nonempty(self):
        before=self.store.get('src/app.py')[0]
        for old in ('l','', 'missing'):
            with self.assertRaises(ValueError):
                replace_once(self.store,'src/app.py',old,'other',1)
        self.assertEqual(self.store.get('src/app.py')[0],before)

    def test_replace_rejects_binary_and_new_file(self):
        self.store.put('binary.bin',b'\xff',0)
        with self.assertRaisesRegex(ValueError,'binary_file'):
            replace_once(self.store,'binary.bin','a','b',1)
        self.assertIsNone(replace_once(self.store,'missing.txt','a','b',1))
        with self.assertRaises(ValueError):
            replace_once(self.store,'src/app.py','hello','changed',True)

    def test_replace_enforces_file_cap_and_safe_paths(self):
        for replacement in ('x'*8193,):
            with self.assertRaises(ValueError):
                replace_once(self.store,'src/app.py','hello world',replacement,1)
        for p in ('../secrets','.env','src/../../secret'):
            with self.assertRaises(ValueError):
                checksum(self.store,p)

if __name__ == '__main__':
    unittest.main()
