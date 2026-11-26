"""#520: DEV deployment must fail closed on Search Job/Service image drift."""
import contextlib
import io
import unittest

from scripts.deploy import jscc_search_pair_guard as guard

SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64
IMAGE = guard.JOB_IMAGE


def job(image=IMAGE + "@" + DIGEST, app_env="dev",
        bucket="jscc-dev-runtime-828902654738", version=2):
    c = {"image": image, "env": [
        {"name": "APP_ENV", "value": app_env},
        {"name": "GCP_RUNTIME_BUCKET", "value": bucket},
    ]}
    if version == 2:
        return {"template": {"template": {"containers": [c]}}}
    return {"spec": {"template": {"spec": {"template": {"spec": {"containers": [c]}}}}}}


class SearchPairTest(unittest.TestCase):
    def check_denied(self, payload, reason, sha=SHA, digest=DIGEST):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as exc:
            guard.check(payload, sha, digest)
        self.assertEqual(exc.exception.code, 86)
        self.assertIn(reason, err.getvalue())

    def test_immutable_digest_v2(self):
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check(job(), SHA, DIGEST)

    def test_immutable_sha_tag_v1(self):
        with contextlib.redirect_stdout(io.StringIO()):
            guard.check(job(IMAGE + ":" + SHA, version=1), SHA, DIGEST)

    def test_unrelated_image_refused(self):
        self.check_denied(job(IMAGE + "@" + "sha256:" + "c" * 64), "JOB_IMAGE_SHA_MISMATCH")

    def test_old_sha_tag_refused(self):
        self.check_denied(job(IMAGE + ":" + "c" * 40), "JOB_IMAGE_SHA_MISMATCH")

    def test_missing_job_shape_refused(self):
        self.check_denied({}, "JOB_TEMPLATE_NOT_ATTESTED")

    def test_non_dev_refused(self):
        self.check_denied(job(app_env="prod"), "JOB_DEV_CONFIGURATION_MISMATCH")

    def test_bucket_drift_refused(self):
        self.check_denied(job(bucket="other"), "JOB_DEV_CONFIGURATION_MISMATCH")

    def test_missing_sha_or_digest_refused(self):
        self.check_denied(job(), "CANDIDATE_IDENTITY_INVALID", sha="main")
        self.check_denied(job(), "CANDIDATE_IDENTITY_INVALID", digest="sha256:bogus")

    def test_duplicate_environment_key_refused(self):
        payload = job()
        payload["template"]["template"]["containers"][0]["env"].append(
            {"name": "APP_ENV", "value": "dev"})
        self.check_denied(payload, "JOB_ENV_INVALID")


if __name__ == "__main__":
    unittest.main()
