#!/usr/bin/env python3
"""R8 offline EVD comparator; never claims signature verification or actual GCP attestation.
Real native provenance must be validated by an independently reviewed trusted SLSA verifier
and provider API before EVD-2 PASS. Here: structural fail-closed consistency only.
"""
import re
from m01_r8_gate import PROJECT, REGION, SA, REPOSITORY

def require(ok, message):
    if not ok:
        raise ValueError("EVD_BLOCKED: " + message)

def compare_evds(evd1, evd2):
    fields = ("sha", "config_sha256", "source", "project", "region", "service_account", "build_id")
    require(type(evd1) is dict and type(evd2) is dict, "format")
    for key in fields:
        require(key in evd1 and key in evd2 and evd1[key] == evd2[key], key)
    require(type(evd1["sha"]) is str and re.fullmatch(r"[a-f0-9]{40}", evd1["sha"]) is not None, "SHA")
    # Bind both records to immutable reviewed M01 admission identity, not just to each other.
    require(evd1["project"] == PROJECT, "project not approved")
    require(evd1["region"] == REGION, "region not approved")
    require(evd1["service_account"] == SA, "service account not approved")
    require(evd1["source"] == REPOSITORY, "source repository not approved")
    require(type(evd1["config_sha256"]) is str and re.fullmatch(r"[a-f0-9]{64}", evd1["config_sha256"]) is not None, "config SHA256")
    require(type(evd1["build_id"]) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", evd1["build_id"]) is not None, "build ID")
    require(evd2.get("status") == "SUCCESS", "build success")
    require(evd2.get("observed_actual_identity") is True, "actual SA not verified")
    require(evd2.get("provider_source_verified") is True, "source not verified")
    require(evd2.get("trusted_provenance_signature_verified") is True, "trusted signature not verified")
    require(evd2.get("subject_digest_verified") is True, "subject not verified")
    require(evd2.get("image") == "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@" + evd2.get("digest", ""), "immutable image")
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", evd2.get("digest", "")) is not None, "digest")
    # Even if flags are supplied, they are untrusted assertions until a reviewed provider verifier generates them.
    return {"result": "OFFLINE_CONSISTENCY_ONLY_NOT_EVD2_PASS", "digest": evd2["digest"]}
