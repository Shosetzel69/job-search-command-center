import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/gcp/gov85_serving_revision_evidence.py"
spec = importlib.util.spec_from_file_location("gov85_active_digest", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

A = "jscc-command-api-dev-00059-4hb"
B = "jscc-command-api-dev-00058-xyz"
D1 = "sha256:" + "a" * 64
D2 = "sha256:" + "b" * 64


class Gov85ServingRevisionTests(unittest.TestCase):
    def test_v1_and_v2_active_traffic(self):
        v1 = {"status":{"traffic":[
            {"revisionName":A,"percent":80},
            {"revisionName":B,"percent":20},
            {"revisionName":"jscc-command-api-dev-00050-zzz","percent":0},
        ]}}
        self.assertEqual(mod.active_names(v1), sorted([A, B]))
        v2 = {"traffic":[{"revision":A,"percent":"100"}]}
        self.assertEqual(mod.active_names(v2), [A])

    def test_active_traffic_unresolved_is_fail_closed(self):
        bad = [
            {}, {"status":{"traffic":[]}},
            {"status":{"traffic":[{"revisionName":A,"percent":70}]}},
            {"status":{"traffic":[{"revisionName":A,"percent":120}]}},
            {"status":{"traffic":[{"revisionName":A,"percent":True}]}},
            {"status":{"traffic":[{"revisionName":A,"percent":"20.5"}]}},
            {"status":{"traffic":[{"revisionName":A,"percent":50},
                                   {"revisionName":A,"percent":50}]}},
            {"status":{"traffic":[{"revisionName":"../evil","percent":100}]}},
            {"status":{"traffic":[{"revisionName":A+";echo SECRET","percent":100}]}},
            {"status":{"traffic":[{"latestRevision":True,"percent":100}]}},
        ]
        for case in bad:
            with self.subTest(case=case), self.assertRaises(ValueError):
                mod.active_names(case)

    def test_revision_digest_resolved_v1_and_v2(self):
        v1={"metadata":{"name":A,"annotations":{"user":"SECRET"}},
            "status":{"imageDigest":"registry.example/path/job@" + D1}}
        self.assertEqual(mod.revision_digest(A, v1), D1)
        v2={"name":"projects/jscc-dev/locations/europe-west1/services/jscc-command-api-dev/revisions/"+A,
            "containerStatuses":[{"name":"app","imageDigest":D2}]}
        self.assertEqual(mod.revision_digest(A, v2), D2)

    def test_digest_rejects_identity_or_unresolved(self):
        bad=[
            {"metadata":{"name":B},"status":{"imageDigest":D1}},
            {"metadata":{"name":A},"status":{"imageDigest":"registry:latest"}},
            {"metadata":{"name":A},"status":{"imageDigest":D1+"?secret=TOKEN"}},
            {"metadata":{"name":A}},
            {"name":"projects/jscc-test/locations/europe-west1/services/jscc-command-api-dev/revisions/"+A,
             "containerStatuses":[{"imageDigest":D1}]},
            {"metadata":{"name":A},"containerStatuses":[{"imageDigest":D1},{"imageDigest":D2}]},
        ]
        for case in bad:
            with self.subTest(case=case), self.assertRaises(ValueError):
                mod.revision_digest(A, case)

    def test_cli_restricts_outputs_and_error_messages(self):
        with tempfile.TemporaryDirectory() as td:
            p=pathlib.Path(td) / "revision.json"
            p.write_text(json.dumps({"metadata":{"name":A},
                "status":{"imageDigest":"image@" + D1,"secret":"SECRET_VALUE"}}))
            result=subprocess.run(
                [sys.executable,str(PATH),"--revision-digest",A,str(p)],
                text=True,capture_output=True,check=False)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(),f"GOV85_ACTIVE_REVISION={A} digest={D1}")
            self.assertNotIn("SECRET",result.stdout+result.stderr)
            p.write_text(json.dumps({"metadata":{"name":B},
                "status":{"imageDigest":D1,"secret":"SECRET_VALUE"}}))
            denied=subprocess.run(
                [sys.executable,str(PATH),"--revision-digest",A,str(p)],
                text=True,capture_output=True,check=False)
            self.assertEqual(denied.returncode,86)
            self.assertEqual(denied.stdout,"")
            self.assertEqual(denied.stderr.strip(),"GOV85_ACTIVE_REVISION_UNVERIFIED")
            self.assertNotIn("SECRET_VALUE",denied.stderr)

    def test_workflow_uses_read_only_cloud_run_revision_describe(self):
        workflow=(ROOT/".github/workflows/gov85-dev-paired-images.yml").read_text()
        self.assertIn("gov85_serving_revision_evidence.py",workflow)
        self.assertIn("gcloud run revisions describe",workflow)
        self.assertNotIn("gcloud run revisions delete",workflow)
        self.assertNotIn("gcloud run services update",workflow)
        self.assertNotIn("gcloud run jobs execute",workflow)


if __name__ == "__main__":
    unittest.main()
