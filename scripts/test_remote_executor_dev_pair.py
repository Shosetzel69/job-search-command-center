"""Offline fixtures for fixed R6 operator transport; no credentials or network."""
import copy
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "gcp"))
import remote_executor_dev_pair as pair


OLD = pair.binding("a"*40, "sha256:"+"b"*64, "sha256:"+"c"*64)
NEW = pair.binding("d"*40, "sha256:"+"e"*64, "sha256:"+"f"*64)
OLD_REV = pair.GATEWAY+"-00015-lxb"
NEW_REV = pair.GATEWAY+"-00016-abc"
CAT = "589-nile-api-v1"
BASE = "projects/jscc-dev/locations/europe-west1/"


def task(kind, values):
    name = pair.GATEWAY if kind == "gateway" else pair.WORKER
    return {"serviceAccount": name+"@jscc-dev.iam.gserviceaccount.com",
            "containers": [{"image": pair.image(kind, values), "env": [
                *({"name": key, "value": value} for key, value in values.items()),
                {"name": "OTHER", "value": "unchanged"},
                {"name": "GOOGLE_CLIENT_SECRET", "valueSource": {"secretKeyRef": {
                    "secret": "fixture-secret", "version": "1"}}},
            ]}]}


class API:
    def __init__(self):
        self.service_data = {"name": BASE+"services/"+pair.GATEWAY,
            "generation": "1", "observedGeneration": "1",
            "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
            "uri": sorted(pair.URIS)[0], "template": task("gateway", OLD),
            "latestCreatedRevision": OLD_REV, "latestReadyRevision": OLD_REV,
            "scaling": {"maxInstanceCount": 1},
            "traffic": [{"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                         "revision": OLD_REV, "percent": 100}]}
        self.service_data["trafficStatuses"] = copy.deepcopy(self.service_data["traffic"])
        self.worker_data = {"name": BASE+"jobs/"+pair.WORKER,
            "generation": "1", "observedGeneration": "1",
            "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
            "template": {"taskCount": 1, "template": task("worker", OLD)}}
        self.revisions = {OLD_REV: self.revision(OLD_REV, OLD)}
        self.calls = []

    def revision(self, name, values):
        return {"name": BASE+"services/"+pair.GATEWAY+"/revisions/"+name,
                "conditions": [{"type": "Ready", "state": "CONDITION_SUCCEEDED"}],
                **task("gateway", values)}

    def request(self, url):
        if "/revisions/" in url:
            return copy.deepcopy(self.revisions[url.rsplit("/", 1)[-1]]), {}
        return copy.deepcopy(self.service_data), {}

    def job(self, name):
        self.assert_worker(name)
        return copy.deepcopy(self.worker_data)

    def assert_worker(self, name):
        if name != pair.WORKER:
            raise AssertionError("unexpected job")

    def run(self, argv, **kwargs):
        self.calls.append(argv)
        assert kwargs["check"] and kwargs["timeout"] == 300
        assert "--impersonate-service-account="+pair.DEPLOYER in argv
        assert "--project=jscc-dev" in argv and "--region=europe-west1" in argv
        assert not any(x.startswith(("--set-env-vars", "--set-secrets", "--remove-secrets")) for x in argv)
        if argv[3] == "update-traffic":
            rev = next(x for x in argv if x.startswith("--to-revisions=")).split("=")[1]
            for key in ("traffic", "trafficStatuses"):
                self.service_data[key][0]["revision"] = rev
            return
        vals = dict(x.split("=",1) for x in next(x for x in argv if x.startswith("--update-env-vars=")).split("=",1)[1].split(","))
        if argv[2] == "jobs":
            self.worker_data["template"] = pair.expected_template(self.worker_data["template"], "worker", vals)
        else:
            assert "--no-traffic" in argv
            self.service_data["template"] = pair.expected_template(self.service_data["template"], "gateway", vals)
            rev = NEW_REV if vals == NEW else pair.GATEWAY+"-00017-def"
            self.revisions[rev] = self.revision(rev, vals)
            self.service_data["latestReadyRevision"] = rev
            self.service_data["latestCreatedRevision"] = rev


class PairTests(unittest.TestCase):
    def setUp(self):
        self.api = API()
        self.p = pair.PairOperator(self.api, self.api.run, lambda uri: CAT)
        self.p.guard = Mock()
        self.p.guard.baseline = "protected"
        self.p.guard.inspect.return_value = "protected"
        self.p.guard.release_after_verified.side_effect = lambda verifier: self.assertTrue(verifier())
        for method, value in (("assert_drained", None), ("protected_snapshot", "protected")):
            patcher = patch.object(pair, method, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.p.capture({"source_sha": NEW[pair.KEYS[0]], "gateway_digest": NEW[pair.KEYS[1]],
                        "worker_digest": NEW[pair.KEYS[2]], "catalog": CAT, "previous_catalog": CAT})

    def test_explicit_cutover_and_owned_release(self):
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.assertEqual(self.p.verify_pair(False)["gateway_image"], pair.image("gateway", NEW))
        self.p.release()
        self.assertEqual([x[3] for x in self.api.calls], ["update", "update", "update-traffic"])
        self.assertIn("--to-revisions="+NEW_REV+"=100", self.api.calls[-1])
        self.p.guard.release_after_verified.assert_called_once()

    def test_rollback_restores_previous_pair_and_effective_revision(self):
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.p.rollback_gateway()
        self.p.rollback_worker()
        self.assertEqual(self.p.verify_pair(True)["worker_image"], pair.image("worker", OLD))
        self.p.release()
        self.assertIn("--to-revisions="+OLD_REV+"=100", self.api.calls[-2])
        self.assertEqual(pair.normalized(self.api.worker_data["template"]), pair.normalized(self.p.old["worker"]))

    def test_ambiguous_cloud_command_blocks_both_rollback_mutations(self):
        self.p.freeze()
        self.p.runner = Mock(side_effect=subprocess.TimeoutExpired("fixture", 300))
        with self.assertRaisesRegex(pair.Blocked, "cloud_run_mutation_outcome_uncertain"):
            self.p.deploy_worker()
        for rollback in (self.p.rollback_gateway, self.p.rollback_worker):
            with self.assertRaisesRegex(pair.Blocked, "mutation_outcome_uncertain"):
                rollback()
        self.p.runner.assert_called_once()
        self.p.guard.release_after_verified.assert_not_called()

    def test_unfreeze_uncertain_blocks_rollback(self):
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.p.verify_pair(False)
        self.p.guard.release_after_verified.side_effect = pair.Blocked("uncertain")
        with self.assertRaises(pair.Blocked):
            self.p.release()
        with self.assertRaisesRegex(pair.Blocked, "mutation_outcome_uncertain"):
            self.p.rollback_worker()

    def test_template_and_policy_drift_block_verification(self):
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.api.worker_data["template"]["taskCount"] = 2
        with self.assertRaisesRegex(pair.Blocked, "template_drift"):
            self.p.verify_pair(False)
        self.api.worker_data["template"]["taskCount"] = 1
        self.api.service_data["scaling"]["maxInstanceCount"] = 2
        with self.assertRaisesRegex(pair.Blocked, "resource_policy_drift"):
            self.p.verify_pair(False)

    def test_wrong_effective_image_or_catalog_blocks_verification(self):
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.p.health_reader = lambda uri: "wrong-catalog"
        with self.assertRaisesRegex(pair.Blocked, "catalog_mismatch"):
            self.p.verify_pair(False)
        self.p.health_reader = lambda uri: CAT
        self.api.revisions[NEW_REV]["containers"][0]["image"] = pair.image("gateway", OLD)
        with self.assertRaisesRegex(pair.Blocked, "effective_revision_binding_mismatch"):
            self.p.verify_pair(False)

    def test_missing_lease_ownership_blocks_before_cli(self):
        self.p.freeze()
        self.p.guard.assert_owned.side_effect = pair.Blocked("not-owned")
        with self.assertRaises(pair.Blocked):
            self.p.deploy_worker()
        self.assertEqual(self.api.calls, [])


if __name__ == "__main__":
    unittest.main()
