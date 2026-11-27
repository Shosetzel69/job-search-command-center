"""Offline contracts for the operator-side DEV maintenance guard."""
import copy
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "gcp"))
import remote_executor_dev_maintenance as guard


class FakeAPI:
    def __init__(self):
        self.lifecycle = json.loads(guard.LIFECYCLE_FILE.read_text(encoding='utf-8'))
        self.lease = None
        self.generation = "0"
        self.active = {name: [] for name in guard.JOBS}
        self.records = {"operations/": [], "dispatch/": []}
        self.writes = []
        self.job_template = {"template": {"containers": [{"image": "search"}]}}
        self.drift_after_cas = False

    def bucket_metadata(self):
        return {'name': guard.BUCKET, 'location': 'EUROPE-WEST1',
                'lifecycle': copy.deepcopy(self.lifecycle)}

    def service(self):
        return {"name": "projects/jscc-dev/locations/europe-west1/services/jscc-command-api-dev",
                "uri": "https://jscc-command-api-dev-example.run.app",
                "latestReadyRevision": "jscc-command-api-dev-00123-abc",
                "trafficStatuses": [{"revision": "jscc-command-api-dev-00123-abc", "percent": 100}],
                "template": {"containers": [{"image": "service"}]}}

    def job(self, name):
        return {"name": f"projects/jscc-dev/locations/europe-west1/jobs/{name}",
                "template": copy.deepcopy(self.job_template)}

    def executions(self, name):
        yield from self.active[name]

    def objects(self, prefix):
        yield from self.records[prefix]

    def read_lease(self):
        return copy.deepcopy(self.lease), self.generation

    def replace_lease(self, value, generation):
        if generation != self.generation:
            raise guard.Blocked("api_http_412")
        self.generation = str(int(self.generation) + 1)
        self.lease = copy.deepcopy(value)
        self.writes.append(copy.deepcopy(value))
        if self.drift_after_cas:
            self.job_template["changed"] = True
        return self.generation


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()
        self.guard = guard.MaintenanceGuard(self.api)

    def test_read_only_and_owned_release(self):
        baseline = self.guard.inspect()
        self.assertEqual(self.api.writes, [])
        self.guard.freeze(baseline)
        self.assertEqual(self.api.lease["state"], "ACTIVE")
        self.assertEqual(self.api.lease["expires_at_ms"], guard.MAINTENANCE_EXPIRY)
        self.guard.release_after_verified(lambda: True)
        self.assertEqual([x["state"] for x in self.api.writes], ["ACTIVE", "RELEASED"])
        self.assertEqual(self.api.writes[0]["operation_id"], self.api.writes[1]["operation_id"])

    def test_scoped_policy_matches_only_known_transient_objects(self):
        rule = self.api.lifecycle["rule"][0]
        self.assertEqual(self.api.lifecycle, {"rule": [{
            "action": {"type": "Delete"},
            "condition": {"age": 14, "matchesPrefix": [
                "auth/codes/", "auth/tokens/", "auth/upstream/", "limits/"]}}]})
        prefixes = tuple(rule["condition"]["matchesPrefix"])
        for name in ("auth/codes/a.json", "auth/tokens/a.json",
                     "auth/upstream/a.json", "limits/2026-11-27.json"):
            self.assertTrue(name.startswith(prefixes))
        for name in ("leases/diagnostics.json", "control/v1/deployments/a.json",
                     "control/v1/builds/a.json", "operations/a.json",
                     "dispatch/a.json", "idempotency/a.json", "results/a.json",
                     "public/a.json", "auth/unknown/a.json", "unknown/a.json"):
            self.assertFalse(name.startswith(prefixes))

    def test_unsafe_lifecycle_blocks_inspection_and_freeze(self):
        baseline = self.guard.inspect()
        expected = copy.deepcopy(self.api.lifecycle)
        variants = [None, {"rule": []},
                    {"rule": [{"action": {"type": "Delete"}, "condition": {"age": 14}}]}]
        broad = copy.deepcopy(expected)
        broad["rule"][0]["condition"]["matchesPrefix"].append("control/")
        variants.append(broad)
        extra = copy.deepcopy(expected)
        extra["rule"].append({"action": {"type": "Delete"}, "condition": {"age": 99}})
        variants.append(extra)
        for policy in variants:
            self.api.lifecycle = policy
            with self.subTest(policy=policy), self.assertRaisesRegex(
                    guard.Blocked, "ops_lifecycle_not_scoped"):
                self.guard.freeze(baseline)
            self.assertEqual(self.api.writes, [])
        self.api.lifecycle = expected
        self.api.lifecycle["rule"][0]["condition"]["matchesPrefix"].reverse()
        self.assertEqual(self.guard.inspect(), baseline)

    def test_policy_drift_does_not_prevent_owned_verified_release(self):
        self.guard.freeze(self.guard.inspect())
        self.api.lifecycle = {"rule": [{"action": {"type": "Delete"},
                                       "condition": {"age": 14}}]}
        self.guard.release_after_verified(lambda: True)
        self.assertEqual(self.api.lease["state"], "RELEASED")

    def test_bucket_metadata_request_is_fixed_read_only(self):
        from unittest.mock import Mock
        api = guard.OperatorAPI(token="fixture")
        api.request = Mock(return_value=({"name": guard.BUCKET}, {}))
        self.assertEqual(api.bucket_metadata(), {"name": guard.BUCKET})
        api.request.assert_called_once_with(
            guard.BUCKET_METADATA + "?fields=name,location,lifecycle")

    def test_active_or_expired_active_lease_never_overwritten(self):
        for expiry in (guard.now_ms() - 1, guard.now_ms() + 100000):
            self.api.lease = {"state": "ACTIVE", "operation_id": "op-other", "expires_at_ms": expiry}
            with self.assertRaisesRegex(guard.Blocked, "lease_active_or_ambiguous"):
                self.guard.inspect()
        self.assertEqual(self.api.writes, [])

    def test_unfinished_execution_on_either_job_blocks(self):
        for name in guard.JOBS:
            self.api.active[name] = [{"completionTime": "2026-11-26T00:00:00Z"}, {}]
            with self.assertRaisesRegex(guard.Blocked, "unfinished_execution"):
                self.guard.inspect()
            self.api.active[name] = []
        self.assertEqual(self.api.writes, [])

    def test_unresolved_operations_and_dispatches_block(self):
        op = {"operation_id": "op-test", "operation_state": "RUNNING"}
        self.api.records["operations/"] = [("operations/op-test.json", op)]
        with self.assertRaisesRegex(guard.Blocked, "unresolved_operation"):
            self.guard.inspect()
        op.update(operation_state="FAILED", finished_at="2026-11-26T00:00:00Z")
        self.api.records["dispatch/"] = [("dispatch/ex-test.json", {"operation_id": "op-test",
                                                                    "execution_name": "ex-test"})]
        with self.assertRaisesRegex(guard.Blocked, "unresolved_dispatch"):
            self.guard.inspect()
        op["execution_name"] = "ex-test"
        self.guard.inspect()
        self.assertEqual(self.api.writes, [])

    def test_cas_conflict_does_not_release_or_retry(self):
        baseline = self.guard.inspect()
        def conflict(*args):
            raise guard.Blocked("api_http_412")
        self.api.replace_lease = conflict
        with self.assertRaisesRegex(guard.Blocked, "api_http_412"):
            self.guard.freeze(baseline)
        with self.assertRaisesRegex(guard.Blocked, "maintenance_lease_not_owned"):
            self.guard.release_after_verified(lambda: True)
        self.assertEqual(self.api.writes, [])

    def test_protected_drift_before_and_after_cas(self):
        baseline = self.guard.inspect()
        self.api.job_template["changed"] = True
        with self.assertRaisesRegex(guard.Blocked, "protected_state_drift"):
            self.guard.freeze(baseline)
        self.assertEqual(self.api.writes, [])
        baseline = self.guard.inspect()
        self.api.drift_after_cas = True
        self.api.job_template.pop("changed")
        baseline = self.guard.inspect()
        with self.assertRaisesRegex(guard.Blocked, "protected_state_drift"):
            self.guard.freeze(baseline)
        self.assertEqual(self.api.lease["state"], "ACTIVE")

    def test_release_requires_verification_and_generation(self):
        self.guard.freeze(self.guard.inspect())
        with self.assertRaisesRegex(guard.Blocked, "pair_verification_required"):
            self.guard.release_after_verified(lambda: False)
        self.api.generation = "999"
        with self.assertRaisesRegex(guard.Blocked, "maintenance_lease_not_owned"):
            self.guard.release_after_verified(lambda: True)
        self.assertEqual(len(self.api.writes), 1)

    def test_pagination_consumes_later_pages_and_rejects_loop(self):
        api = guard.OperatorAPI(token="fixture")
        responses = iter([({"executions": [{"completionTime": "done"}], "nextPageToken": "a"}, {}),
                          ({"executions": [{}]}, {})])
        api.request = lambda *args, **kwargs: next(responses)
        self.assertEqual(list(api.executions("jscc-search-dev")), [{"completionTime": "done"}, {}])
        api.request = lambda *args, **kwargs: ({"nextPageToken": "a"}, {})
        with self.assertRaisesRegex(guard.Blocked, "invalid_page_token"):
            list(api.executions("jscc-search-dev"))


    def test_api_pagination_parameters_are_endpoint_specific(self):
        from unittest.mock import Mock
        from urllib.parse import parse_qs, urlsplit

        api = guard.OperatorAPI(token="fixture")
        api.request = Mock(side_effect=[
            ({"items": [], "nextPageToken": "next"}, {}),
            ({"items": []}, {}),
            ({"executions": []}, {}),
        ])
        self.assertEqual(list(api.objects("operations/")), [])
        self.assertEqual(list(api.executions("jscc-search-dev")), [])
        queries = [parse_qs(urlsplit(call.args[0]).query) for call in api.request.call_args_list]
        self.assertEqual(queries, [
            {"maxResults": ["100"], "prefix": ["operations/"]},
            {"maxResults": ["100"], "prefix": ["operations/"], "pageToken": ["next"]},
            {"pageSize": ["100"]},
        ])

    def test_http_lease_absence_and_create_only_generation(self):
        from unittest.mock import Mock
        from urllib.parse import parse_qs, urlsplit

        api = guard.OperatorAPI(token="fixture")
        value = {"state": "ACTIVE", "operation_id": "maintenance-fixture"}
        api.request = Mock(side_effect=[(None, {}), ({"generation": "123"}, {})])
        self.assertEqual(api.read_lease(), (None, "0"))
        self.assertEqual(api.replace_lease(value, "0"), "123")
        read, write = api.request.call_args_list
        self.assertEqual(read.args[0], guard.STORAGE + "/leases%2Fdiagnostics.json?alt=media")
        self.assertEqual(read.kwargs, {"missing_ok": True})
        self.assertEqual(urlsplit(write.args[0])._replace(query="").geturl(), guard.UPLOAD)
        self.assertEqual(parse_qs(urlsplit(write.args[0]).query),
                         {"uploadType": ["media"], "name": [guard.LEASE], "ifGenerationMatch": ["0"]})
        self.assertEqual(write.kwargs, {"method": "POST", "body": value})

    def test_http_lease_header_and_generation_matched_replacement(self):
        from unittest.mock import Mock
        from urllib.parse import parse_qs, urlsplit

        api = guard.OperatorAPI(token="fixture")
        value = {"state": "RELEASED", "operation_id": "maintenance-fixture"}
        api.request = Mock(side_effect=[(value, {"x-goog-generation": "456"}),
                                        ({"generation": "789"}, {})])
        self.assertEqual(api.read_lease(), (value, "456"))
        self.assertEqual(api.replace_lease(value, "456"), "789")
        self.assertEqual(parse_qs(urlsplit(api.request.call_args.args[0]).query)["ifGenerationMatch"],
                         ["456"])
        for headers in ({}, {"x-goog-generation": "0"}, {"x-goog-generation": "bad"}):
            api.request = Mock(return_value=(value, headers))
            with self.assertRaisesRegex(guard.Blocked, "lease_generation_missing"):
                api.read_lease()

    def test_http_lease_uncertain_write_response_and_cas_conflict(self):
        from unittest.mock import Mock

        api = guard.OperatorAPI(token="fixture")
        value = {"state": "ACTIVE", "operation_id": "maintenance-fixture"}
        for response in ({}, {"generation": 123}, {"generation": "0"}, {"generation": "bad"}):
            api.request = Mock(return_value=(response, {}))
            with self.assertRaisesRegex(guard.Blocked, "lease_write_outcome_uncertain"):
                api.replace_lease(value, "456")
            api.request.assert_called_once()
        api.request = Mock(side_effect=guard.Blocked("api_http_412"))
        with self.assertRaisesRegex(guard.Blocked, "api_http_412"):
            api.replace_lease(value, "456")
        api.request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
