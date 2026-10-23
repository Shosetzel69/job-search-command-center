import hashlib
import unittest
from pathlib import Path
import m01_r8_gate as gate
from m01_r8_provenance import compare_evds

ROOT = Path(__file__).parent
RAW = (ROOT / "cloudbuild.m01.candidate.dev.yaml").read_bytes()
SHA = "a" * 40

def evidence():
    return dict(authorized=True, authorization_id="DEMO-OFFLINE-ONLY", one_shot=True, not_expired=True,
                sha=SHA, remote_sha=SHA, local_sha=SHA, clean_tree=True,
                config_sha256=hashlib.sha256(RAW).hexdigest(), project=gate.PROJECT,
                region=gate.REGION, service_account=gate.SA, connected_repository=gate.REPOSITORY,
                connected_repo_verified=True, iam_fresh=True, iam_exact=True,
                compute_sa_disabled=True, trial_credit_verified=True,
                cost_cap_approved=True, source_revision_verified=True)

class R8Tests(unittest.TestCase):
    def test_candidate(self):
        gate.validate_candidate(RAW.decode())
    def test_evidence_is_not_submit_authorization(self):
        self.assertIn("NOT_AUTHORIZED_TO_SUBMIT", gate.validate_admission(evidence(), RAW)["admission"])
    def test_negative_evidence(self):
        for field in ["authorized", "one_shot", "not_expired", "clean_tree", "iam_exact", "iam_fresh", "trial_credit_verified", "cost_cap_approved", "source_revision_verified", "connected_repo_verified", "compute_sa_disabled"]:
            with self.subTest(field=field):
                e = evidence(); e[field] = False
                with self.assertRaises(ValueError): gate.validate_admission(e, RAW)
    def test_wrong_source_and_config(self):
        for field, value in [("sha", "b"*40), ("remote_sha", "b"*40), ("config_sha256", "b"*64), ("project", "elsewhere"), ("service_account", "x"), ("connected_repository", "x")]:
            with self.subTest(field=field):
                e = evidence(); e[field]=value
                with self.assertRaises(ValueError): gate.validate_admission(e, RAW)
    def test_reject_unsafe_yaml(self):
        raw = RAW.decode()
        mutants = [raw + "\nartifacts: {}\n", raw + "\nsteps: []\n", raw.replace("900s", "1800s"), raw.replace("VERIFIED", "NOT_VERIFIED"), raw.replace("E2_STANDARD_2", "E2_HIGHCPU_8"), raw.replace("    name: gcr.io/cloud-builders/docker", "    allowFailure: true\n    name: gcr.io/cloud-builders/docker"), raw.replace("    name: gcr.io/cloud-builders/docker", "    allowExitCodes: [1]\n    name: gcr.io/cloud-builders/docker"), raw.replace("logging: CLOUD_LOGGING_ONLY", "logging: NONE"), raw.replace("jscc-ci-m01", "default-sa"), raw.replace("images:\n", "images:\n  - evil:latest\n")]
        for i, m in enumerate(mutants):
            with self.subTest(i=i):
                with self.assertRaises((ValueError, TypeError)): gate.validate_candidate(m)
    def test_missing_attestation(self):
        e = dict(sha=SHA, config_sha256="c"*64, source=gate.REPOSITORY, project=gate.PROJECT, region=gate.REGION, service_account=gate.SA, build_id="id")
        p = dict(e, status="SUCCESS", observed_actual_identity=False, provider_source_verified=False, trusted_provenance_signature_verified=False, subject_digest_verified=False, digest="sha256:"+"a"*64, image="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@sha256:"+"a"*64)
        with self.assertRaises(ValueError): compare_evds(e,p)
    def test_mismatched_equal_identity_and_invalid_ids(self):
        base = dict(sha=SHA, config_sha256="c"*64, source=gate.REPOSITORY,
                    project=gate.PROJECT, region=gate.REGION,
                    service_account=gate.SA, build_id="build-123")
        changes = [
            ("service_account", "other@example.iam.gserviceaccount.com"),
            ("project", "jscc-prod"),
            ("region", "us-central1"),
            ("source", gate.REPOSITORY + "-suffix"),
            ("source", gate.REPOSITORY.rsplit("/", 1)[0] + "/unrelated"),
            ("config_sha256", "bogus"),
            ("build_id", ""),
        ]
        for mode in ("normal", "-O", "-OO"):
            with self.subTest(mode=mode):
                import subprocess, sys, json
                for field, value in changes:
                    with self.subTest(field=field, value=value):
                        e = dict(base, **{field: value})
                        p = dict(e, status="SUCCESS", observed_actual_identity=True,
                                 provider_source_verified=True,
                                 trusted_provenance_signature_verified=True,
                                 subject_digest_verified=True,
                                 digest="sha256:" + "a"*64,
                                 image="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@sha256:" + "a"*64)
                        child = """import json,sys
from m01_r8_provenance import compare_evds
x=json.loads(sys.stdin.read())
try:
    compare_evds(x[0],x[1])
except ValueError:
    sys.exit(0)
sys.exit(8)
"""
                        args = [sys.executable] + ([] if mode == "normal" else [mode]) + ["-c", child]
                        proc = subprocess.run(args, input=json.dumps([e,p]), text=True,
                                              capture_output=True, timeout=10, cwd=ROOT)
                        self.assertEqual(proc.returncode, 0, (field, value, mode, proc.stderr))

    def test_valid_structural_pair_never_attests(self):
        e = dict(sha=SHA, config_sha256="c"*64, source=gate.REPOSITORY,
                 project=gate.PROJECT, region=gate.REGION,
                 service_account=gate.SA, build_id="build-123")
        p = dict(e, status="SUCCESS", observed_actual_identity=True,
                 provider_source_verified=True,
                 trusted_provenance_signature_verified=True,
                 subject_digest_verified=True, digest="sha256:" + "a"*64,
                 image="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@sha256:" + "a"*64)
        self.assertEqual(compare_evds(e,p)["result"], "OFFLINE_CONSISTENCY_ONLY_NOT_EVD2_PASS")

    def test_no_cloud_submission_implementation(self):
        import inspect, m01_r8_gate
        source = inspect.getsource(m01_r8_gate)
        self.assertNotIn("subprocess.run", source)
        self.assertNotIn("import google.cloud", source)
        self.assertNotIn("os.system", source)

if __name__ == "__main__": unittest.main()
