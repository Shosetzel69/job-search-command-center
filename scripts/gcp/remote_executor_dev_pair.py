"""#589 operator-side R6 transport. Not packaged in the gateway or worker."""
import copy
import json
import re
import subprocess
import sys
from urllib.request import urlopen

from cloud_run_v2_read import primary_revision, revision_image
from remote_executor_dev_maintenance import (
    Blocked, MaintenanceGuard, OperatorAPI, PROJECT, REGION, RUN_ROOT,
    assert_drained, protected_snapshot, require, fingerprint, MAINTENANCE_EXPIRY,
)

GATEWAY = "jscc-ops-gateway-dev"
WORKER = "jscc-diagnostics-dev"
DEPLOYER = f"jscc-ops-deployer-dev@{PROJECT}.iam.gserviceaccount.com"
ROOT = "europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/"
KEYS = ("SOURCE_SHA", "GATEWAY_IMAGE_DIGEST", "WORKER_IMAGE_DIGEST")
SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
REV = re.compile(GATEWAY + r"-[a-z0-9-]{1,40}")
URIS = {
    "https://jscc-ops-gateway-dev-828902654738.europe-west1.run.app",
    "https://jscc-ops-gateway-dev-booykgjo4a-ew.a.run.app",
}


def binding(source, gateway, worker):
    require(isinstance(source, str) and SHA.fullmatch(source), "invalid_source")
    require(all(isinstance(d, str) and DIGEST.fullmatch(d) for d in (gateway, worker)),
            "invalid_digest")
    return dict(zip(KEYS, (source, gateway, worker)))


def image(kind, values):
    return ROOT + ("jscc-ops-gateway@" + values[KEYS[1]] if kind == "gateway"
                   else "jscc-diagnostics@" + values[KEYS[2]])


def container(template):
    task = template.get("template", template)
    values = task.get("containers")
    require(isinstance(values, list) and len(values) == 1, "container_layout_denied")
    return values[0]


def metadata(template):
    env = container(template).get("env", [])
    values = {}
    for key in KEYS:
        rows = [row for row in env if row.get("name") == key]
        require(len(rows) == 1 and "valueSource" not in rows[0], "binding_missing_or_secret")
        values[key] = rows[0].get("value")
    return binding(*(values[key] for key in KEYS))


def normalized(template):
    result = copy.deepcopy(template)
    # Only revision identity and API client metadata may change on update.
    for key in ("revision", "client", "clientVersion"):
        result.pop(key, None)
    env = container(result).get("env", [])
    require(len({row.get("name") for row in env}) == len(env), "duplicate_env")
    container(result)["env"] = sorted(env, key=lambda row: row["name"])
    if "template" in result:
        for key in ("client", "clientVersion"):
            result["template"].pop(key, None)
    # #520 evidence 7165263147: gcloud rotates only this nonce label.
    # Cloud Run v2 exposes labels on the revision/execution and task templates.
    for level in (result, result.get("template", {})):
        if "labels" in level:
            labels = level["labels"]
            require(isinstance(labels, dict), "invalid_template_labels")
            labels.pop("client.knative.dev/nonce", None)
            if not labels:
                level.pop("labels")
    return result


def expected_template(template, kind, values):
    result = copy.deepcopy(template)
    c = container(result)
    c["image"] = image(kind, values)
    metadata(result)
    for row in c["env"]:
        if row["name"] in KEYS:
            row["value"] = values[row["name"]]
    return result


def policy(resource, kind):
    # Explicit top-level configuration fields outside the revision/execution template.
    common = ("description", "labels", "annotations", "launchStage", "binaryAuthorization")
    service = ("ingress", "customAudiences", "scaling", "invokerIamDisabled",
               "defaultUriDisabled", "multiRegionSettings", "iapEnabled", "sshEnabled")
    keys = common + service if kind == "gateway" else common
    return {key: copy.deepcopy(resource.get(key)) for key in keys}


def tags(service):
    rows = service.get("trafficStatuses", [])
    result = {}
    for row in rows:
        if row.get("tag"):
            require(row.get("percent", 0) == 0 and row["tag"] not in result,
                    "tag_traffic_or_duplicate")
            revision = row.get("revision", "").rsplit("/", 1)[-1]
            require(REV.fullmatch(revision), "invalid_tag_revision")
            result[row["tag"]] = revision
    return result


def ready(resource, name):
    require(resource.get("name") == f"projects/{PROJECT}/locations/{REGION}/{name}"
            and resource.get("reconciling", False) is False
            and resource.get("terminalCondition", {}).get("state") == "CONDITION_SUCCEEDED"
            and resource.get("generation") == resource.get("observedGeneration")
            and bool(resource.get("generation")),
            "resource_not_reconciled")


class PairOperator:
    def __init__(self, api, runner=subprocess.run, health_reader=None):
        self.api = api
        self.guard = MaintenanceGuard(api)
        self.runner = runner
        self.health_reader = health_reader or self.health
        self.old = None
        self.new = None
        self.candidate = None
        self.uncertain = False
        self.release_attempted = False
        self.verified = None
        self.admitted = False

    def gateway(self):
        value = self.api.request(RUN_ROOT + "/services/" + GATEWAY)[0]
        ready(value, "services/" + GATEWAY)
        return value

    def revision(self, revision):
        require(isinstance(revision, str) and REV.fullmatch(revision), "invalid_revision")
        data = self.api.request(RUN_ROOT + "/services/" + GATEWAY + "/revisions/" + revision)[0]
        require(data.get("name") == f"projects/{PROJECT}/locations/{REGION}/services/{GATEWAY}/revisions/{revision}",
                "revision_identity_mismatch")
        require(any(c.get("type") == "Ready" and c.get("state") == "CONDITION_SUCCEEDED"
                    for c in data.get("conditions", [])), "revision_not_ready")
        return data

    def worker_resource(self):
        value = self.api.job(WORKER)
        ready(value, "jobs/" + WORKER)
        return value

    def worker(self):
        return self.worker_resource()["template"]

    def health(self, uri):
        require(uri in URIS, "gateway_uri_denied")
        with urlopen(uri + "/health", timeout=20) as response:
            require(response.geturl() == uri + "/health", "health_redirect_denied")
            data = json.load(response)
        require(data.get("ok") is True and data.get("project") == PROJECT
                and data.get("component") == GATEWAY and data.get("privileged") is True,
                "gateway_health_invalid")
        return data.get("catalog_version")

    def verify_revision(self, revision, values):
        data = self.revision(revision)
        require(data.get("reconciling", False) is False
                and data.get("serviceAccount") == f"{GATEWAY}@{PROJECT}.iam.gserviceaccount.com"
                and revision_image(data) == image("gateway", values) and metadata(data) == values,
                "effective_revision_binding_mismatch")

    def capture(self, request):
        require(self.old is None, "session_already_prepared")
        self.new = binding(request["source_sha"], request["gateway_digest"], request["worker_digest"])
        self.new_catalog = request["catalog"]
        self.old_catalog = request["previous_catalog"]
        require(all(isinstance(x, str) and re.fullmatch(r"[a-z0-9-]{1,80}", x)
                    for x in (self.new_catalog, self.old_catalog)), "invalid_catalog")
        svc, worker = self.gateway(), self.worker_resource()
        job = worker["template"]
        require(job.get("taskCount") == 1, "unexpected_worker_task_count")
        revision = primary_revision(svc)
        values = metadata(svc["template"])
        require(metadata(job) == values and container(job)["image"] == image("worker", values)
                and container(svc["template"])["image"] == image("gateway", values),
                "current_pair_binding_mismatch")
        require(svc["template"].get("serviceAccount") == f"{GATEWAY}@{PROJECT}.iam.gserviceaccount.com"
                and job["template"].get("serviceAccount") == f"{WORKER}@{PROJECT}.iam.gserviceaccount.com",
                "runtime_identity_mismatch")
        self.verify_revision(revision, values)
        # Rollout starts only from explicit revision-pinned canonical traffic.
        traffic = svc.get("traffic", [])
        positive = [row for row in traffic if row.get("percent", 0) > 0]
        require(len(positive) == 1 and positive[0].get("percent") == 100
                and positive[0].get("type") == "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION"
                and positive[0].get("revision", "").rsplit("/", 1)[-1] == revision
                and not positive[0].get("tag"), "unpinned_canonical_traffic")
        require(svc.get("uri") in URIS, "gateway_uri_denied")
        self.old = {"values": values, "gateway": svc["template"], "worker": job,
                    "revision": revision, "tags": tags(svc), "uri": svc["uri"],
                    "gateway_policy": policy(svc, "gateway"), "worker_policy": policy(worker, "worker")}
        self.protected_baseline = protected_snapshot(self.api)
        return {"source_sha": values[KEYS[0]], "gateway_digest": values[KEYS[1]],
                "worker_digest": values[KEYS[2]], "revision": revision,
                "tags": self.old["tags"], "uri": self.old["uri"],
                "gateway_template_hash": fingerprint(normalized(self.old["gateway"])),
                "worker_template_hash": fingerprint(normalized(self.old["worker"])),
                "gateway_policy_hash": fingerprint(self.old["gateway_policy"]),
                "worker_policy_hash": fingerprint(self.old["worker_policy"]),
                "next_gateway_template_hash": fingerprint(normalized(expected_template(
                    self.old["gateway"], "gateway", self.new))),
                "next_worker_template_hash": fingerprint(normalized(expected_template(
                    self.old["worker"], "worker", self.new))),
                "protected_baseline": self.protected_baseline}

    def observe_recovery(self, maintenance_id):
        # This path never reconstructs mutation authority from a stale process.
        require(isinstance(maintenance_id, str) and
                re.fullmatch(r"maintenance-[a-f0-9]{64}", maintenance_id),
                "invalid_maintenance_id")
        svc, worker = self.gateway(), self.worker_resource()
        revision = primary_revision(svc)
        rev = self.revision(revision)
        def observed_binding(template, kind):
            values = metadata(template)
            require(container(template)["image"] == image(kind, values), "observed_image_binding_mismatch")
            return dict(zip(("source_sha", "gateway_digest", "worker_digest"),
                            (values[k] for k in KEYS)))
        record, generation = self.api.read_lease()
        lease_state = "ABSENT" if record is None else "OTHER"
        lease_generation = None
        if record is not None and record.get("operation_id") == maintenance_id:
            lease_generation = generation
            lease_state = ("OWNED_ACTIVE" if record.get("state") == "ACTIVE" and
                           record.get("expires_at_ms") == MAINTENANCE_EXPIRY else
                           "OWNED_RELEASED" if record.get("state") == "RELEASED" else "AMBIGUOUS")
        return {"gateway_binding": observed_binding(svc["template"], "gateway"),
                "worker_binding": observed_binding(worker["template"], "worker"),
                "effective_binding": observed_binding(rev, "gateway"),
                "gateway_template_hash": fingerprint(normalized(svc["template"])),
                "worker_template_hash": fingerprint(normalized(worker["template"])),
                "gateway_policy_hash": fingerprint(policy(svc, "gateway")),
                "worker_policy_hash": fingerprint(policy(worker, "worker")),
                "revision": revision, "tags": tags(svc), "uri": svc["uri"],
                "catalog": self.health_reader(svc["uri"]),
                "protected_baseline": protected_snapshot(self.api),
                "lease_state": lease_state, "lease_generation": lease_generation}

    def check_config(self, kind, values):
        resource = self.gateway() if kind == "gateway" else self.worker_resource()
        template = resource["template"]
        require(policy(resource, kind) == self.old[kind + "_policy"], "resource_policy_drift")
        require(normalized(template) == normalized(expected_template(self.old[kind], kind, values)),
                "template_drift")

    def verify(self, restored=False):
        values = self.old["values"] if restored else self.new
        revision = self.old["revision"] if restored else self.candidate
        self.check_config("gateway", values)
        self.check_config("worker", values)
        svc = self.gateway()
        require(primary_revision(svc) == revision and tags(svc) == self.old["tags"]
                and svc["uri"] == self.old["uri"], "effective_traffic_mismatch")
        self.verify_revision(revision, values)
        require(self.health_reader(self.old["uri"]) == (self.old_catalog if restored else self.new_catalog),
                "catalog_mismatch")
        return {"gateway_image": image("gateway", values), "worker_image": image("worker", values)}

    def freeze(self, maintenance_id=None):
        require(self.old is not None, "session_not_prepared")
        # Cost and owner proof are checked by R6 before this callback.
        self.verify(restored=True)
        baseline = self.guard.inspect()
        require(baseline == self.protected_baseline, "protected_state_drift_since_capture")
        self.guard.freeze(baseline, maintenance_id)
        self.verify(restored=True)
        self.admitted = True
        return True

    def before_mutation(self):
        require(self.admitted, "maintenance_not_admitted")
        require(not self.uncertain and not self.release_attempted, "mutation_outcome_uncertain")
        self.guard.assert_owned()
        assert_drained(self.api)
        require(protected_snapshot(self.api) == self.guard.baseline, "protected_state_drift")
        self.guard.assert_owned()

    def command(self, *args):
        self.before_mutation()
        self.verified = None
        try:
            # Fixed argv; never accept a shell command, secret value, or target from RPC.
            self.runner(["gcloud", "run", *args, "--project=" + PROJECT, "--region=" + REGION,
                         "--impersonate-service-account=" + DEPLOYER, "--quiet"],
                        check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError):
            # A timed-out/failed command may still be reconciling remotely.
            self.uncertain = True
            raise Blocked("cloud_run_mutation_outcome_uncertain") from None
        self.guard.assert_owned()

    def update(self, kind, values):
        resource = ("services", GATEWAY) if kind == "gateway" else ("jobs", WORKER)
        args = [resource[0], "update", resource[1], "--image=" + image(kind, values),
                "--update-env-vars=" + ",".join(k + "=" + values[k] for k in KEYS)]
        if kind == "gateway":
            args.append("--no-traffic")
        self.command(*args)
        self.check_config(kind, values)

    def route(self, revision):
        require(isinstance(revision, str) and REV.fullmatch(revision), "invalid_revision")
        self.command("services", "update-traffic", GATEWAY, "--to-revisions=" + revision + "=100")
        svc = self.gateway()
        require(primary_revision(svc) == revision and tags(svc) == self.old["tags"],
                "cutover_not_effective")

    def deploy_worker(self):
        self.check_config("gateway", self.old["values"])
        self.check_config("worker", self.old["values"])
        self.update("worker", self.new)
        return True

    def deploy_gateway(self):
        self.check_config("gateway", self.old["values"])
        self.check_config("worker", self.new)
        self.update("gateway", self.new)
        svc = self.gateway()
        require(primary_revision(svc) == self.old["revision"] and tags(svc) == self.old["tags"],
                "unexpected_staging_traffic")
        candidate = svc.get("latestReadyRevision", "").rsplit("/", 1)[-1]
        require(candidate != self.old["revision"] and
                candidate == svc.get("latestCreatedRevision", "").rsplit("/", 1)[-1],
                "candidate_revision_not_proven")
        self.verify_revision(candidate, self.new)
        self.candidate = candidate
        self.route(candidate)
        return True

    def rollback_gateway(self):
        self.before_mutation()
        current = self.gateway()["template"]
        require(normalized(current) in (
            normalized(expected_template(self.old["gateway"], "gateway", self.old["values"])),
            normalized(expected_template(self.old["gateway"], "gateway", self.new))), "unexpected_gateway_drift")
        if metadata(current) != self.old["values"]:
            self.update("gateway", self.old["values"])
        self.verify_revision(self.old["revision"], self.old["values"])
        self.route(self.old["revision"])
        return True

    def rollback_worker(self):
        self.before_mutation()
        current = self.worker()
        require(normalized(current) in (
            normalized(expected_template(self.old["worker"], "worker", self.old["values"])),
            normalized(expected_template(self.old["worker"], "worker", self.new))), "unexpected_worker_drift")
        if metadata(current) != self.old["values"]:
            self.update("worker", self.old["values"])
        return True

    def verify_pair(self, restored=False):
        self.before_mutation()
        result = self.verify(restored)
        self.verified = restored
        return result

    def release(self):
        require(self.verified is not None, "pair_not_verified")
        self.release_attempted = True
        restored = self.verified
        self.guard.release_after_verified(lambda: bool(self.verify(restored)))
        return True


def serve():
    """Private operator subprocess. No MCP tool or public endpoint."""
    operator = None
    methods = {"capture", "freeze", "deploy_worker", "deploy_gateway", "rollback_gateway",
               "rollback_worker", "verify_pair", "release", "observe_recovery"}
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request["method"]
            require(method in methods, "method_denied")
            if operator is None:
                require(method in ("capture", "observe_recovery"), "session_not_prepared")
                operator = PairOperator(OperatorAPI())
            args = request.get("args", [])
            require(isinstance(args, list) and
                    ((method == "capture" and len(args) == 1 and isinstance(args[0], dict)) or
                     (method == "verify_pair" and len(args) == 1 and type(args[0]) is bool) or
                     (method in ("freeze", "observe_recovery") and len(args) == 1 and
                      isinstance(args[0], str) and re.fullmatch(r"maintenance-[a-f0-9]{64}", args[0])) or
                     (method not in ("capture", "verify_pair", "freeze", "observe_recovery") and not args)),
                    "argument_denied")
            result = getattr(operator, method)(*args)
            reply = {"ok": True, "result": result}
        except Exception:
            # No raw exception, CLI output, environment, or credential crosses the RPC.
            reply = {"ok": False, "error": "operator_step_blocked"}
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    serve()
