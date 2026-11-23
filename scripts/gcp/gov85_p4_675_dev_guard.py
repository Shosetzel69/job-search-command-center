#!/usr/bin/env python3
"""#663 / PR #675: fail-closed, metadata-only P4 DEV Service release checks.
The JSON snapshots are private files in the ephemeral Actions runner.
No secret values or raw service configuration may enter logs or artifacts.
"""
import json
import re
import sys
from copy import deepcopy

TARGET_SHA = "b8fa506987bd79053f5c3cf86137f32e41a4095b"
OLD_REV = "jscc-command-api-dev-00100-mek"
OLD_DIGEST = "sha256:588e56244e1b336b257be44721c8b9b4839a624bd7c7d31beafac5a47f72cbd4"
SA = "jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com"
BUILD_SA = "projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com"
IMAGE_REPO = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service"
TAG = "p4w1"
HEX_DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REV = re.compile(r"jscc-command-api-dev-[a-z0-9-]+\Z")


def deny(reason):
    print("JSCC_P4_675_DENIED=" + reason, file=sys.stderr)
    raise SystemExit(86)


def load(path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def template(service):
    for keys in (("spec", "template", "spec"), ("template",), ("spec", "template")):
        part = service
        for key in keys:
            part = part.get(key, {}) if isinstance(part, dict) else {}
        if isinstance(part, dict) and isinstance(part.get("containers"), list):
            if len(part["containers"]) != 1:
                deny("UNEXPECTED_CONTAINER_COUNT")
            return part
    deny("UNKNOWN_TEMPLATE_SHAPE")


def env(service):
    entries = template(service)["containers"][0].get("env", [])
    if not isinstance(entries, list) or any(
        not isinstance(item, dict) or not isinstance(item.get("name"), str)
        for item in entries
    ):
        deny("UNVERIFIED_ENV")
    result = {item["name"]: item for item in entries}
    if len(entries) != len(result):
        deny("DUPLICATE_ENV_NAME")
    return result


def service_account(service):
    t = template(service)
    return t.get("serviceAccountName") or t.get("serviceAccount")


def traffic(service):
    entries = service.get("status", {}).get("traffic") or service.get("traffic") or []
    if not isinstance(entries, list) or any(not isinstance(e, dict) for e in entries):
        deny("TRAFFIC_SHAPE")
    return entries


def serving(service):
    try:
        active = [(t.get("revisionName") or t.get("revision"), int(t.get("percent", 0)))
                  for t in traffic(service) if int(t.get("percent", 0)) > 0]
    except (TypeError, ValueError):
        deny("TRAFFIC_PERCENT")
    if len(active) != 1 or active[0][1] != 100 or not REV.fullmatch(active[0][0] or ""):
        deny("TRAFFIC_UNEXPECTED")
    return active[0][0]


def base(service):
    if serving(service) != OLD_REV:
        deny("SERVING_REVISION_DRIFT")
    if service_account(service) != SA:
        deny("RUNTIME_SERVICE_ACCOUNT_DRIFT")
    expected = {"APP_ENV": "dev", "JSCC_RUNTIME_BACKEND": "gcp", "SEARCH_MODE": "disabled"}
    current = env(service)
    for key, value in expected.items():
        if current.get(key, {}).get("value") != value:
            deny("DEV_CONFIG_DRIFT_" + key)
    if any(t.get("tag") == TAG for t in traffic(service)):
        deny("STAGE_TAG_ALREADY_PRESENT")
    print("JSCC_P4_BASELINE_REVISION=" + OLD_REV)
    print("JSCC_P4_BASELINE_ENV_COUNT=" + str(len(current)))
    print("JSCC_P4_BASELINE_PREFLIGHT=PASS")


def parity(old, new):
    """All container, scaling, annotation, networking and secret config is immutable.
    Only the reviewed image and SOURCE_SHA/RUNTIME_DATA_SHA values may change.
    """
    def cleaned(s):
        t = deepcopy(template(s))
        t["containers"][0].pop("image", None)
        t["containers"][0]["env"] = sorted(
            (entry for entry in t["containers"][0].get("env", [])
             if entry.get("name") not in {"SOURCE_SHA", "RUNTIME_DATA_SHA"}),
            key=lambda item: item["name"],
        )
        return t
    if cleaned(old) != cleaned(new):
        deny("UNAUTHORIZED_SERVICE_TEMPLATE_CHANGE")
    if protected_metadata(old) != protected_metadata(new):
        deny("UNAUTHORIZED_SERVICE_METADATA_CHANGE")
    if service_account(old) != service_account(new):
        deny("SERVICE_IDENTITY_CHANGED")
    before, after = env(old), env(new)
    for name in before.keys() | after.keys():
        if name not in {"SOURCE_SHA", "RUNTIME_DATA_SHA"} and before.get(name) != after.get(name):
            deny("UNAUTHORIZED_ENV_MUTATION")
    for name in ("SOURCE_SHA", "RUNTIME_DATA_SHA"):
        if after.get(name, {}).get("value") != TARGET_SHA:
            deny("IMAGE_IDENTITY_ENV_MISMATCH")
    return True


def protected_metadata(service):
    """Protect ALL service and revision annotations, excluding only known
    gcloud-generated client/operation bookkeeping. This includes VPC, ingress,
    networking, scaling, Cloud SQL, ingress policy and secret bindings.
    """
    root = service.get("metadata", {})
    spec = service.get("spec", {})
    revision = (spec.get("template", {}) if isinstance(spec, dict) else {}).get("metadata", {})
    def clean(value):
        if not isinstance(value, dict):
            deny("UNVERIFIED_METADATA")
        result = deepcopy(value)
        result.pop("name", None)  # generated revision name
        annotations = result.get("annotations", {})
        if not isinstance(annotations, dict):
            deny("INVALID_ANNOTATION_SHAPE")
        for key in (
            "run.googleapis.com/client-name",
            "run.googleapis.com/client-version",
            "run.googleapis.com/operation-id",
            # Cloud Run overwrites these with the principal executing the stage.
            # They are audit metadata, not VPC/secret/scaling configuration.
            "serving.knative.dev/lastModifier",
            "run.googleapis.com/lastModifier",
        ):
            annotations.pop(key, None)
        result.pop("generation", None)
        result.pop("resourceVersion", None)
        result.pop("uid", None)
        result.pop("creationTimestamp", None)
        return result
    return clean(root), clean(revision)


def unchanged(old, current):
    base(current)
    if template(old) != template(current) or env(old) != env(current) or protected_metadata(old) != protected_metadata(current):
        deny("CONCURRENT_CONFIG_CHANGE")
    if traffic(old) != traffic(current):
        deny("CONCURRENT_TRAFFIC_CHANGE")
    print("JSCC_P4_PRESTAGE_CAS=PASS")


def stage(old, current):
    parity(old, current)
    if serving(current) != OLD_REV:
        deny("SERVING_CHANGED_DURING_STAGING")
    candidates = [
        t for t in traffic(current)
        if t.get("tag") == TAG and int(t.get("percent", 0)) == 0
        and REV.fullmatch(t.get("revisionName") or t.get("revision") or "")
    ]
    if len(candidates) != 1 or not str(candidates[0].get("url", "")).startswith("https://"):
        deny("UNVERIFIED_STAGED_TAG")
    row = candidates[0]
    revision = row.get("revisionName") or row.get("revision")
    print("JSCC_P4_STAGED_REVISION=" + revision)
    print("JSCC_P4_STAGED_URL=" + row["url"])
    print("JSCC_P4_STAGED_CONFIG_PARITY=PASS")


def final(staged, current, revision):
    parity(staged, current)
    if not REV.fullmatch(revision):
        deny("INVALID_REVISION")
    if serving(current) != revision:
        deny("CUTOVER_NOT_100_PERCENT")
    print("JSCC_P4_FINAL_SERVICE_CONFIG=PASS")
    print("JSCC_P4_CUTOVER_100_PERCENT=PASS")


def attest(builds, digest):
    if not HEX_DIGEST.fullmatch(digest):
        deny("IMAGE_DIGEST_INVALID")
    tag = IMAGE_REPO + ":" + TARGET_SHA
    if not isinstance(builds, list):
        deny("BUILD_EVIDENCE_INVALID")
    for build in builds:
        if not isinstance(build, dict) or build.get("status") != "SUCCESS":
            continue
        if build.get("serviceAccount") != BUILD_SA:
            continue
        if build.get("substitutions", {}).get("_GIT_SHA") != TARGET_SHA:
            continue
        if tag not in build.get("images", []):
            continue
        if any(isinstance(img, dict) and img.get("name") == tag
               and img.get("digest") == digest
               for img in build.get("results", {}).get("images", [])):
            print("JSCC_P4_SERVICE_IMAGE_BUILD_ATTESTED=PASS")
            return
    deny("IMAGE_BUILD_PROVENANCE_UNVERIFIED")



# The check-runs endpoint contains JOB names, not workflow names. Anchor
# success to the exact immutable post-merge SHA and the GitHub Actions app.
REQUIRED_CI = (
    "validate",
    "Nile-only native provider CI",
    "api-version-policy",
    "gitleaks",
    "snapshot",
)

def postmerge_ci(payload, sha):
    if sha != TARGET_SHA or not isinstance(payload, dict):
        deny("CHECK_RUN_SOURCE_INVALID")
    entries = payload.get("check_runs")
    if not isinstance(entries, list):
        deny("CHECK_RUNS_NOT_AVAILABLE")
    for name in REQUIRED_CI:
        matching = [
            row for row in entries if isinstance(row, dict)
            and row.get("name") == name
            and row.get("status") == "completed"
            and row.get("conclusion") == "success"
            and row.get("head_sha") == TARGET_SHA
            and isinstance(row.get("app"), dict)
            and row["app"].get("slug") == "github-actions"
        ]
        if not matching:
            deny("MAIN_CHECK_RUN_MISSING_" + name.replace(" ", "_"))
    print("JSCC_P4_MAIN_EXACT_SHA_CI=PASS")


def environment_protection(payload):
    """Release is denied unless GitHub's DEV environment has actual reviewers.
    The job must also be subject to GitHub's *external* environment approval
    before obtaining WIF credentials; an owner issue comment alone is insufficient.
    """
    if not isinstance(payload, dict) or payload.get("name") != "dev":
        deny("DEV_ENVIRONMENT_UNVERIFIED")
    rules = payload.get("protection_rules")
    if not isinstance(rules, list):
        deny("DEV_ENVIRONMENT_PROTECTION_MISSING")
    reviewer_rules = [r for r in rules if isinstance(r, dict)
                      and r.get("type") == "required_reviewers"]
    if len(reviewer_rules) != 1:
        deny("DEV_REQUIRED_REVIEWERS_MISSING")
    rule = reviewer_rules[0]
    reviewers = rule.get("reviewers")
    if not isinstance(reviewers, list) or not reviewers:
        deny("DEV_REQUIRED_REVIEWERS_EMPTY")
    eligible = [
        row for row in reviewers if isinstance(row, dict)
        and row.get("type") == "User"
        and isinstance(row.get("reviewer"), dict)
        and isinstance(row["reviewer"].get("login"), str)
        and row["reviewer"]["login"]
        and not row["reviewer"]["login"].lower().endswith("[bot]")
    ]
    if not eligible:
        deny("DEV_HUMAN_REVIEWER_NOT_CONFIGURED")
    if rule.get("prevent_self_review") is True and all(
        row["reviewer"]["login"].casefold() == "shosetzel69" for row in eligible
    ):
        deny("DEV_OWNER_CANNOT_SELF_REVIEW")
    print("JSCC_P4_DEV_ENV_REQUIRED_REVIEWERS=CONFIGURED")

if __name__ == "__main__":
    try:
        operation = sys.argv[1]
        if operation == "baseline" and len(sys.argv) == 3:
            base(load(sys.argv[2]))
        elif operation == "unchanged" and len(sys.argv) == 4:
            unchanged(load(sys.argv[2]), load(sys.argv[3]))
        elif operation == "stage" and len(sys.argv) == 4:
            stage(load(sys.argv[2]), load(sys.argv[3]))
        elif operation == "final" and len(sys.argv) == 5:
            final(load(sys.argv[2]), load(sys.argv[3]), sys.argv[4])
        elif operation == "attest" and len(sys.argv) == 4:
            attest(load(sys.argv[2]), sys.argv[3])
        elif operation == "postmerge-ci" and len(sys.argv) == 4:
            postmerge_ci(load(sys.argv[2]), sys.argv[3])
        elif operation == "environment-protection" and len(sys.argv) == 3:
            environment_protection(load(sys.argv[2]))
        else:
            deny("ARGUMENTS")
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, IndexError):
        deny("UNVERIFIED_EVIDENCE")
