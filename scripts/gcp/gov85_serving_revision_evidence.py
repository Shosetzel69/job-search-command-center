#!/usr/bin/env python3
"""Read-only redaction of actual Cloud Run serving-revision image digests.

Only accepts the canonical DEV Service and bounded active traffic. Never prints
JSON resource bodies, environment variables, or the original image reference.
This does NOT attest full rollback configuration or authorize a deployment.
"""
import json
import re
import sys

SERVICE = "jscc-command-api-dev"
REVISION = re.compile(r"^jscc-command-api-dev-[a-z0-9-]{5,80}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE = re.compile(r"^.+@sha256:([0-9a-f]{64})$")
MAX_ACTIVE = 20


def active_names(service):
    if not isinstance(service, dict):
        raise ValueError("invalid service")
    status = service.get("status")
    traffic = status.get("traffic") if isinstance(status, dict) else None
    if traffic is None:
        traffic = service.get("traffic")
    if not isinstance(traffic, list) or not traffic:
        raise ValueError("no traffic")
    active, seen, total = [], set(), 0
    for item in traffic:
        if not isinstance(item, dict):
            raise ValueError("malformed traffic")
        percent = item.get("percent")
        if isinstance(percent, bool) or not (
            isinstance(percent, int) or (isinstance(percent, str) and percent.isascii() and percent.isdecimal())
        ):
            raise ValueError("invalid traffic percentage")
        value = int(percent)
        if not 0 <= value <= 100:
            raise ValueError("out of bounds")
        if value == 0:
            continue
        name = item.get("revisionName") or item.get("revision")
        if not isinstance(name, str) or not REVISION.fullmatch(name) or name in seen:
            raise ValueError("invalid/duplicate revision")
        seen.add(name)
        total += value
        active.append(name)
    if total != 100 or not 1 <= len(active) <= MAX_ACTIVE:
        raise ValueError("incomplete/oversized active traffic")
    return sorted(active)


def revision_digest(name, revision):
    if not isinstance(name, str) or not REVISION.fullmatch(name) or not isinstance(revision, dict):
        raise ValueError("invalid revision")
    metadata = revision.get("metadata")
    actual = metadata.get("name") if isinstance(metadata, dict) else revision.get("name")
    valid_full = (
        f"projects/jscc-dev/locations/europe-west1/services/{SERVICE}/revisions/{name}"
    )
    if actual not in (name, valid_full):
        raise ValueError("unexpected revision identity")
    status = revision.get("status")
    digest = status.get("imageDigest") if isinstance(status, dict) else None
    if not digest:
        containers = revision.get("containerStatuses")
        if isinstance(containers, list) and len(containers) == 1 and isinstance(containers[0], dict):
            digest = containers[0].get("imageDigest")
    if not isinstance(digest, str):
        raise ValueError("unresolved image digest")
    if DIGEST.fullmatch(digest):
        return digest
    match = IMAGE.fullmatch(digest)
    if not match:
        raise ValueError("invalid image digest")
    return "sha256:" + match.group(1)


def main(argv):
    try:
        if len(argv) == 2 and argv[0] == "--active-names":
            with open(argv[1], encoding="utf-8") as f:
                names = active_names(json.load(f))
            print("\n".join(names))
            return 0
        if len(argv) == 3 and argv[0] == "--revision-digest":
            name = argv[1]
            with open(argv[2], encoding="utf-8") as f:
                digest = revision_digest(name, json.load(f))
            print(f"GOV85_ACTIVE_REVISION={name} digest={digest}")
            return 0
    except (OSError, ValueError, TypeError, KeyError):
        pass
    print("GOV85_ACTIVE_REVISION_UNVERIFIED", file=sys.stderr)
    return 86


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
