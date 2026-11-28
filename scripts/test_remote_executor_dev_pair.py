"""Offline fixtures for fixed R6 operator transport; no credentials or network."""
import copy
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import Mock, create_autospec, patch

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
            "labels": {"client.knative.dev/nonce": "initial", "fixture": "preserved"},
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
            "template": {"taskCount": 1, "labels": {"client.knative.dev/nonce": "initial"},
                         "template": task("worker", OLD)}}
        self.revisions = {OLD_REV: self.revision(OLD_REV, OLD)}
        self.operator = None
        self.calls = []

    def revision(self, name, values):
        return {"name": BASE+"services/"+pair.GATEWAY+"/revisions/"+name,
                "conditions": [{"type": "Ready", "state": "CONDITION_SUCCEEDED"}],
                **task("gateway", values)}

    def request(self, url):
        if url.endswith("/jobs/"+pair.OP_JOB):
            return copy.deepcopy(self.operator), {}
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
            self.worker_data["template"]["labels"]["client.knative.dev/nonce"] = str(len(self.calls))
            self.worker_data["template"]["template"]["labels"]["client.knative.dev/nonce"] = str(len(self.calls))
        else:
            assert "--no-traffic" in argv
            current = pair.operator_env(self.service_data["template"])
            current.update({key: value for key, value in vals.items() if key in pair.OP_KEYS})
            for arg in argv:
                if arg.startswith("--remove-env-vars="):
                    for key in arg.split("=", 1)[1].split(","):
                        current.pop(key, None)
            values = {key: vals[key] for key in pair.KEYS}
            self.service_data["template"] = pair.expected_template(self.service_data["template"], "gateway", values, current)
            self.service_data["template"]["labels"]["client.knative.dev/nonce"] = str(len(self.calls))
            rev = NEW_REV if values == NEW else pair.GATEWAY+"-00017-def"
            self.revisions[rev] = self.revision(rev, values)
            pair.container(self.revisions[rev])["env"].extend({"name": k, "value": v} for k, v in current.items())
            self.service_data["latestReadyRevision"] = rev
            self.service_data["latestCreatedRevision"] = rev


class PairTests(unittest.TestCase):
    def setUp(self):
        self.api = API()
        self.p = pair.PairOperator(self.api, self.api.run, lambda uri: CAT)
        self.p.guard = create_autospec(pair.MaintenanceGuard, instance=True)
        self.p.guard.baseline = "protected"
        self.p.guard.inspect.return_value = "protected"
        self.p.guard.release_after_verified.side_effect = lambda verifier: self.assertTrue(verifier())
        for method, value in (("assert_drained", None), ("protected_snapshot", "protected")):
            patcher = patch.object(pair, method, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.anchor = self.p.capture({"source_sha": NEW[pair.KEYS[0]], "gateway_digest": NEW[pair.KEYS[1]],
                        "worker_digest": NEW[pair.KEYS[2]], "catalog": CAT, "previous_catalog": CAT})

    def test_operator_activation_preserves_other_env_and_rollback_removes_only_owned_flags(self):
        # Recreate the session with the separately pinned new operator Job.
        self.p.old = None
        digest = "sha256:" + "1"*64
        self.api.operator = {"name": BASE+"jobs/"+pair.OP_JOB, "generation": "1", "observedGeneration": "1",
            "terminalCondition": {"state": "CONDITION_SUCCEEDED"}, "template": {"taskCount": 1, "parallelism": 1,
            "template": {"serviceAccount": pair.OP_JOB+"@jscc-dev.iam.gserviceaccount.com",
            "maxRetries": 0, "timeout": "1800s", "containers": [{"image": pair.ROOT+"jscc-ops-operator@"+digest,
            "resources": {"limits": {"cpu": "1", "memory": "1Gi"}}, "env": [
            {"name": k, "value": v} for k, v in {"SOURCE_SHA": NEW[pair.KEYS[0]], "GCP_PROJECT": "jscc-dev",
             "GCP_REGION": "europe-west1", "OPS_BUCKET": "jscc-dev-ops-state",
              "JSCC_DEV_OPERATOR_REVIEW_KEY_SHA256": "a"*64}.items()]}]}}}
        target = {"source_sha": NEW[pair.KEYS[0]], "gateway_digest": NEW[pair.KEYS[1]], "worker_digest": NEW[pair.KEYS[2]],
                  "catalog": CAT, "previous_catalog": CAT, "operator_activation": {"source_sha": NEW[pair.KEYS[0]],
                  "image_digest": digest, "activation_ref": "#589/300", "publisher_ref": "#589/301"}}
        self.p.capture(target)
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.assertEqual(pair.operator_env(self.api.service_data["template"]), self.p.new_operator_env)
        self.assertEqual(pair.operator_env(self.api.worker_data["template"]), {})
        self.p.verify_pair(False)
        self.p.rollback_gateway()
        self.p.rollback_worker()
        self.p.verify_pair(True)
        self.assertEqual(pair.operator_env(self.api.service_data["template"]), {})
        self.assertEqual(pair.normalized(self.api.service_data["template"]), pair.normalized(self.p.old["gateway"]))
        self.assertTrue(any("--remove-env-vars="+",".join(pair.OP_KEYS) in argv for argv in self.api.calls))

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

    def test_nonce_rotation_is_not_template_drift_but_other_labels_are(self):
        self.p.freeze()
        self.p.deploy_worker()
        self.p.deploy_gateway()
        self.assertNotEqual(self.api.service_data["template"]["labels"]["client.knative.dev/nonce"],
                            self.p.old["gateway"]["labels"]["client.knative.dev/nonce"])
        self.assertNotEqual(self.api.worker_data["template"]["labels"]["client.knative.dev/nonce"],
                            self.p.old["worker"]["labels"]["client.knative.dev/nonce"])
        self.p.verify_pair(False)
        self.api.service_data["template"]["labels"]["fixture"] = "changed"
        with self.assertRaisesRegex(pair.Blocked, "template_drift"):
            self.p.verify_pair(False)
        self.api.service_data["template"]["labels"]["fixture"] = "preserved"
        self.api.worker_data["template"]["template"]["labels"]["client.knative.dev/other"] = "changed"
        with self.assertRaisesRegex(pair.Blocked, "template_drift"):
            self.p.verify_pair(False)
        self.api.worker_data["template"]["template"]["labels"].pop("client.knative.dev/other")
        self.api.service_data["template"]["annotations"] = {"client.knative.dev/user-image": "changed"}
        with self.assertRaisesRegex(pair.Blocked, "template_drift"):
            self.p.verify_pair(False)
        self.api.service_data["template"].pop("annotations")
        self.p.rollback_gateway()
        self.p.rollback_worker()
        self.p.verify_pair(True)
        self.p.release()

    def test_nonce_only_label_map_can_be_absent(self):
        baseline = task("gateway", OLD)
        baseline.pop("labels")
        after = copy.deepcopy(baseline)
        after["labels"] = {"client.knative.dev/nonce": "generated"}
        self.assertEqual(pair.normalized(baseline), pair.normalized(after))
        self.assertIn("client.knative.dev/nonce", after["labels"])

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

    def test_recovery_anchors_and_live_lease_are_read_only(self):
        maintenance_id = "maintenance-" + "a" * 64
        self.api.read_lease = Mock(return_value=(
            {"operation_id": maintenance_id, "state": "ACTIVE",
             "expires_at_ms": pair.MAINTENANCE_EXPIRY}, "123"))
        baseline = self.p.observe_recovery(maintenance_id)
        self.assertEqual(baseline["lease_state"], "OWNED_ACTIVE")
        self.assertEqual(baseline["lease_generation"], "123")
        self.assertEqual(baseline["gateway_template_hash"], self.anchor["gateway_template_hash"])
        self.assertEqual(baseline["worker_template_hash"], self.anchor["worker_template_hash"])
        self.assertEqual(self.api.calls, [])
        self.p.freeze(maintenance_id)
        self.p.guard.freeze.assert_called_once_with("protected", maintenance_id)
        self.p.deploy_worker()
        self.p.deploy_gateway()
        after = self.p.observe_recovery(maintenance_id)
        self.assertEqual(after["gateway_template_hash"], self.anchor["next_gateway_template_hash"])
        self.assertEqual(after["worker_template_hash"], self.anchor["next_worker_template_hash"])
        self.assertEqual(after["effective_binding"]["source_sha"], NEW[pair.KEYS[0]])
        self.api.read_lease.return_value = (
            {"operation_id": "unrelated", "state": "ACTIVE", "expires_at_ms": 100}, "456")
        other = self.p.observe_recovery(maintenance_id)
        self.assertEqual(other["lease_state"], "OTHER")
        self.assertIsNone(other["lease_generation"])
        self.assertNotIn("unrelated", str(other))
        self.assertNotIn("fixture-secret", str(other))

    def test_protected_baseline_changes_after_capture_block_freeze(self):
        self.p.guard.inspect.return_value = "changed"
        with self.assertRaisesRegex(pair.Blocked, "protected_state_drift_since_capture"):
            self.p.freeze("maintenance-" + "a" * 64)
        self.p.guard.freeze.assert_not_called()
        self.assertEqual(self.api.calls, [])

    def test_private_rpc_requires_matching_durable_intent(self):
        approval = "#589/1001"
        operation_id = pair.fingerprint({"environment": "dev", "work_item_ref": "#589",
                                         "operation": "dev-ops-pair", "approval_ref": approval})
        maintenance_id = "maintenance-" + operation_id
        target = {"source_sha": NEW[pair.KEYS[0]], "gateway_digest": NEW[pair.KEYS[1]],
                  "worker_digest": NEW[pair.KEYS[2]], "catalog": CAT, "previous_catalog": CAT}
        now = pair.now_ms()
        bundle = {"environment": "dev", "work_item_ref": "#589", "previous": self.anchor,
                  "next": target, "evidence": {"approval": approval},
                  "issued_at_ms": now-1000, "expires_at_ms": now+60000}
        record = {"schema_version": "1.0", "environment": "dev",
                  "operation_kind": "dev-ops-pair", "operation_id": operation_id,
                  "maintenance_id": maintenance_id, "state": "RUNNING",
                  "approval_ref": approval, "evidence_hash": pair.fingerprint(bundle),
                  "bundle": bundle, "history": [{"step": "freeze", "outcome": "INTENT"}]}
        api = Mock()
        api.request.return_value = (record, {"x-goog-generation": "99"})
        pair.require_journal_intent(api, maintenance_id, "freeze", self.anchor, target)
        self.assertTrue(api.request.call_args.args[0].endswith(
            "control%2Fv1%2Fdeployments%2F" + operation_id + ".json?alt=media"))
        with self.assertRaisesRegex(pair.Blocked, "durable_intent_mismatch"):
            pair.require_journal_intent(api, maintenance_id, "deploy_worker", self.anchor, target)
        record["history"][-1]["outcome"] = "CONFIRMED"
        with self.assertRaisesRegex(pair.Blocked, "durable_intent_mismatch"):
            pair.require_journal_intent(api, maintenance_id, "freeze", self.anchor, target)
        record["history"][-1]["outcome"] = "INTENT"
        bundle["issued_at_ms"], bundle["expires_at_ms"] = now-60000, now-1000
        record["evidence_hash"] = pair.fingerprint(bundle)
        with self.assertRaisesRegex(pair.Blocked, "journal_window_closed"):
            pair.require_journal_intent(api, maintenance_id, "freeze", self.anchor, target)
        # An expired forward approval still permits the same admitted session
        # to compensate and verify, never a new freeze or forward deployment.
        frozen = [{"step": "freeze", "outcome": "INTENT"},
                  {"step": "freeze", "outcome": "CONFIRMED"}]
        worker = [{"step": "deploy_worker", "outcome": "INTENT"},
                  {"step": "deploy_worker", "outcome": "CONFIRMED"}]
        gateway = [{"step": "deploy_gateway", "outcome": "INTENT"},
                   {"step": "deploy_gateway", "outcome": "CONFIRMED"}]
        def intent(step, prior):
            record["history"] = prior + [{"step": step, "outcome": "INTENT"}]
            pair.require_journal_intent(api, maintenance_id, step, self.anchor, target)

        for step in ("freeze", "deploy_worker", "deploy_gateway"):
            with self.subTest(step=step), self.assertRaisesRegex(pair.Blocked, "journal_window_closed"):
                intent(step, frozen)
        for step in ("rollback_gateway", "rollback_worker", "verify_previous"):
            with self.subTest(step=step):
                intent(step, frozen + worker)
                with self.assertRaisesRegex(pair.Blocked, "journal_window_closed"):
                    intent(step, [{"step": "freeze", "outcome": "UNKNOWN"}])
        with self.assertRaisesRegex(pair.Blocked, "journal_window_closed"):
            intent("verify_next", frozen + worker)
        intent("verify_next", frozen + worker + gateway)
        with self.assertRaisesRegex(pair.Blocked, "journal_window_closed"):
            intent("release", frozen + worker + gateway)
        for verified in ("verify_next", "verify_previous"):
            intent("release", frozen + worker + gateway +
                   [{"step": verified, "outcome": "INTENT"},
                    {"step": verified, "outcome": "CONFIRMED"}])
        # A wrong target or a terminal record remains denied after expiry.
        with self.assertRaisesRegex(pair.Blocked, "durable_intent_mismatch"):
            pair.require_journal_intent(api, maintenance_id, "release", self.anchor,
                                        {**target, "catalog": "wrong"})
        record["state"] = "ROLLED_BACK"
        with self.assertRaisesRegex(pair.Blocked, "durable_intent_mismatch"):
            intent("rollback_gateway", frozen)
        self.assertEqual(self.api.calls, [])

    def test_missing_lease_ownership_blocks_before_cli(self):
        self.p.freeze()
        self.p.guard.assert_owned.side_effect = pair.Blocked("not-owned")
        with self.assertRaises(pair.Blocked):
            self.p.deploy_worker()
        self.assertEqual(self.api.calls, [])
        for rollback in (self.p.rollback_gateway, self.p.rollback_worker):
            with self.assertRaises(pair.Blocked):
                rollback()
        self.assertEqual(self.api.calls, [])


if __name__ == "__main__":
    unittest.main()
