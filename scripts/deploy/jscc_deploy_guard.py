#!/usr/bin/env python3
"""Fail-closed, metadata-only DEV Cloud Run Service deployment contract.

No credentials or raw Cloud Run resource snapshots are printed.
Only the existing Service image and two build-identity variables may change.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from copy import deepcopy

PROJECT = "jscc-dev"
SERVICE = "jscc-command-api-dev"
RUNTIME_SA = "jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com"
IMAGE_REPO = "europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service"
BUILD_SA = "projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com"
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
REV_RE = re.compile(r"jscc-command-api-dev-[a-z0-9-]+\Z")
DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}\Z")
TAG_RE = re.compile(r"gd[0-9a-f]{10}\Z")
SERVER_ANNOTATIONS = {
    "run.googleapis.com/lastModifier",
    "serving.knative.dev/lastModifier",
    "run.googleapis.com/client-name",
    "run.googleapis.com/client-version",
    "run.googleapis.com/operation-id",
}

def deny(reason):
    print("JSCC_DEPLOY_DENIED=" + reason, file=sys.stderr)
    raise SystemExit(86)

def read(path):
    with open(path, encoding="utf8") as f:
        return json.load(f)

def shape(service):
    part = service.get("spec", {}).get("template", {}).get("spec", {})
    if not isinstance(part, dict) or len(part.get("containers", [])) != 1:
        deny("SERVICE_TEMPLATE_SHAPE")
    return part

def env(service):
    entries = shape(service)["containers"][0].get("env", [])
    if not isinstance(entries, list):
        deny("SERVICE_ENV_SHAPE")
    result = {e.get("name"): e for e in entries if isinstance(e, dict)}
    if len(result) != len(entries) or None in result:
        deny("SERVICE_ENV_DUPLICATE_OR_INVALID")
    return result

def traffic(service):
    entries = service.get("status", {}).get("traffic", [])
    if not isinstance(entries, list):
        deny("TRAFFIC_SHAPE")
    return entries

def serving(service):
    try:
        active = [(t.get("revisionName", ""), int(t.get("percent", 0)))
                  for t in traffic(service) if int(t.get("percent", 0)) > 0]
    except (TypeError, ValueError):
        deny("TRAFFIC_PERCENT")
    if len(active) != 1 or active[0][1] != 100 or not REV_RE.fullmatch(active[0][0]):
        deny("TRAFFIC_NOT_ONE_HUNDRED")
    return active[0][0]

def fixed_dev(service):
    t = shape(service)
    if t.get("serviceAccountName") != RUNTIME_SA:
        deny("RUNTIME_SERVICE_ACCOUNT_CHANGED")
    values = {k: v.get("value") for k, v in env(service).items()}
    for k, v in {"APP_ENV":"dev", "JSCC_RUNTIME_BACKEND":"gcp", "SEARCH_MODE":"disabled"}.items():
        if values.get(k) != v:
            deny("WRONG_DEV_SETTING_" + k)
    return True

def protected(service):
    """Ignore only server bookkeeping and explicitly permitted image/identity fields."""
    spec = deepcopy(service.get("spec", {}))
    if not isinstance(spec, dict):
        deny("SERVICE_SPEC_INVALID")
    spec.pop("traffic", None)
    tpl = spec.get("template", {})
    if not isinstance(tpl, dict):
        deny("SERVICE_TEMPLATE_INVALID")
    metadata = tpl.get("metadata", {})
    if isinstance(metadata, dict):
        anns = metadata.get("annotations", {})
        if isinstance(anns, dict):
            metadata["annotations"] = {k:v for k,v in anns.items() if k not in SERVER_ANNOTATIONS}
        # Revision labels can be created by the Cloud Run control-plane.
        metadata.pop("name", None)
    containers = tpl.get("spec", {}).get("containers", [])
    if len(containers) != 1:
        deny("SERVICE_CONTAINERS_CHANGED")
    containers[0].pop("image", None)
    containers[0]["env"] = sorted(
        (v for v in containers[0].get("env", []) if v.get("name") not in
         {"SOURCE_SHA", "RUNTIME_DATA_SHA"}), key=lambda x:x["name"])
    root = service.get("metadata", {}).get("annotations", {})
    if not isinstance(root, dict):
        deny("SERVICE_METADATA_INVALID")
    return spec, {k:v for k,v in root.items() if k not in SERVER_ANNOTATIONS}

def baseline(service, sha, tag):
    if not SHA_RE.fullmatch(sha) or not TAG_RE.fullmatch(tag) or tag != "gd"+sha[:10]:
        deny("INVALID_IDENTITY")
    fixed_dev(service)
    revision = serving(service)
    if any(t.get("tag")==tag for t in traffic(service)):
        deny("STAGE_TAG_COLLISION")
    print("JSCC_DEPLOY_BASELINE_REVISION=" + revision)
    print("JSCC_DEPLOY_BASELINE=PASS")
    return revision

def serving_revision_identity(service, revision, sha):
    """Only the actual 100%-serving revision can prove already-deployed SHA.

    Cloud Run service.spec.template describes the newest attempted revision,
    which may be unready or rolled back while the old revision still serves.
    """
    current = serving(service)
    if revision.get("metadata", {}).get("name") != current:
        deny("SERVING_REVISION_MISMATCH")
    spec = revision.get("spec", {})
    if (not isinstance(spec, dict) or
            spec.get("serviceAccountName") != RUNTIME_SA or
            not isinstance(spec.get("containers"), list) or
            len(spec["containers"]) != 1):
        deny("SERVING_REVISION_SHAPE")
    container = spec["containers"][0]
    if not isinstance(container, dict) or not isinstance(container.get("env"), list):
        deny("SERVING_REVISION_ENV_SHAPE")
    entries = container["env"]
    values = {row.get("name"): row.get("value") for row in entries if isinstance(row, dict)}
    if len(values) != len(entries) or None in values:
        deny("SERVING_REVISION_ENV_DUPLICATE")
    digest = revision.get("status", {}).get("imageDigest", "")
    if not isinstance(digest, str):
        deny("SERVING_REVISION_DIGEST_MISSING")
    digest = digest.rsplit("@", 1)[-1]
    if not DIGEST_RE.fullmatch(digest):
        deny("SERVING_REVISION_DIGEST_INVALID")
    if container.get("image") != IMAGE_REPO + "@" + digest:
        # Do not treat a mutable or different image as proof of a deployed SHA.
        return False
    if any(values.get(k) != v for k, v in {
            "APP_ENV": "dev", "JSCC_RUNTIME_BACKEND": "gcp",
            "SEARCH_MODE": "disabled"}.items()):
        return False
    if any(values.get(k) != sha for k in ("SOURCE_SHA", "RUNTIME_DATA_SHA")):
        return False
    # The template may be newer than the serving revision after failed stage.
    if any(env(service).get(k, {}).get("value") != sha
           for k in ("SOURCE_SHA", "RUNTIME_DATA_SHA")):
        return False
    if shape(service)["containers"][0].get("image") != IMAGE_REPO + "@" + digest:
        return False
    # No pending newer revision may be mistaken for an already-served SHA.
    status = service.get("status", {})
    if (status.get("latestCreatedRevisionName") != current or
            status.get("latestReadyRevisionName") != current):
        return False
    return True


def deployment_state(service, revision, sha, tag):
    """Resolve idempotence from the traffic-serving revision, never template alone."""
    if not SHA_RE.fullmatch(sha) or tag != "gd" + sha[:10] or not TAG_RE.fullmatch(tag):
        deny("INVALID_IDENTITY")
    fixed_dev(service)
    current = serving(service)
    # Always verify the revision snapshot is for the active 100%-traffic revision.
    already_serving = serving_revision_identity(service, revision, sha)
    matches = [row for row in traffic(service) if row.get("tag") == tag]
    if not matches:
        state = "ALREADY_SERVING" if already_serving else "NEW"
        print("JSCC_DEPLOY_STATE=" + state)
        return state
    if len(matches) != 1 or matches[0].get("revisionName") != current:
        deny("STAGE_TAG_COLLISION")
    try:
        percent = int(matches[0].get("percent", -1))
    except (TypeError, ValueError):
        deny("STAGE_TAG_COLLISION")
    if percent not in (0, 100):
        deny("STAGE_TAG_COLLISION")
    if not already_serving:
        deny("STAGE_TAG_SOURCE_MISMATCH")
    print("JSCC_DEPLOY_STATE=ALREADY_SERVING")
    return "ALREADY_SERVING"

def unchanged(before, after, sha, tag):
    baseline(before,sha,tag)
    fixed_dev(after)
    if serving(before) != serving(after):
        deny("CONCURRENT_TRAFFIC_CHANGE")
    if traffic(before) != traffic(after):
        deny("CONCURRENT_TAG_OR_TRAFFIC_CHANGE")
    if protected(before) != protected(after):
        deny("CONCURRENT_CONFIG_CHANGE")
    print("JSCC_DEPLOY_NO_DRIFT=PASS")

def stage(before, after, sha, tag):
    baseline(before,sha,tag)
    fixed_dev(after)
    if serving(after)!=serving(before):
        deny("EARLY_TRAFFIC_CUTOVER")
    if protected(before)!=protected(after):
        deny("STAGED_CONFIG_DRIFT")
    a,b=env(before),env(after)
    if set(a)!=set(b):
        deny("STAGED_ENV_KEYS_CHANGED")
    for name in ("SOURCE_SHA","RUNTIME_DATA_SHA"):
        if b.get(name,{}).get("value")!=sha:
            deny("STAGED_SOURCE_IDENTITY")
    for k in set(a)-{"SOURCE_SHA","RUNTIME_DATA_SHA"}:
        if a[k]!=b[k]:
            deny("STAGED_ENV_DRIFT")
    image=shape(after)["containers"][0].get("image","")
    if not image.startswith(IMAGE_REPO+"@sha256:") or not DIGEST_RE.fullmatch(image.split("@",1)[-1]):
        deny("STAGED_IMAGE_NOT_PINNED")
    added=[x for x in traffic(after) if x.get("tag")==tag and int(x.get("percent",0))==0]
    if len(added)!=1 or not REV_RE.fullmatch(added[0].get("revisionName","")):
        deny("STAGED_REVISION_NOT_UNIQUE")
    if sum(int(x.get("percent",0)) for x in traffic(after)) != 100:
        deny("STAGED_TOTAL_TRAFFIC")
    if not added[0].get("url","").startswith("https://"):
        deny("STAGED_TAG_URL_MISSING")
    print("JSCC_DEPLOY_STAGE_REVISION="+added[0]["revisionName"])
    print("JSCC_DEPLOY_STAGE_URL="+added[0]["url"])
    print("JSCC_DEPLOY_STAGE_CONFIG_PARITY=PASS")
    return added[0]["revisionName"]

def final(before, after, sha, tag, revision):
    baseline(before,sha,tag)
    fixed_dev(after)
    if serving(after)!=revision or revision==serving(before):
        deny("CUTOVER_WRONG_REVISION")
    if protected(before)!=protected(after):
        deny("CUTOVER_CONFIG_DRIFT")
    print("JSCC_DEPLOY_CUTOVER=PASS")

def rollback(before, after, sha, tag):
    if serving(after)!=serving(before):
        deny("ROLLBACK_TRAFFIC_UNVERIFIED")
    if protected(before)!=protected(after):
        deny("ROLLBACK_CONFIG_DRIFT")
    print("JSCC_DEPLOY_ROLLBACK=PASS")

def attest_build(builds, sha, digest):
    if not SHA_RE.fullmatch(sha) or not DIGEST_RE.fullmatch(digest):
        deny("BUILD_INPUT_INVALID")
    image=IMAGE_REPO+":"+sha
    for b in builds:
        if (b.get("status")=="SUCCESS" and b.get("serviceAccount")==BUILD_SA
                and b.get("substitutions",{}).get("_GIT_SHA")==sha
                and image in b.get("images",[]) and
                any(i.get("name")==image and i.get("digest")==digest
                    for i in b.get("results",{}).get("images",[]))):
            print("JSCC_DEPLOY_BUILD_PROVENANCE=PASS")
            return
    deny("BUILD_PROVENANCE_UNVERIFIED")

# Exact source of each required job; job names alone are not release evidence.
# In particular, Validate Remote Executor also produces a job named "validate".
REQUIRED_WORKFLOWS = {
    "validate": (".github/workflows/command-api-check.yml", "Validate Command API"),
    "Nile-only native provider CI": (
        ".github/workflows/command-api-check.yml", "Validate Command API"
    ),
    "gitleaks": (".github/workflows/secret-scanning.yml", "Secret scanning"),
    "api-version-policy": (
        ".github/workflows/cloud-run-api-version.yml",
        "Cloud Run Admin API v2 contract"
    ),
    "snapshot": (".github/workflows/project-sanity.yml", "Project sanity snapshot"),
}
REQUIRED_CHECKS = tuple(REQUIRED_WORKFLOWS)
DETAIL_URL = re.compile(
    r"https://github[.]com/Shosetzel69/job-search-command-center/"
    r"actions/runs/([0-9]+)/job/([0-9]+)\Z"
)

def run_id_for_check(check):
    if not isinstance(check, dict) or not isinstance(check.get("id"), int):
        return None
    match = DETAIL_URL.fullmatch(check.get("details_url") or "")
    if not match or int(match.group(2)) != check["id"]:
        return None
    return int(match.group(1))

def is_canonical_run(run, job_name, sha, run_id):
    expected_path, expected_name = REQUIRED_WORKFLOWS[job_name]
    return (
        isinstance(run, dict)
        and run.get("id") == run_id
        and run.get("path") == expected_path
        and run.get("name") == expected_name
        and run.get("event") == "push"
        and run.get("head_sha") == sha
        and run.get("head_branch") == "main"
    )

def newest_check_runs(payload, sha):
    """Select latest *canonical workflow* check by job ID, not latest same-name job."""
    if not SHA_RE.fullmatch(sha) or not isinstance(payload, dict):
        deny("EXACT_SHA_CI_INVALID_INPUT")
    checks = payload.get("check_runs")
    runs = payload.get("workflow_runs")
    if not isinstance(checks, list) or not isinstance(runs, dict):
        deny("EXACT_SHA_CI_INVALID_PAYLOAD")
    selected = {}
    for check in checks:
        if not isinstance(check, dict) or check.get("name") not in REQUIRED_WORKFLOWS:
            continue
        run_id = run_id_for_check(check)
        if run_id is None:
            continue
        job_name = check["name"]
        run = runs.get(str(run_id))
        if not is_canonical_run(run, job_name, sha, run_id):
            continue
        if check.get("head_sha") != sha or check.get("app", {}).get("slug") != "github-actions":
            deny("EXACT_SHA_CI_WRONG_JOB_IDENTITY")
        current = selected.get(job_name)
        if current is None or check["id"] > current["id"]:
            selected[job_name] = check
    if set(selected) != set(REQUIRED_WORKFLOWS):
        deny("EXACT_SHA_CI_MISSING_CANONICAL_WORKFLOW")
    return selected

def check_ci(payload, sha):
    for name, check in newest_check_runs(payload, sha).items():
        if check.get("status") != "completed" or check.get("conclusion") != "success":
            deny("EXACT_SHA_CI_LATEST_NOT_SUCCESS_" + re.sub(r"[^a-z0-9]+", "_", name.lower()))
    print("JSCC_DEPLOY_EXACT_SHA_CI=PASS")

def fetch_ci_snapshot(sha, output, fetch_json=None):
    """Fetch all latest check pages and bind every required job to its workflow run."""
    if not SHA_RE.fullmatch(sha):
        deny("EXACT_SHA_CI_INVALID_SHA")
    if fetch_json is None:
        def fetch_json(url):
            token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
            headers = {"Accept": "application/vnd.github+json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.load(response)
    root = "https://api.github.com/repos/Shosetzel69/job-search-command-center"
    gathered = []
    for name in REQUIRED_CHECKS:
        for page in range(1, 21):
            query = urllib.parse.urlencode({
                "check_name": name, "filter": "latest", "per_page": 100, "page": page
            })
            try:
                data = fetch_json(root + "/commits/" + sha + "/check-runs?" + query)
            except Exception:
                deny("EXACT_SHA_CI_REQUEST_FAILED")
            rows = data.get("check_runs") if isinstance(data, dict) else None
            if not isinstance(rows, list) or len(rows) > 100:
                deny("EXACT_SHA_CI_MALFORMED_PAGE")
            if any(not isinstance(row, dict) or row.get("name") != name for row in rows):
                deny("EXACT_SHA_CI_CHECK_NAME_MISMATCH")
            gathered.extend(rows)
            if len(rows) < 100:
                break
        else:
            deny("EXACT_SHA_CI_PAGINATION_LIMIT")
    ids = {rid for check in gathered if (rid := run_id_for_check(check)) is not None}
    if len(ids) > 500:
        deny("EXACT_SHA_CI_WORKFLOW_LOOKUP_LIMIT")
    runs = {}
    for run_id in sorted(ids):
        try:
            runs[str(run_id)] = fetch_json(root + "/actions/runs/" + str(run_id))
        except Exception:
            deny("EXACT_SHA_CI_WORKFLOW_LOOKUP_FAILED")
    snapshot = {"check_runs": gathered, "workflow_runs": runs}
    check_ci(snapshot, sha)
    with open(output, "w", encoding="utf8") as f:
        json.dump(snapshot, f)
    print("JSCC_DEPLOY_EXACT_SHA_CI_WORKFLOW_BOUND=PASS")

def check_release(release, sha, tag):
    if (not SHA_RE.fullmatch(sha) or not isinstance(tag,str)
        or not re.fullmatch(r"jscc-dev-v[0-9]+\.[0-9]+\.[0-9]+",tag)
        or release.get("tag_name")!=tag
        or release.get("draft") is not False
        or release.get("prerelease") is not False
        or release.get("author",{}).get("login")!="Shosetzel69"
        or not isinstance(release.get("id"),int)):
        deny("RELEASE_NOT_APPROVED")
    print("JSCC_DEPLOY_RELEASE_RECORD=PASS")


def check_health(obj, mode, sha):
    if (obj.get("status")!="ok" or obj.get("environment")!="dev" or
        obj.get("runtime_backend")!="gcp" or obj.get("search_mode")!="disabled"):
        deny("HEALTH_NOT_DEV")
    if mode=="staged" and (obj.get("source_sha")!=sha or obj.get("runtime_data_sha")!=sha):
        deny("HEALTH_SOURCE_MISMATCH")
    if mode not in ("baseline","staged"):
        deny("HEALTH_MODE_INVALID")
    print("JSCC_DEPLOY_AUTHENTICATED_HEALTH=PASS")

def check_db(obj):
    if obj.get("status")!="ok" or obj.get("database")!="jobsearch_dev":
        deny("DB_HEALTH_UNVERIFIED")
    print("JSCC_DEPLOY_AUTHENTICATED_DB=PASS")

def managed_tags(service):
    """Enumerate only protocol-owned traffic tags; reject ambiguous ownership."""
    tags = {}
    for row in traffic(service):
        name = row.get("tag")
        if not name:
            continue
        if not isinstance(name, str):
            deny("TAG_NAME_INVALID")
        if not TAG_RE.fullmatch(name):
            if name.startswith("gd"):
                deny("UNRECOGNIZED_MANAGED_TAG")
            continue
        revision = row.get("revisionName", "")
        if not REV_RE.fullmatch(revision):
            deny("MANAGED_TAG_REVISION_INVALID")
        try:
            percent = int(row.get("percent", -1))
        except (ValueError, TypeError):
            deny("MANAGED_TAG_TRAFFIC_INVALID")
        if percent not in (0, 100) or name in tags:
            deny("MANAGED_TAG_AMBIGUOUS")
        tags[name] = (revision, percent)
    return tags


def retire_plan(service, sha, revision):
    """Read-only plan: remove the owned gd* tags only after cutover + health."""
    if not SHA_RE.fullmatch(sha) or not REV_RE.fullmatch(revision):
        deny("TAG_RETIRE_IDENTITY_INVALID")
    fixed_dev(service)
    if serving(service) != revision:
        deny("TAG_RETIRE_NOT_SERVING")
    values = env(service)
    if any(values.get(k, {}).get("value") != sha for k in
           ("SOURCE_SHA", "RUNTIME_DATA_SHA")):
        deny("TAG_RETIRE_SOURCE_MISMATCH")
    image = shape(service)["containers"][0].get("image", "")
    if not image.startswith(IMAGE_REPO + "@") or not DIGEST_RE.fullmatch(image.split("@", 1)[-1]):
        deny("TAG_RETIRE_IMAGE_UNVERIFIED")
    tags = managed_tags(service)
    for tagged_revision, percent in tags.values():
        if percent == 100 and tagged_revision != revision:
            deny("TAG_RETIRE_SERVING_TAG_MISMATCH")
    result = ",".join(sorted(tags))
    print("JSCC_DEPLOY_TAG_RETIRE_PLAN=" + result)
    return result


def retire_verify(before, after, sha, revision):
    """Postcondition: serving revision, other tags and protected config intact."""
    retire_plan(before, sha, revision)
    fixed_dev(after)
    if serving(after) != revision:
        deny("TAG_RETIRE_TRAFFIC_DRIFT")
    if protected(before) != protected(after):
        deny("TAG_RETIRE_CONFIG_DRIFT")
    if (shape(before)["containers"][0].get("image") !=
            shape(after)["containers"][0].get("image")):
        deny("TAG_RETIRE_IMAGE_DRIFT")
    if managed_tags(after):
        deny("TAG_RETIRE_STALE_MANAGED_TAGS")
    def other_tags(service):
        return sorted((row.get("tag"), row.get("revisionName"),
                       int(row.get("percent", 0))) for row in traffic(service)
                      if row.get("tag") and not TAG_RE.fullmatch(row["tag"]))
    if other_tags(before) != other_tags(after):
        deny("TAG_RETIRE_UNRELATED_TAG_DRIFT")
    values = env(after)
    if any(values.get(k, {}).get("value") != sha for k in
           ("SOURCE_SHA", "RUNTIME_DATA_SHA")):
        deny("TAG_RETIRE_SOURCE_DRIFT")
    print("JSCC_DEPLOY_TAG_RETIRE_VERIFY=PASS")


def cleanup_tag(obj, sha, tag, digest, revision):
    if not SHA_RE.fullmatch(sha) or tag!="gd"+sha[:10] or not DIGEST_RE.fullmatch(digest):
        deny("CLEANUP_INVALID_IDENTITY")
    if not REV_RE.fullmatch(revision or ""):
        deny("CLEANUP_REVISION_UNKNOWN")
    matches=[x for x in traffic(obj) if x.get("tag")==tag]
    if len(matches)!=1 or matches[0].get("revisionName")!=revision or int(matches[0].get("percent",-1))!=0:
        deny("CLEANUP_TAG_NOT_OWNED")
    print("JSCC_DEPLOY_TAG_CLEANUP_OWNERSHIP=PASS")

def main(argv):
    if len(argv)<2:
        deny("INVALID_COMMAND")
    cmd=argv[1]
    if cmd=="serving" and len(argv)==3:
        print(serving(read(argv[2])))
        return
    if cmd=="health" and len(argv)==5:
        return check_health(read(argv[2]),argv[3],argv[4])
    if cmd=="db" and len(argv)==3:
        return check_db(read(argv[2]))
    if cmd=="retire-plan" and len(argv)==5:
        return retire_plan(read(argv[2]),argv[3],argv[4])
    if cmd=="retire-verify" and len(argv)==6:
        return retire_verify(read(argv[2]),read(argv[3]),argv[4],argv[5])
    if cmd=="cleanup-tag" and len(argv)==7:
        return cleanup_tag(read(argv[2]),argv[3],argv[4],argv[5],argv[6])
    if cmd=="fetch-ci" and len(argv)==4:
        return fetch_ci_snapshot(argv[2],argv[3])
    if cmd=="ci" and len(argv)==4:
        return check_ci(read(argv[2]),argv[3])
    if cmd=="release" and len(argv)==5:
        return check_release(read(argv[2]),argv[3],argv[4])
    if cmd=="attest" and len(argv)==5:
        return attest_build(read(argv[2]),argv[3],argv[4])
    if cmd=="deployment-state" and len(argv)==6:
        return deployment_state(read(argv[2]),read(argv[3]),argv[4],argv[5])
    if cmd=="baseline" and len(argv)==5:
        return baseline(read(argv[2]),argv[3],argv[4])
    if cmd in ("unchanged","stage","rollback") and len(argv)==6:
        return globals()[cmd](read(argv[2]),read(argv[3]),argv[4],argv[5])
    if cmd=="final" and len(argv)==7:
        return final(read(argv[2]),read(argv[3]),argv[4],argv[5],argv[6])
    deny("INVALID_COMMAND")

if __name__=="__main__":
    main(sys.argv)
