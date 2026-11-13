#!/usr/bin/env python3
"""#87: scoped adaptation of #520's paired DEV-only Service/Job rollout.

Read-only `preflight`; mutating `deploy` requires an external, recorded exact-digest
owner approval and independent EXECUTION_REVIEW_PASS. This script never grants
approval. No database, IAM, secrets, or TEST/PROD changes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "jscc-dev"
REGION = "europe-west1"
BUCKET = "jscc-dev-runtime-828902654738"
JOB = "jscc-search-dev"
SERVICE = "jscc-command-api-dev"
SHA = "ce9206644c4d0556b3852dfe50a6717ebd5c4615"
OLD_SHA = "567c4246f8c9621f2df727e066b9e95f4ed7d449"
JOB_IMAGE = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc@sha256:6827f207273e7ef4b4d33e4aff85e44884ffbd9399494c93fcd1cc9d853d3bf9"
SERVICE_IMAGE = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@sha256:8b7b859ddd5de82407f42c2be9d477bd8facc722ba77a6f6b52da0716d6c8367"
OLD_JOB_IMAGE = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc@sha256:ca50ae7ecae12a27ac07551b36d0d5ebe3da3cf52cedcc4fb68700f6cab6ac53"
OLD_SERVICE_IMAGE = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@sha256:f577b6d325493296e738dfa99878251e58ee750293dcd10f1da33bee03ad6707"
OLD_SERVICE_REVISION = "jscc-command-api-dev-00059-4hb"
EXPECTED_JOB_GENERATION = 41
LOCK = "locks/heavy-search.lock"
ACTIVE = "active.json"

class Stop(Exception):
    pass


def cloud(*args):
    p = subprocess.run(["gcloud", *args, "--quiet", "--format=json"],
                       text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       check=False,
                       env={**os.environ, "CLOUDSDK_CORE_DISABLE_PROMPTS": "1"})
    if p.returncode:
        raise Stop(f"GCLOUD_FAILED {args[0:3]} rc={p.returncode}")
    try:
        return json.loads(p.stdout)
    except ValueError as err:
        raise Stop("GCLOUD_JSON_UNAVAILABLE") from err


def context():
    p = subprocess.run(["gcloud", "config", "get-value", "project"],
                       capture_output=True, text=True, check=True)
    if p.stdout.strip() != PROJECT:
        raise Stop("WRONG_GCLOUD_PROJECT")


def describe(kind, name):
    return cloud("run", kind, "describe", name,
                 f"--project={PROJECT}", f"--region={REGION}")


def old_revision():
    revision = describe("revisions", OLD_SERVICE_REVISION)
    match_image(revision, OLD_SERVICE_IMAGE)
    match_env(revision, {"SOURCE_SHA": OLD_SHA, "RUNTIME_DATA_SHA": OLD_SHA,
                         "GCP_SEARCH_JOB": JOB})
    return revision


def walk(node, key):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                yield v
            yield from walk(v, key)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v, key)


def one_container(resource):
    options = [v for v in walk(resource, "containers") if isinstance(v, list)
               and v and isinstance(v[0], dict) and "image" in v[0]]
    if len(options) != 1 or len(options[0]) != 1:
        raise Stop("CONTAINER_STRUCTURE_DRIFT")
    return options[0][0]


def value_map(resource):
    return {x.get("name"): x.get("value") for x in one_container(resource).get("env", [])
            if isinstance(x, dict) and "value" in x}


def match_image(resource, expected):
    actual = one_container(resource)["image"]
    if actual != expected and not actual.endswith(expected.split("@")[-1]):
        raise Stop("IMAGE_DRIFT")


def match_env(resource, expected):
    actual = value_map(resource)
    for k, v in expected.items():
        if actual.get(k) != v:
            raise Stop(f"ENV_DRIFT {k}")


def live_traffic(service):
    rows = service.get("status", {}).get("traffic") or service.get("status", {}).get("trafficStatuses")
    if not isinstance(rows, list) or not rows:
        raise Stop("SERVICE_TRAFFIC_UNKNOWN")
    active = [(x.get("revisionName") or x.get("revision"), int(x.get("percent") or 0))
              for x in rows if x.get("percent")]
    return active


def before():
    context()
    job = describe("jobs", JOB)
    service = describe("services", SERVICE)
    match_image(job, OLD_JOB_IMAGE)
    match_env(job, {"APP_ENV": "dev", "SOURCE_SHA": OLD_SHA})
    match_image(service, OLD_SERVICE_IMAGE)
    match_env(service, {"SOURCE_SHA": OLD_SHA, "RUNTIME_DATA_SHA": OLD_SHA,
                        "GCP_SEARCH_JOB": JOB})
    if int(job.get("metadata", {}).get("generation") or -1) != EXPECTED_JOB_GENERATION:
        raise Stop("JOB_GENERATION_DRIFT")
    if int(job.get("status", {}).get("observedGeneration") or -1) != EXPECTED_JOB_GENERATION:
        raise Stop("JOB_NOT_RECONCILED")
    if live_traffic(service) != [(OLD_SERVICE_REVISION, 100)]:
        raise Stop("SERVICE_TRAFFIC_DRIFT")
    old_revision()
    return job, service


def gcs(method, name, payload=None, *, generation=None, create=False):
    token = subprocess.run(["gcloud", "auth", "print-access-token"],
                           check=True, capture_output=True, text=True).stdout.strip()
    if not token:
        raise Stop("GCS_ACCESS_TOKEN_MISSING")
    quoted = urllib.parse.quote(name, safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{quoted}"
    if create:
        url = (f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o"
               f"?uploadType=media&name={quoted}&ifGenerationMatch=0")
    if generation is not None:
        url += "?ifGenerationMatch=" + urllib.parse.quote(str(generation), safe="")
    req = urllib.request.Request(url,
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/json"},
                                 method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return json.load(response) if method != "DELETE" else None
    except urllib.error.HTTPError as exc:
        if method == "GET" and exc.code == 404:
            return None
        raise Stop(f"GCS_HTTP_{exc.code} {name} {method}") from exc
    except (OSError, ValueError) as exc:
        raise Stop(f"GCS_UNVERIFIED {name} {method}") from exc


def verify_service_oci_revision():
    token = subprocess.run(["gcloud", "auth", "print-access-token"],
                           check=True, capture_output=True, text=True).stdout.strip()
    headers = {"Authorization": "Bearer " + token,
               "Accept": "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"}
    base = "https://europe-west1-docker.pkg.dev/v2/jscc-shared/jscc/jscc-service"
    digest = SERVICE_IMAGE.split("@", 1)[1]
    try:
        req = urllib.request.Request(base + "/manifests/" + digest, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            manifest = json.load(response)
        config_digest = manifest.get("config", {}).get("digest")
        if not config_digest or not config_digest.startswith("sha256:"):
            raise Stop("SERVICE_CONFIG_DIGEST_UNAVAILABLE")
        req = urllib.request.Request(base + "/blobs/" + config_digest, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            config = json.load(response)
    except (OSError, ValueError) as exc:
        raise Stop("SERVICE_OCI_CONFIG_UNVERIFIED") from exc
    label = config.get("config", {}).get("Labels", {}).get("org.opencontainers.image.revision")
    if label != SHA:
        raise Stop("SERVICE_OCI_REVISION_MISMATCH")
    print("SERVICE_OCI_REVISION_MATCH", flush=True)


def executions_clear():
    runs = cloud("run", "jobs", "executions", "list", f"--job={JOB}",
                 f"--project={PROJECT}", f"--region={REGION}", "--limit=1000")
    if not isinstance(runs, list):
        raise Stop("EXECUTION_INVENTORY_UNKNOWN")
    nonterminal = [r for r in runs if not (r.get("completionTime") or
                  (r.get("status") or {}).get("completionTime"))]
    if nonterminal:
        raise Stop("NONTERMINAL_JOB_EXECUTION")
    return len(runs)


def snapshot(job, service):
    root = Path.home() / "jscc-single-job-rollback"
    root.mkdir(mode=0o700, exist_ok=True)
    d = root / ("87-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    d.mkdir(mode=0o700)
    for name, data in (("job", job), ("service", service)):
        path = d / (name + ".json")
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        path.chmod(0o600)
    print(f"PRIVATE_ROLLBACK_SNAPSHOT={d}", flush=True)
    return d


def ensure_unchanged(before_resource, after_resource, *, kind):
    # Compare container metadata without values of secrets in printed output.
    from copy import deepcopy
    b = deepcopy(before_resource)
    a = deepcopy(after_resource)
    b_c, a_c = one_container(b), one_container(a)
    b_c.pop("image", None)
    a_c.pop("image", None)
    allowed = {"SOURCE_SHA", "RUNTIME_DATA_SHA"} if kind == "service" else {"SOURCE_SHA"}
    for cont in (b_c, a_c):
        for e in cont.get("env", []):
            if e.get("name") in allowed:
                e["value"] = "<EXPECTED_IDENTITY_CHANGE>"
    if b_c != a_c:
        raise Stop(f"{kind.upper()}_CONTAINER_CONFIG_DRIFT")
    attrs = ("volumes", "serviceAccountName", "serviceAccount", "vpcAccess",
             "timeoutSeconds", "maxRetries", "taskCount", "parallelism",
             "executionEnvironment", "scaling", "maxInstanceRequestConcurrency")
    for attr in attrs:
        if list(walk(b, attr)) != list(walk(a, attr)):
            raise Stop(f"{kind.upper()}_TEMPLATE_DRIFT {attr}")


def update_job(image, sha):
    cloud("run", "jobs", "update", JOB, f"--project={PROJECT}", f"--region={REGION}",
          f"--image={image}", f"--update-env-vars=SOURCE_SHA={sha}")


def update_service():
    cloud("run", "services", "update", SERVICE, f"--project={PROJECT}",
          f"--region={REGION}", f"--image={SERVICE_IMAGE}",
          "--update-env-vars=" + f"SOURCE_SHA={SHA},RUNTIME_DATA_SHA={SHA}")
    cloud("run", "services", "update-traffic", SERVICE, f"--project={PROJECT}",
          f"--region={REGION}", "--to-latest")


def verify_pair(job_before, svc_before):
    new_job, new_service = describe("jobs", JOB), describe("services", SERVICE)
    match_image(new_job, JOB_IMAGE)
    match_env(new_job, {"SOURCE_SHA": SHA})
    match_image(new_service, SERVICE_IMAGE)
    match_env(new_service, {"SOURCE_SHA": SHA, "RUNTIME_DATA_SHA": SHA,
                            "GCP_SEARCH_JOB": JOB})
    if len(live_traffic(new_service)) != 1 or live_traffic(new_service)[0][1] != 100:
        raise Stop("SERVICE_TRAFFIC_NOT_100")
    if live_traffic(new_service)[0][0] == OLD_SERVICE_REVISION:
        raise Stop("SERVICE_STILL_OLD")
    ensure_unchanged(job_before, new_job, kind="job")
    ensure_unchanged(svc_before, new_service, kind="service")
    return True


def record_after(directory):
    for name, data in (("job-post", describe("jobs", JOB)),
                       ("service-post", describe("services", SERVICE))):
        path = directory / (name + ".json")
        with path.open("x", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2)
        path.chmod(0o600)


def rollback_pair(job_changed):
    # Keep admission lock until operator has verified both old identities.
    failures = []
    try:
        cloud("run", "services", "update-traffic", SERVICE,
              f"--project={PROJECT}", f"--region={REGION}",
              f"--to-revisions={OLD_SERVICE_REVISION}=100")
    except Exception as exc:
        failures.append("SERVICE_TRAFFIC_ROLLBACK_FAILED: " + str(exc))
    if job_changed:
        try:
            update_job(OLD_JOB_IMAGE, OLD_SHA)
        except Exception as exc:
            failures.append("JOB_ROLLBACK_FAILED: " + str(exc))
    try:
        job, svc = describe("jobs", JOB), describe("services", SERVICE)
        match_image(job, OLD_JOB_IMAGE)
        match_env(job, {"SOURCE_SHA": OLD_SHA})
        old_revision()  # Verify the serving revision, not the Service's newer template.
        if live_traffic(svc) != [(OLD_SERVICE_REVISION, 100)]:
            raise Stop("ROLLBACK_TRAFFIC_DRIFT")
    except Exception as exc:
        failures.append("ROLLBACK_VERIFY_FAILED: " + str(exc))
    if failures:
        raise Stop("; ".join(failures))
    print("PAIRED_ROLLBACK_VERIFIED", flush=True)


def deploy():
    job, svc = before()
    if gcs("GET", ACTIVE) is not None or gcs("GET", LOCK) is not None:
        raise Stop("ACTIVE_RUN_OR_LOCK_PRESENT")
    executions_clear()
    verify_service_oci_revision()
    evidence_dir = snapshot(job, svc)
    # Sentinel makes API dispatch admission create-only (ifGenerationMatch=0).
    sentinel = {"payload": {"maintenance": "#87", "reason": "paired-dev-image-cutover"}}
    created = gcs("POST", LOCK, sentinel, create=True)
    gen = (created or {}).get("generation")
    if not gen:
        raise Stop("SENTINEL_GENERATION_UNKNOWN; DO_NOT_DELETE_LOCK")
    print(f"SENTINEL_CREATED_GENERATION={gen}", flush=True)
    changed = False
    safe_to_release = False
    try:
        if gcs("GET", ACTIVE) is not None:
            raise Stop("ACTIVE_RUN_AFTER_SENTINEL")
        executions_clear()
        # Manual direct jobs execute MUST remain prohibited during this window.
        print("UPDATING_JOB_BY_DIGEST", flush=True)
        changed = True  # a failed API call may still have applied the update
        update_job(JOB_IMAGE, SHA)
        match_image(describe("jobs", JOB), JOB_IMAGE)
        print("UPDATING_SERVICE_AND_SHA_PAIR", flush=True)
        update_service()
        verify_pair(job, svc)
        executions_clear()
        record_after(evidence_dir)
        safe_to_release = True
        print("DEPLOY_CONFIG_PASS; RETRIEVE_SMOKE_NOT_EXECUTED", flush=True)
    except BaseException as err:
        print(f"DEPLOY_FAILED: {err}; paired rollback attempted", file=sys.stderr, flush=True)
        try:
            rollback_pair(changed)
            executions_clear()
            safe_to_release = True
        except Exception as rb:
            print(f"ROLLBACK_UNVERIFIED: {rb}; RETAIN_SENTINEL", file=sys.stderr, flush=True)
        raise Stop("DEPLOY_ABORTED") from err
    finally:
        if safe_to_release:
            try:
                # Generation precondition prevents deleting another run's lock.
                gcs("DELETE", LOCK, generation=gen)
                print("SENTINEL_RELEASED", flush=True)
            except Exception as err:
                raise Stop(f"SENTINEL_RELEASE_FAILED: {err}; MANUAL_REVIEW_REQUIRED") from err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["preflight", "deploy"])
    os.umask(0o077)
    args = ap.parse_args()
    try:
        if args.mode == "preflight":
            before()
            if gcs("GET", ACTIVE) is not None or gcs("GET", LOCK) is not None:
                raise Stop("ACTIVE_MARKER_PRESENT")
            executions_clear()
            verify_service_oci_revision()
            print("PREFLIGHT_BASELINE_PASS; DISPATCH_QUIESCENCE_NOT_YET_ESTABLISHED")
        else:
            deploy()
    except Stop as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return 86
    return 0


if __name__ == "__main__":
    sys.exit(main())
