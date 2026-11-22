#!/usr/bin/env python3
"""#659 stage-1 Cloud Run metadata guard. Never prints env values or secrets.

Control-plane script only. Reads local JSON returned by gcloud into runner /tmp.
No standalone PostgreSQL and no database mutation.
"""
import json
import re
import sys

OLD_REV = "jscc-command-api-dev-00098-cem"
OLD_DIGEST = "sha256:8b9229a096a2ef723c89efed4d25111e589de1152419dd1765df703375d82d93"
SA = "jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REV = re.compile(r"jscc-command-api-dev-[a-z0-9-]+\Z")


def fail(reason):
    print("JSCC659_STAGE1_DENIED=" + reason, file=sys.stderr)
    sys.exit(86)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def template(service):
    for path in (
        ("spec", "template", "spec"),
        ("template",),
        ("spec", "template"),
    ):
        cur = service
        for key in path:
            cur = cur.get(key, {}) if isinstance(cur, dict) else {}
        if isinstance(cur, dict) and isinstance(cur.get("containers"), list):
            return cur
    fail("TEMPLATE_SHAPE_UNKNOWN")


def env_dict(service):
    t = template(service)
    if len(t["containers"]) != 1:
        fail("CONTAINERS_UNKNOWN")
    entries = t["containers"][0].get("env", [])
    if not isinstance(entries, list) or any(
        not isinstance(x, dict) or not isinstance(x.get("name"), str) for x in entries
    ):
        fail("ENV_SHAPE")
    result = {x["name"]: x for x in entries}
    if len(result) != len(entries):
        fail("ENV_DUPLICATED")
    return result


def service_account(service):
    t = template(service)
    return t.get("serviceAccountName") or t.get("serviceAccount")


def serving(service):
    traffic = service.get("status", {}).get("traffic") or service.get("traffic") or []
    active = [
        (x.get("revisionName") or x.get("revision"), int(x.get("percent", 0)))
        for x in traffic if isinstance(x, dict) and int(x.get("percent", 0)) > 0
    ]
    if len(active) != 1 or active[0][1] != 100 or not REV.fullmatch(active[0][0] or ""):
        fail("UNEXPECTED_TRAFFIC")
    return active[0][0]


def assert_old(original):
    if serving(original) != OLD_REV:
        fail("SERVING_REVISION_DRIFT")
    if service_account(original) != SA:
        fail("SERVICE_ACCOUNT_DRIFT")
    env = env_dict(original)
    for name, expected in (
        ("APP_ENV", "dev"), ("JSCC_RUNTIME_BACKEND", "gcp"), ("SEARCH_MODE", "disabled")
    ):
        if env.get(name, {}).get("value") != expected:
            fail("RUNTIME_ENV_DRIFT_" + name)
    if env.get("JSCC_PERF_TELEMETRY", {}).get("value") == "1":
        fail("TELEMETRY_ALREADY_ENABLED")
    print("JSCC659_STAGE1_DEV_BASELINE_REVISION=" + OLD_REV)
    print("JSCC659_STAGE1_RUNTIME_ENV_COUNT=" + str(len(env)))
    print("JSCC659_STAGE1_CONFIG_PREFLIGHT=PASS")


def check_stage(old, new, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        fail("INVALID_SOURCE_SHA")
    if service_account(old) != service_account(new):
        fail("SERVICE_ACCOUNT_CHANGED")
    before, after = env_dict(old), env_dict(new)
    changed = {"SOURCE_SHA", "RUNTIME_DATA_SHA", "JSCC_PERF_TELEMETRY"}
    for name in before.keys() | after.keys():
        if name not in changed and before.get(name) != after.get(name):
            fail("UNAPPROVED_ENV_MUTATION")
    for name, expected in (
        ("SOURCE_SHA", sha), ("RUNTIME_DATA_SHA", sha),
        ("JSCC_PERF_TELEMETRY", "1")
    ):
        if after.get(name, {}).get("value") != expected:
            fail("SOURCE_OR_FLAG_NOT_SET_" + name)
    traffic = new.get("status", {}).get("traffic") or new.get("traffic") or []
    matching = [
        x for x in traffic if isinstance(x, dict)
        and x.get("tag") == "perf659"
        and int(x.get("percent", 0)) == 0
        and REV.fullmatch(x.get("revisionName") or x.get("revision") or "")
    ]
    if len(matching) != 1 or not str(matching[0].get("url", "")).startswith("https://"):
        fail("TAGGED_0PC_REVISION_NOT_VERIFIED")
    if serving(new) != OLD_REV:
        fail("OLD_TRAFFIC_CHANGED_DURING_STAGE")
    print("JSCC659_STAGE1_STAGED_REVISION=" + (matching[0].get("revisionName") or matching[0]["revision"]))
    print("JSCC659_STAGE1_TAGGED_URL=" + matching[0]["url"])
    print("JSCC659_STAGE1_CONFIG_PARITY=PASS")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        fail("ARGUMENTS")
    try:
        if sys.argv[1] == "preflight" and len(sys.argv) == 3:
            assert_old(load(sys.argv[2]))
        elif sys.argv[1] == "stage" and len(sys.argv) == 5:
            check_stage(load(sys.argv[2]), load(sys.argv[3]), sys.argv[4])
        else:
            fail("ARGUMENTS")
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        fail("UNVERIFIED_RUNTIME_EVIDENCE")
