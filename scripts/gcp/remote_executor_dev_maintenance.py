"""Operator-side #589 DEV maintenance boundary. No runtime credentials or CLI mutation."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from cloud_run_v2_read import primary_revision

PROJECT = "jscc-dev"
REGION = "europe-west1"
RUN_ROOT = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}"
BUCKET = "jscc-dev-ops-state"
BUCKET_METADATA = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}"
LIFECYCLE_FILE = Path(__file__).with_name("remote_executor_dev_lifecycle.json")
STORAGE = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
UPLOAD = f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o"
LEASE = "leases/diagnostics.json"
JOBS = ("jscc-search-dev", "jscc-diagnostics-dev")
TERMINAL = {"SUCCEEDED", "FAILED", "REJECTED"}
MAX_PAGES_PER_COLLECTION = 20
# Compatible with the existing gateway's numeric expiry comparison.
# Explicit release only; bucket lifecycle still limits retention.
MAINTENANCE_EXPIRY = 9007199254740991


class Blocked(RuntimeError):
    pass


def require(ok, reason):
    if not ok:
        raise Blocked(reason)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def now_ms():
    return int(time.time() * 1000)


class OperatorAPI:
    """Only fixed DEV reads and CAS writes to the existing diagnostics lease."""

    def __init__(self, token=None):
        self.remote = token is None and os.environ.get("CLOUD_RUN_JOB") == "jscc-ops-operator-dev"
        self.token = token if self.remote or token else subprocess.check_output(
            ["gcloud", "auth", "print-access-token"], text=True, timeout=30
        ).strip()
        if not self.remote:
            require(bool(self.token), "missing_operator_token")

    def access_token(self):
        if not self.remote:
            return self.token
        # Remote Job uses the attached isolated identity, never a local user key.
        url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
        req = Request(url, headers={"Metadata-Flavor": "Google"})
        with urlopen(req, timeout=5) as response:
            token = json.load(response).get("access_token")
        require(isinstance(token, str) and bool(token), "missing_operator_token")
        return token

    def request(self, url, method="GET", body=None, missing_ok=False):
        headers = {"Authorization": "Bearer " + self.access_token(), "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=None if body is None else json.dumps(body).encode(),
                          headers=headers, method=method)
        try:
            with urlopen(request, timeout=20) as response:
                value = json.load(response)
                require(isinstance(value, dict) and "error" not in value, "invalid_api_response")
                return value, response.headers
        except HTTPError as error:
            if missing_ok and error.code == 404:
                return None, {}
            raise Blocked(f"api_http_{error.code}") from None

    def pages(self, url, field, **params):
        seen = set()
        size_key = "maxResults" if url == STORAGE else "pageSize"
        for _ in range(MAX_PAGES_PER_COLLECTION):
            data, _ = self.request(url + "?" + urlencode({size_key: 100, **params}))
            values = data.get(field, [])
            require(isinstance(values, list), "invalid_page")
            yield from values
            token = data.get("nextPageToken")
            if not token:
                return
            require(isinstance(token, str) and token not in seen, "invalid_page_token")
            seen.add(token)
            params["pageToken"] = token
        raise Blocked("page_limit_exceeded")

    def bucket_metadata(self):
        return self.request(BUCKET_METADATA + "?fields=name,location,lifecycle")[0]

    def service(self):
        return self.request(RUN_ROOT + "/services/jscc-command-api-dev")[0]

    def job(self, name):
        require(name in JOBS, "job_denied")
        return self.request(RUN_ROOT + "/jobs/" + name)[0]

    def executions(self, name):
        require(name in JOBS, "job_denied")
        return self.pages(RUN_ROOT + "/jobs/" + name + "/executions", "executions")

    def objects(self, prefix):
        require(prefix in ("operations/", "dispatch/"), "prefix_denied")
        for item in self.pages(STORAGE, "items", prefix=prefix):
            name = item.get("name", "")
            require(isinstance(name, str) and name.startswith(prefix) and name.endswith(".json"),
                    "unexpected_object")
            value, _ = self.request(STORAGE + "/" + quote(name, safe="") + "?alt=media")
            yield name, value

    def read_lease(self):
        data, headers = self.request(STORAGE + "/" + quote(LEASE, safe="") + "?alt=media",
                                     missing_ok=True)
        if data is None:
            return None, "0"
        generation = headers.get("x-goog-generation")
        require(isinstance(generation, str) and generation.isdigit() and int(generation) > 0,
                "lease_generation_missing")
        return data, generation

    def replace_lease(self, value, generation):
        require(isinstance(generation, str) and generation.isdigit(), "invalid_generation")
        params = urlencode({"uploadType": "media", "name": LEASE, "ifGenerationMatch": generation})
        response, _ = self.request(UPLOAD + "?" + params, method="POST", body=value)
        new_generation = response.get("generation")
        require(isinstance(new_generation, str) and new_generation.isdigit()
                and int(new_generation) > 0, "lease_write_outcome_uncertain")
        return new_generation


def protected_snapshot(api):
    service = api.service()
    job = api.job("jscc-search-dev")
    for resource, name in ((service, "services/jscc-command-api-dev"),
                           (job, "jobs/jscc-search-dev")):
        require(resource.get("name") == f"projects/{PROJECT}/locations/{REGION}/{name}",
                "protected_resource_mismatch")
        require(resource.get("reconciling", False) is False and isinstance(resource.get("template"), dict),
                "protected_resource_reconciling_or_invalid")
    return fingerprint({"service_revision": primary_revision(service),
                        "service_template": service["template"],
                        "service_traffic": service["trafficStatuses"],
                        "job_template": job["template"]})


def assert_drained(api):
    for name in JOBS:
        job = api.job(name)
        require(job.get("name") == f"projects/{PROJECT}/locations/{REGION}/jobs/{name}"
                and job.get("reconciling", False) is False, "job_reconciling_or_invalid")
        for execution in api.executions(name):
            require(isinstance(execution, dict) and isinstance(execution.get("completionTime"), str)
                    and bool(execution["completionTime"]), "unfinished_execution")
    operations = {}
    for name, record in api.objects("operations/"):
        operation_id = record.get("operation_id")
        require(isinstance(operation_id, str) and name == f"operations/{operation_id}.json"
                and operation_id not in operations, "invalid_operation_record")
        require(record.get("operation_state") in TERMINAL and record.get("finished_at"),
                "unresolved_operation")
        operations[operation_id] = record
    for name, dispatch in api.objects("dispatch/"):
        execution = dispatch.get("execution_name")
        record = operations.get(dispatch.get("operation_id"))
        require(isinstance(execution, str) and name == f"dispatch/{execution}.json"
                and record is not None and record.get("execution_name") == execution,
                "unresolved_dispatch")


def assert_available(record):
    if record is None:
        return
    # Do not overwrite even an expired ACTIVE lease: recovery is explicit.
    require(record.get("state") == "RELEASED" and isinstance(record.get("operation_id"), str)
            and isinstance(record.get("expires_at_ms"), (int, float))
            and record["expires_at_ms"] <= now_ms(), "lease_active_or_ambiguous")


def assert_scoped_lifecycle(api):
    bucket = api.bucket_metadata()
    require(bucket.get("name") == BUCKET and bucket.get("location") == "EUROPE-WEST1",
            "ops_bucket_identity_mismatch")
    expected = json.loads(LIFECYCLE_FILE.read_text(encoding="utf-8"))
    actual = bucket.get("lifecycle")
    # GCS may return the allowlist in a different order. No other rule or
    # condition is accepted; unknown or unconditional deletes fail closed.
    require(isinstance(actual, dict) and set(actual) == {"rule"} and
            isinstance(actual["rule"], list) and len(actual["rule"]) == 1,
            "ops_lifecycle_not_scoped")
    rule = actual["rule"][0]
    require(isinstance(rule, dict) and set(rule) == {"action", "condition"} and
            rule["action"] == {"type": "Delete"}, "ops_lifecycle_not_scoped")
    condition = rule["condition"]
    prefixes = condition.get("matchesPrefix") if isinstance(condition, dict) else None
    require(isinstance(prefixes, list) and all(isinstance(p, str) for p in prefixes),
            "ops_lifecycle_not_scoped")
    normalized = {"rule": [{"action": rule["action"], "condition": {
        **condition, "matchesPrefix": sorted(prefixes)}}]}
    expected["rule"][0]["condition"]["matchesPrefix"].sort()
    require(normalized == expected, "ops_lifecycle_not_scoped")


class MaintenanceGuard:
    """Adapter for existing R6 freeze/unfreeze callbacks; no deploy authority."""

    def __init__(self, api):
        self.api = api
        self.operation_id = None
        self.generation = None
        self.baseline = None

    def inspect(self):
        assert_scoped_lifecycle(self.api)
        before = protected_snapshot(self.api)
        assert_drained(self.api)
        record, _ = self.api.read_lease()
        assert_available(record)
        require(protected_snapshot(self.api) == before, "protected_state_drift")
        return before

    def freeze(self, expected_baseline, maintenance_id=None):
        require(self.operation_id is None, "guard_already_used")
        require(self.inspect() == expected_baseline, "protected_state_drift")
        record, generation = self.api.read_lease()
        assert_available(record)
        if maintenance_id is not None:
            require(isinstance(maintenance_id, str) and
                    re.fullmatch(r"maintenance-[a-f0-9]{32,64}", maintenance_id),
                    "invalid_maintenance_id")
        self.operation_id = maintenance_id or "maintenance-" + uuid.uuid4().hex
        self.baseline = expected_baseline
        value = {"operation_id": self.operation_id, "state": "ACTIVE",
                 "acquired_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                 "expires_at_ms": MAINTENANCE_EXPIRY}
        # Uncertain CAS or post-acquisition failure must not trigger an unfreeze.
        self.generation = self.api.replace_lease(value, generation)
        self.assert_owned()
        assert_drained(self.api)
        require(protected_snapshot(self.api) == self.baseline, "protected_state_drift")
        self.assert_owned()

    def assert_owned(self):
        record, generation = self.api.read_lease()
        require(self.operation_id is not None and self.generation is not None
                and generation == self.generation and record is not None
                and record.get("operation_id") == self.operation_id
                and record.get("state") == "ACTIVE"
                and record.get("expires_at_ms") == MAINTENANCE_EXPIRY,
                "maintenance_lease_not_owned")
        return record

    def release_after_verified(self, verify_pair):
        record = self.assert_owned()
        assert_drained(self.api)
        require(protected_snapshot(self.api) == self.baseline, "protected_state_drift")
        # Trusted R6 operator callback must verify actual serving pair or restored pair.
        require(verify_pair() is True, "pair_verification_required")
        self.assert_owned()
        require(protected_snapshot(self.api) == self.baseline, "protected_state_drift")
        self.api.replace_lease({**record, "state": "RELEASED",
                                "released_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "expires_at_ms": now_ms()}, self.generation)
        self.generation = None


if __name__ == "__main__":
    # Deliberately read-only until an independently reviewed R6 live adapter
    # binds approval, cost, actual pair verification and recovery.
    try:
        print("RETRIEVE_BASELINE=" + MaintenanceGuard(OperatorAPI()).inspect())
        print("OPS_DRAIN_PREFLIGHT=PASS")
    except Blocked as error:
        print("OPS_DRAIN_PREFLIGHT=BLOCKED reason=" + str(error))
        raise SystemExit(2)
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, TypeError, AttributeError):
        print("OPS_DRAIN_PREFLIGHT=BLOCKED reason=inspection_failed")
        raise SystemExit(2)
