import importlib.util, pathlib, tempfile, unittest
P=pathlib.Path(__file__).resolve().parents[1]/'gateway'/'integrate_gateway.py'
spec=importlib.util.spec_from_file_location('integrate_gateway',P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE="import http from 'node:http';\nasync function authenticate(req) {}\nconst server = http.createServer(async (req, res) => {\n    if (req.method === 'GET' && u.pathname === '/health') return;\n});\n"
class GatewayIntegrationTests(unittest.TestCase):
 def test_valid_baseline(self):
  s=m.integrate(SOURCE)
  self.assertIn("JSCC_DEV_EXECUTOR_API_ENABLED !== 'true'",s)
  self.assertIn('createExecutorHandler({',s)
  self.assertIn('return executorHandler(req, res)',s)
 def test_repeat_denied(self):
  with self.assertRaisesRegex(ValueError,'already_integrated'):m.integrate(m.integrate(SOURCE))
 def test_unknown_denied(self):
  with self.assertRaisesRegex(ValueError,'gateway_baseline_unrecognized'):m.integrate('')
if __name__=='__main__':unittest.main()
