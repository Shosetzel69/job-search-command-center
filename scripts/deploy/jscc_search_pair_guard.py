#!/usr/bin/env python3
"""DEV-only read-only Service/Search Job compatibility gate (#520).

Compare the exact immutable candidate Job image with the effective Search Job
image before promoting a Service SHA. Never print unredacted GCP configuration.
"""
import json
import re
import sys

JOB_IMAGE = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")


def deny(reason):
    print("JSCC_RETRIEVE_PAIR_DENIED=" + reason, file=sys.stderr)
    raise SystemExit(86)


def job_container(job):
    # Cloud Run v1 (gcloud describe) and v2 REST representations.
    candidates = [
        (((job.get("spec") or {}).get("template") or {}).get("spec") or {}).get("template") or {},
        ((job.get("template") or {}).get("template") or {}),
    ]
    for candidate in candidates:
        spec = candidate.get("spec") or candidate
        containers = spec.get("containers") or []
        if len(containers) == 1 and isinstance(containers[0], dict):
            return containers[0]
    deny("JOB_TEMPLATE_NOT_ATTESTED")


def check(job, sha, immutable_digest):
    if not SHA.fullmatch(sha) or not DIGEST.fullmatch(immutable_digest):
        deny("CANDIDATE_IDENTITY_INVALID")
    container = job_container(job)
    image = container.get("image")
    if image not in (JOB_IMAGE + "@" + immutable_digest, JOB_IMAGE + ":" + sha):
        deny("JOB_IMAGE_SHA_MISMATCH")
    entries = container.get("env") or []
    if not isinstance(entries, list):
        deny("JOB_ENV_NOT_ATTESTED")
    values = {}
    for entry in entries:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not name or name in values:
            deny("JOB_ENV_INVALID")
        values[name] = entry.get("value")
    if values.get("APP_ENV") != "dev" or values.get("GCP_RUNTIME_BUCKET") != "jscc-dev-runtime-828902654738":
        deny("JOB_DEV_CONFIGURATION_MISMATCH")
    # IMAGE provenance: immutable registry SHA tag must resolve to candidate
    # digest; deployer compares that against the pinned/immutable Job image.
    print("JSCC_RETRIEVE_PAIR_PREFLIGHT=PASS")


def main(argv):
    if len(argv) != 4:
        deny("ARGUMENTS")
    _, path, sha, digest = argv
    with open(path, encoding="utf-8") as stream:
        check(json.load(stream), sha, digest)


if __name__ == "__main__":
    main(sys.argv)
