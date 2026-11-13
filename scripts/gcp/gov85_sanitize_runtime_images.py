#!/usr/bin/env python3
"""Print redacted Cloud Run image identity; never expose env or secret bindings."""
import json
import re
import sys

DIGEST = re.compile(r"^.+@sha256:[0-9a-f]{64}$")


def get(source, *keys):
    for key in keys:
        if not isinstance(source, dict):
            return None
        source = source.get(key)
    return source


def image_at(resource, candidates):
    for path in candidates:
        containers = get(resource, *path)
        if isinstance(containers, list) and containers and isinstance(containers[0], dict):
            img = containers[0].get("image")
            if isinstance(img, str):
                return img
    return None


def digest_identity(image):
    # Do not publish arbitrary image URLs, tags, env or token-bearing strings.
    # A digest with a valid sha256 hash is the only reliable rollback identity.
    if not isinstance(image, str) or not DIGEST.fullmatch(image):
        return "UNVERIFIED"
    return image.rsplit("@", 1)[-1]


def summarize(service, job):
    # Cloud Run v1/v2 representations differ; unknown fields fail closed to
    # UNVERIFIED, not misleading PASS. latestReadyRevision != active traffic.
    service_image = image_at(service, (
        ("spec", "template", "spec", "containers"),
        ("template", "containers"),
        ("spec", "template", "containers"),
    ))
    job_image = image_at(job, (
        ("spec", "template", "spec", "template", "spec", "containers"),
        ("spec", "template", "spec", "containers"),
        ("template", "template", "containers"),
        ("template", "containers"),
    ))
    traffic = get(service, "status", "traffic") or get(service, "traffic") or []
    serving = []
    if isinstance(traffic, list):
        for item in traffic:
            if not isinstance(item, dict):
                continue
            raw_percent = item.get("percent")
            try:
                percent = int(raw_percent)
            except (TypeError, ValueError):
                continue
            if percent > 0:
                name = item.get("revisionName") or item.get("revision")
                if isinstance(name, str) and re.fullmatch(r"jscc-command-api-dev-[a-z0-9-]+", name):
                    serving.append((name, percent))
    serving = sorted(serving)
    # The Service template is NOT necessarily the currently serving revision.
    return {
        "service_latest_template_digest": digest_identity(service_image),
        "job_template_digest": digest_identity(job_image),
        "serving_revisions": serving,
        "rollback_attested": False,  # Requires serving revision digests and configs.
    }


def main(argv):
    if len(argv) != 2:
        return 86
    try:
        with open(argv[0], encoding="utf-8") as f:
            service = json.load(f)
        with open(argv[1], encoding="utf-8") as f:
            job = json.load(f)
        result = summarize(service, job)
    except (OSError, ValueError, TypeError):
        print("GOV85_RUNTIME_IDENTITY_UNVERIFIED", file=sys.stderr)
        return 86
    print("GOV85_SERVICE_LATEST_TEMPLATE_DIGEST=" + result["service_latest_template_digest"])
    print("GOV85_JOB_TEMPLATE_DIGEST=" + result["job_template_digest"])
    print("GOV85_ACTIVE_SERVICE_REVISIONS=" +
          (",".join(f"{name}:{pct}%" for name, pct in result["serving_revisions"]) or "UNVERIFIED"))
    print("GOV85_ROLLBACK_ATTESTED=false")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
