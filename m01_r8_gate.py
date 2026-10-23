#!/usr/bin/env python3
"""R8 local/offline admission evaluator. Intentionally no GCP client or submit capability.

No command in this module can stage source, submit, push or deploy.
A future separately approved implementation must bind this evidence to live readbacks.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import yaml

PROJECT = "jscc-shared"
REGION = "europe-west1"
SA = "projects/jscc-shared/serviceAccounts/jscc-ci-m01@jscc-shared.iam.gserviceaccount.com"
REPOSITORY = "projects/jscc-shared/locations/europe-west1/connections/github-jscc/repositories/Shosetzel69-job-search-command-center"
IMAGE = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service:"
REQUIRED = {"substitutions", "steps", "images", "serviceAccount", "options", "timeout"}

class UniqueLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node):
    out = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in out:
            raise ValueError("duplicate YAML key")
        out[key] = loader.construct_object(value_node)
    return out
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)

def require(ok, reason):
    if not ok:
        raise ValueError("ADMISSION_BLOCKED: " + reason)

def validate_candidate(raw):
    data = yaml.load(raw, Loader=UniqueLoader)
    require(type(data) is dict and set(data) == REQUIRED, "candidate top-level schema")
    require(data["substitutions"] == {"_GIT_SHA": ""}, "substitutions")
    require(data["serviceAccount"] == SA, "service account")
    require(data["timeout"] == "900s", "timeout")
    require(data["options"] == {"logging": "CLOUD_LOGGING_ONLY", "machineType": "E2_STANDARD_2", "requestedVerifyOption": "VERIFIED"}, "options")
    steps = data["steps"]
    require(type(steps) is list and len(steps) == 1, "single step")
    step = steps[0]
    require(type(step) is dict and set(step) == {"id", "name", "args"}, "step schema")
    require(step["id"] == "build-service-image" and step["name"] == "gcr.io/cloud-builders/docker", "step identity")
    expected_args = ["build", "--pull", "--build-arg", "GIT_SHA=${_GIT_SHA}", "-f", "Dockerfile.service", "-t", IMAGE + "${_GIT_SHA}", "."]
    require(step["args"] == expected_args, "step args")
    require(data["images"] == [IMAGE + "${_GIT_SHA}"], "provenance image")
    return data

def validate_admission(evidence, config_bytes):
    """Pure verifier: evidence assertions are externally supplied, NOT provider-attested.
    This function never submits even when all fields pass.
    """
    validate_candidate(config_bytes.decode("utf-8"))
    require(type(evidence) is dict, "evidence format")
    allowed = {"authorized", "authorization_id", "one_shot", "not_expired", "sha", "remote_sha", "local_sha", "clean_tree", "config_sha256", "project", "region", "service_account", "connected_repository", "connected_repo_verified", "iam_fresh", "iam_exact", "compute_sa_disabled", "trial_credit_verified", "cost_cap_approved", "source_revision_verified"}
    require(set(evidence) == allowed, "evidence schema")
    for flag in ("authorized", "one_shot", "not_expired", "clean_tree", "connected_repo_verified", "iam_fresh", "iam_exact", "compute_sa_disabled", "trial_credit_verified", "cost_cap_approved", "source_revision_verified"):
        require(evidence[flag] is True, flag)
    require(isinstance(evidence["authorization_id"], str) and bool(evidence["authorization_id"].strip()), "authorization ID")
    sha = evidence["sha"]
    require(type(sha) is str and re.fullmatch(r"[a-f0-9]{40}", sha) is not None, "full SHA")
    require(evidence["remote_sha"] == sha and evidence["local_sha"] == sha, "source SHA equality")
    require(evidence["config_sha256"] == hashlib.sha256(config_bytes).hexdigest(), "config hash")
    require(evidence["project"] == PROJECT and evidence["region"] == REGION and evidence["service_account"] == SA, "destination identity")
    require(evidence["connected_repository"] == REPOSITORY, "source connection")
    return {"admission": "OFFLINE_EVIDENCE_CONSISTENT_NOT_AUTHORIZED_TO_SUBMIT", "sha": sha, "config_sha256": evidence["config_sha256"], "source": REPOSITORY, "image": IMAGE + sha}

def main():
    parser = argparse.ArgumentParser(description="OFFLINE ONLY — no Cloud Build submission implementation")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--evidence-json", required=True)
    args = parser.parse_args()
    data = Path(args.evidence_json).read_text(encoding="utf-8")
    config_bytes = Path(args.candidate).read_bytes()
    # NO provider reads/writes and NO submit code in this executable.
    print(json.dumps(validate_admission(json.loads(data), config_bytes), sort_keys=True))

if __name__ == "__main__":
    main()
