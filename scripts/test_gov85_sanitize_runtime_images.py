import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / "scripts/gcp/gov85_sanitize_runtime_images.py"
spec = importlib.util.spec_from_file_location("gov85_runtime_images", FILE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
DIGEST = "sha256:" + "a" * 64
OTHER = "sha256:" + "b" * 64


class Gov85RuntimeImagesTests(unittest.TestCase):
    def test_redacted_digest_only_and_active_revision(self):
        service = {
            "spec":{"template":{"spec":{"containers":[{
                "image":"europe-west1-docker.pkg.dev/private/repo/svc@" + DIGEST,
                "env":[{"name":"SECRET", "value":"do-not-print"}],
            }]}}},
            "status":{"traffic":[{"revisionName":"jscc-command-api-dev-00059-4hb","percent":100}]},
        }
        job = {"spec":{"template":{"spec":{"template":{"spec":{"containers":[{
            "image":"europe-west1-docker.pkg.dev/private/repo/job@" + OTHER,
            "env":[{"name":"SECRET", "value":"do-not-print"}],
        }]}}}}}}
        data = mod.summarize(service, job)
        self.assertEqual(data["service_latest_template_digest"], DIGEST)
        self.assertEqual(data["job_template_digest"], OTHER)
        self.assertEqual(data["serving_revisions"], [("jscc-command-api-dev-00059-4hb", 100)])
        self.assertNotIn("do-not-print", str(data))
        self.assertNotIn("private", str(data))
        self.assertFalse(data["rollback_attested"])

    def test_unknown_schema_or_mutable_tag_never_claims_verified_digest(self):
        service = {"template":{"containers":[{"image":"image:latest"}]}}
        job = {"spec":{"template":{"spec":{"containers":[{"image":"image:abc"}]}}}}
        data = mod.summarize(service, job)
        self.assertEqual(data["service_latest_template_digest"], "UNVERIFIED")
        self.assertEqual(data["job_template_digest"], "UNVERIFIED")
        self.assertFalse(data["rollback_attested"])

    def test_image_with_tokenlike_suffix_is_not_printed(self):
        svc={"template":{"containers":[{"image":"example@"+DIGEST+"?token=secret"}]}}
        self.assertEqual(mod.summarize(svc, {})["service_latest_template_digest"], "UNVERIFIED")

    def test_workflow_remains_read_only_for_runtime(self):
        workflow = (ROOT/".github/workflows/gov85-dev-paired-images.yml").read_text(encoding="utf-8")
        self.assertIn("gov85_sanitize_runtime_images.py", workflow)
        self.assertNotIn("gcloud run jobs execute", workflow)
        self.assertNotIn("gcloud run services update", workflow)
        self.assertNotIn("gcloud run deploy", workflow)
        self.assertNotIn("gcloud run jobs deploy", workflow)


if __name__ == "__main__":
    unittest.main()
