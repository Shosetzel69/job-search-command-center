#!/usr/bin/env python3
"""#604: strict, read-only Cloud Run Admin API v2 queries (no gcloud JSON parsing)."""
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

IDENT = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
REV = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")


def require(value, label):
    if not isinstance(value, str) or not value:
        raise ValueError(f"missing {label}")
    return value


def service_summary(d):
    require(d.get("name"), "v2 service name")
    uri = require(d.get("uri"), "v2 service uri")
    if not uri.startswith("https://") or ".run.app" not in uri:
        raise ValueError("invalid Cloud Run service uri")
    ready = require(d.get("latestReadyRevision"), "v2 latest ready revision")
    if "/" in ready:
        ready = ready.rsplit("/", 1)[-1]
    statuses = d.get("trafficStatuses")
    if not isinstance(statuses, list) or not statuses:
        raise ValueError("v2 trafficStatuses absent")
    active = [t for t in statuses if isinstance(t, dict) and type(t.get("percent")) is int and t["percent"] > 0]
    if sum(t["percent"] for t in active) != 100:
        raise ValueError("traffic percent total not 100")
    return {"uri": uri, "latestReadyRevision": ready, "trafficStatuses": statuses}


def primary_revision(d):
    s = service_summary(d)
    active = [t for t in s["trafficStatuses"] if isinstance(t, dict) and t.get("percent") == 100 ]
    if len(active) != 1:
        raise ValueError("expected one untagged revision receiving 100 percent")
    revision = require(active[0].get("revision"), "v2 trafficStatuses revision")
    return revision.rsplit("/", 1)[-1]


def revision_image(d):
    """Return an immutable digest-pinned image from the documented v2 Revision."""
    configured = d.get("containers")
    if not isinstance(configured, list) or len(configured) != 1:
        raise ValueError("v2 revision must have one container")
    image = require(configured[0].get("image"), "v2 revision image")
    if "@sha256:" not in image:
        raise ValueError("v2 revision image must be digest pinned; cannot infer tag digest")
    repo, digest = image.rsplit("@", 1)
    if not repo or "/" not in repo or not DIGEST.fullmatch(digest):
        raise ValueError("v2 revision image is not a valid immutable digest reference")
    return image


def stage_preflight(d):
    if not d.get("name", "").endswith("/services/jscc-command-api-dev"):
        raise ValueError("wrong DEV service identity")
    template = d.get("template") or {}
    env = (template.get("containers") or [{}])[0].get("env") or []
    if len(template.get("containers") or []) != 1 or not isinstance(env, list):
        raise ValueError("unexpected DEV container layout")
    values = {e.get("name"): e for e in env if isinstance(e, dict)}
    for key, expected in (("APP_ENV", "dev"), ("SEARCH_MODE", "disabled"), ("JSCC_RUNTIME_BACKEND", "gcp")):
        if (values.get(key) or {}).get("value") != expected:
            raise ValueError(f"unexpected {key}")
    secret = (values.get("NILE_DATABASE_URL") or {}).get("valueSource", {}).get("secretKeyRef", {})
    if secret.get("secret") != "NILE_DATABASE_URL" or str(secret.get("version")) != "1":
        raise ValueError("unexpected Nile secret pin")
    return "JSCC531_DEV_SERVICE_PREFLIGHT_PASS"


def tagged_uri(d, tag="rf531"):
    service_summary(d)
    targets = [x for x in d["trafficStatuses"] if isinstance(x, dict) and x.get("tag") == tag]
    if len(targets) != 1 or targets[0].get("percent", 0) != 0:
        raise ValueError("tagged v2 revision absent or receiving traffic")
    url = require(targets[0].get("uri"), "tagged uri")
    if not url.startswith("https://") or ".run.app" not in url:
        raise ValueError("unexpected tagged revision uri")
    return url


def env_value(d, key):
    template = d.get("template") or {}
    containers = template.get("containers") or []
    if len(containers) != 1:
        raise ValueError("unexpected number of containers")
    values = [x.get("value") for x in containers[0].get("env", []) if x.get("name") == key]
    if len(values) != 1:
        raise ValueError(f"{key} absent or duplicate")
    return require(values[0], key)


def fetch_v2(project, region, kind, name=None):
    if not IDENT.fullmatch(project) or not IDENT.fullmatch(region):
        raise ValueError("bad project/region")
    if kind not in ("services", "jobs", "revisions"):
        raise ValueError("bad resource type")
    if name is not None and not REV.fullmatch(name):
        raise ValueError("bad resource name")
    token = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    if not token:
        raise ValueError("empty access token")
    parent = f"projects/{project}/locations/{region}"
    if kind == "revisions":
        raise ValueError("revision requires parent service; use fetch_revision")
    path = f"{parent}/{kind}" + (f"/{name}" if name else "?pageSize=100")
    return get("https://run.googleapis.com/v2/" + path, token)


def get(url, token):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        result = json.load(response)
    if not isinstance(result, dict) or "error" in result:
        raise ValueError("Cloud Run v2 response invalid")
    return result


def fetch_revision(project, region, service, revision):
    for s in (project, region, service, revision):
        if not IDENT.fullmatch(s):
            raise ValueError("bad resource name")
    token = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    path = f"projects/{project}/locations/{region}/services/{service}/revisions/{revision}"
    return get("https://run.googleapis.com/v2/" + path, token)


def list_names(project, region, kind):
    data = fetch_v2(project, region, kind)
    if data.get("nextPageToken"):
        raise ValueError("v2 list pagination is not fully consumed")
    plural = data.get(kind)
    if not isinstance(plural, list):
        raise ValueError(f"v2 {kind} missing")
    return "\n".join(require(x.get("name"), "resource name").rsplit("/", 1)[-1] for x in plural)


def main(argv):
    if len(argv) < 4:
        raise ValueError("usage: cloud_run_v2_read.py PROJECT REGION SERVICE MODE [ARG]")
    project, region, service, mode = argv[:4]
    if mode in ("service-names", "job-names"):
        return list_names(project, region, "services" if mode == "service-names" else "jobs")
    d = fetch_v2(project, region, "services", service)
    if mode == "uri":
        return service_summary(d)["uri"]
    if mode == "ready":
        return service_summary(d)["latestReadyRevision"]
    if mode == "percent":
        primary_revision(d)
        return "100"
    if mode == "primary-revision":
        return primary_revision(d)
    if mode == "tag-uri":
        return tagged_uri(d)
    if mode == "preflight":
        return stage_preflight(d)
    if mode == "env":
        return env_value(d, argv[4])
    if mode == "effective-image":
        rev = primary_revision(d)
        return revision_image(fetch_revision(project, region, service, rev))
    raise ValueError("unknown v2 query mode")


if __name__ == "__main__":
    try:
        print(main(sys.argv[1:]))
    except (ValueError, urllib.error.HTTPError, urllib.error.URLError, subprocess.CalledProcessError, KeyError, IndexError) as e:
        print("CLOUD_RUN_V2_READ_FAIL: " + str(e), file=sys.stderr)
        sys.exit(2)
