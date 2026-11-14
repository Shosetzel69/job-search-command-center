#!/usr/bin/env python3
"""#520: GOV85 DEV paired release read-only preflight. No deployment or writes.

Reuses existing authenticated gcloud identity, Cloud Build, Artifact Registry,
Cloud Run v2 and the canonical lock. Never prints credentials, raw resources,
database URL, user data or source records. Unknown evidence is a stop.
"""
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

try:
    from .cloud_run_v2_read import fetch_v2, fetch_revision, primary_revision, revision_image, stage_preflight, get
except ImportError:
    from cloud_run_v2_read import fetch_v2, fetch_revision, primary_revision, revision_image, stage_preflight, get

APP = "ee576304cb4ae1a59ff6f0dc6b173234be78bd52"
BUILD_CONTROL = "774fc34d0617b85ae2253db5333a869e399405e0"
OLD = "121f88e212013d2c4665bb70f881a3bcee365d21"
P, R = "jscc-dev", "europe-west1"
S, J, M = "jscc-command-api-dev", "jscc-search-dev", "jscc-db-migrate-dev"
BUCKET = "jscc-dev-runtime-828902654738"
REG = "europe-west1-docker.pkg.dev/jscc-shared/jscc/"
OLD_IMAGES = {
    "jscc": REG + "jscc@sha256:9a205236cfd6e7842ad0ded7d4f32866aab9a86a876dc4cc6ae93e4cb4fcac97",
    "jscc-service": REG + "jscc-service@sha256:03e0e979c4499d32bd68109031128ed877e5d28ad787a0010f4ae67fdd94dffd",
}
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
BUILD_ID = re.compile(r"^[0-9a-f-]{36}$")


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def gc(*args):
    p = subprocess.run(["gcloud", *args], capture_output=True, text=True, timeout=60)
    require(p.returncode == 0, "GCLOUD_READ_FAILED")
    return p.stdout.strip()


def emit(**data):
    print(json.dumps(data, sort_keys=True), flush=True)


def one_container(template):
    containers = template.get("containers") or []
    require(len(containers) == 1, "CONTAINER_LAYOUT_UNVERIFIED")
    return containers[0]


def env_entry(container, name):
    values = [x for x in container.get("env", []) if x.get("name") == name]
    require(len(values) == 1, "ENV_BINDING_UNVERIFIED_" + name)
    return values[0]


def literal(container, name, expected):
    require(env_entry(container, name).get("value") == expected, "ENV_DRIFT_" + name)


def pinned_secret(container, name):
    secret = env_entry(container, name).get("valueSource", {}).get("secretKeyRef", {})
    require(secret.get("secret") == "NILE_DATABASE_URL" and str(secret.get("version")) == "1",
            "SECRET_PIN_UNVERIFIED_" + name)


def pair():
    immutable = gc("artifacts", "repositories", "describe", "jscc", "--project=jscc-shared",
                   "--location=" + R, "--format=value(dockerConfig.immutableTags)")
    require(immutable.lower() == "true", "IMMUTABLE_TAGS_REQUIRED")
    result = {}
    for role in OLD_IMAGES:
        digest = gc("artifacts", "docker", "images", "describe", REG + role + ":" + APP,
                    "--project=jscc-shared", "--format=value(image_summary.digest)")
        require(DIGEST.fullmatch(digest), "IMAGE_DIGEST_UNVERIFIED_" + role)
        result[role] = REG + role + "@" + digest
    require(len(set(result.values())) == 2, "PAIR_UNVERIFIED")
    return result


def build_record():
    rows = json.loads(gc("builds", "list", "--project=jscc-shared", "--region=" + R,
                         "--filter=substitutions._GIT_SHA=" + APP,
                         "--format=json"))
    matches = [x for x in rows if x.get("status") == "SUCCESS"
               and x.get("substitutions", {}).get("_GIT_SHA") == APP
               and x.get("substitutions", {}).get("_CONTROL_SHA") == BUILD_CONTROL]
    require(len(matches) == 1, "EXACT_BUILD_RECORD_UNVERIFIED")
    item = matches[0]
    require(BUILD_ID.fullmatch(item.get("id", "")), "BUILD_ID_UNVERIFIED")
    require(item.get("serviceAccount", "").endswith("/jscc-build@jscc-shared.iam.gserviceaccount.com"),
            "BUILD_IDENTITY_UNVERIFIED")
    ids = [step.get("id") for step in item.get("steps", [])]
    require(ids == ["verify-exact-source-and-registry", "test-python-collection-contract",
                   "test-frontend-pagination-progress", "build-search-job", "build-service",
                   "push-search-job", "push-service", "verify-two-digests"], "BUILD_RECIPE_UNVERIFIED")
    return item["id"]


def terminal_executions(job_name, token):
    parent = f"https://run.googleapis.com/v2/projects/{P}/locations/{R}/jobs/{job_name}/executions"
    count = 0
    seen = set()
    page = ""
    while True:
        query = {"pageSize": 100}
        if page:
            query["pageToken"] = page
        data = get(parent + "?" + urllib.parse.urlencode(query), token)
        for execution in data.get("executions", []):
            require(bool(execution.get("completionTime")), "ACTIVE_EXECUTION_" + job_name)
            count += 1
        page = data.get("nextPageToken", "")
        if not page:
            return count
        require(page not in seen, "EXECUTION_PAGINATION_UNVERIFIED")
        seen.add(page)


def storage_metadata(name, token, missing):
    url = ("https://storage.googleapis.com/storage/v1/b/" + BUCKET + "/o/"
           + urllib.parse.quote(name, safe=""))
    try:
        result = get(url, token)
    except urllib.error.HTTPError as e:
        require(missing and e.code == 404, "STORAGE_STATE_UNVERIFIED_" + name)
        return None
    require(not missing, "ACTIVE_OR_LOCK_MARKER_PRESENT_" + name)
    generation = str(result.get("generation", ""))
    require(generation.isdigit(), "GENERATION_UNVERIFIED_" + name)
    return generation


def old_health(uri):
    require(uri.startswith("https://") and uri.endswith(".run.app"), "HEALTH_URI_UNVERIFIED")
    with urllib.request.urlopen(uri + "/health", timeout=20) as response:
        h = json.load(response)
    with urllib.request.urlopen(uri + "/health/db", timeout=20) as response:
        d = json.load(response)
    require(all(h.get(k) == v for k, v in {
        "status": "ok", "environment": "dev", "source_sha": OLD, "runtime_data_sha": OLD,
        "search_mode": "disabled", "runtime_backend": "gcp",
    }.items()), "OLD_SERVICE_HEALTH_UNVERIFIED")
    require(all(d.get(k) == v for k, v in {
        "status": "ok", "environment": "dev", "database": "jobsearch_dev",
    }.items()), "OLD_DB_HEALTH_UNVERIFIED")


def main():
    require(len(sys.argv) == 1, "READ_ONLY_NO_ARGUMENTS")
    images = pair()
    record = build_record()
    emit(gate="ARTIFACT_PAIR", verdict="PASS", app_sha=APP, build_id=record, images=images,
         provenance="CLOUD_BUILD_RECORD_AND_IMMUTABLE_TAGS; manual checkout evidence owner-reported")
    s = fetch_v2(P, R, "services", S)
    stage_preflight(s)
    rev = primary_revision(s)
    require(s["latestReadyRevision"].rsplit("/", 1)[-1] == rev, "SERVICE_TEMPLATE_DRIFT")
    effective = fetch_revision(P, R, S, rev)
    require(revision_image(effective) == OLD_IMAGES["jscc-service"], "SERVING_IMAGE_DRIFT")
    sc = one_container(s["template"])
    ec = one_container(effective)
    require(sc.get("image") == OLD_IMAGES["jscc-service"], "SERVICE_TEMPLATE_IMAGE_DRIFT")
    for c in (sc, ec):
        literal(c, "APP_ENV", "dev")
        literal(c, "SOURCE_SHA", OLD)
        literal(c, "RUNTIME_DATA_SHA", OLD)
        literal(c, "GCP_SEARCH_JOB", J)
        literal(c, "GCP_RUNTIME_BUCKET", BUCKET)
        pinned_secret(c, "NILE_DATABASE_URL")
    job = fetch_v2(P, R, "jobs", J)
    migration = fetch_v2(P, R, "jobs", M)
    jc = one_container(job["template"]["template"])
    mc = one_container(migration["template"]["template"])
    require(jc.get("image") == OLD_IMAGES["jscc"], "SEARCH_IMAGE_DRIFT")
    literal(jc, "APP_ENV", "dev")
    literal(jc, "SOURCE_SHA", OLD)
    literal(jc, "GCP_RUNTIME_BUCKET", BUCKET)
    pinned_secret(jc, "NILE_DATABASE_URL")
    literal(mc, "APP_ENV", "dev")
    literal(mc, "DB_MIGRATION_MODE", "refuse")
    pinned_secret(mc, "NILE_DATABASE_URL")
    pinned_secret(mc, "NILE_MIGRATION_DATABASE_URL")
    require(DIGEST.search(str(mc.get("image", "")).rsplit("@", 1)[-1]), "MIGRATION_IMAGE_UNVERIFIED")
    old_health(s["uri"])
    token = gc("auth", "print-access-token")
    require(bool(token), "AUTH_UNVERIFIED")
    search_count = terminal_executions(J, token)
    migrate_count = terminal_executions(M, token)
    for marker in ("locks/heavy-search.lock", "active.json"):
        storage_metadata(marker, token, missing=True)
    catalog = storage_metadata("seed/sources.json", token, missing=False)
    emit(gate="RUNTIME_BASELINE", verdict="PASS", old_sha=OLD, revision=rev,
         old_images=OLD_IMAGES, migration_image=mc["image"], search_executions=search_count,
         migration_executions=migrate_count, source_catalog_generation=catalog)
    # A health endpoint cannot attest the managed Nile migration ledger.
    # Snapshot is not a lock, rollback backup or proof of compatibility.
    emit(gate="RELEASE", verdict="BLOCKED", reason="MANAGED_NILE_011_INSPECT_AND_ROLLBACK_COMPATIBILITY_REQUIRED",
         lock_acquired=False, deployed=False, database_mutated=False)
    return 86


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        message = str(error)
        emit(gate="PREFLIGHT", verdict="BLOCKED",
             reason=message if re.fullmatch(r"[A-Z0-9_./-]+", message) else "UNVERIFIED",
             deployed=False, database_mutated=False)
        sys.exit(86)
    except Exception:
        emit(gate="PREFLIGHT", verdict="BLOCKED", reason="PROVIDER_OR_RESPONSE_UNVERIFIED",
             deployed=False, database_mutated=False)
        sys.exit(86)
