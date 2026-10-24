import importlib.util, os, pathlib, sys, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runner'))
import github_gates as g
SHA='a'*40
class GitHubGatesTest(unittest.TestCase):
 def test_checks_fail_unconfigured(self):
  with patch.dict(os.environ,{'JSCC_DEV_REQUIRED_CHECKS':''}):
   with self.assertRaisesRegex(g.GateError,'not_configured'):g.verify_checks(SHA)
 def test_checks_pass(self):
  with patch.dict(os.environ,{'JSCC_DEV_REQUIRED_CHECKS':'gitleaks,unit-test'}):
   def api(args):return {'total_count':2,'check_runs':[{'name':n,'head_sha':SHA,'status':'completed','conclusion':'success'} for n in ('gitleaks','unit-test')]}
   g.verify_checks(SHA,api)
 def test_review_requires_approval_at_head(self):
  with self.assertRaisesRegex(g.GateError,'approval_missing'):
   g.verify_reviews(5,SHA,lambda args:[])
 def test_review_threads_reject_unresolved(self):
  with self.assertRaisesRegex(g.GateError,'unresolved_review_thread'):
   g.verify_review_threads(5,lambda args:{'data':{'repository':{'pullRequest':{'reviewThreads':{'nodes':[{'isResolved':False}],'pageInfo':{'hasNextPage':False}}}}}})
 def test_review_threads_empty_complete(self):
  g.verify_review_threads(5,lambda args:{'data':{'repository':{'pullRequest':{'reviewThreads':{'nodes':[],'pageInfo':{'hasNextPage':False}}}}}})
if __name__=='__main__':unittest.main()
