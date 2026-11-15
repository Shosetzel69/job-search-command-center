#!/usr/bin/env python3
"""DEV-only Cloud Run attempt supervisor; no new infrastructure.

The supervisor uses only stdlib before spawning the collector, so native
extensions cannot prevent initial status/failure publication. All releases
are generation-conditional and tied to the admitted run.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from .gcp_finalize_run import finalize
except ImportError:
    from gcp_finalize_run import finalize

RUN_ID = re.compile(r"run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
LOCK = "locks/heavy-search.lock"
ACTIVE = "active.json"


def now():
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, bucket, request=urllib.request.urlopen):
        self.request = request
        self.base = "https://storage.googleapis.com/storage/v1/b/" + urllib.parse.quote(bucket, safe="") + "/o/"
        with request(urllib.request.Request(
                "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                headers={"Metadata-Flavor": "Google"}), timeout=15) as response:
            token = json.load(response)["access_token"]
        self.headers = {"Authorization": "Bearer " + token}

    def read(self, name):
        url = self.base + urllib.parse.quote(name, safe="")
        with self.request(urllib.request.Request(url, headers=self.headers), timeout=20) as response:
            generation = str(json.load(response)["generation"])
        if not re.fullmatch(r"[1-9][0-9]*", generation):
            raise RuntimeError("Invalid run ownership generation")
        media = url + "?alt=media&generation=" + generation
        with self.request(urllib.request.Request(media, headers=self.headers), timeout=20) as response:
            return generation, json.load(response)

    def delete(self, name, generation):
        url = self.base + urllib.parse.quote(name, safe="") + "?ifGenerationMatch=" + generation
        with self.request(urllib.request.Request(url, headers=self.headers, method="DELETE"), timeout=20):
            pass


def admit(env):
    run_id = env.get("JSCC_RUN_ID", "")
    source = env.get("SOURCE_SHA", "")
    if (env.get("APP_ENV") != "dev" or env.get("CLOUD_RUN_JOB") != "jscc-search-dev"
            or env.get("GCP_RUNTIME_BUCKET") != "jscc-dev-runtime-828902654738"
            or not RUN_ID.fullmatch(run_id) or not re.fullmatch(r"[0-9a-f]{40}", source)
            or source != env.get("JSCC_JOB_BUILD_SHA")):
        raise RuntimeError("DEV supervisor scope denied")
    return run_id


def initial_status(descriptor):
    return {
        "schema_version": "1.0", "run_id": descriptor["run_id"], "status": "in_progress",
        "started_at": descriptor.get("started_at") or now(), "completed_at": None,
        "source_sha": descriptor.get("source_sha"),
        "request_signature": descriptor.get("request_signature"),
        "retrieve_scope": descriptor.get("retrieve_scope"),
        "sources": [], "sources_processed": 0, "failed_sources": [],
        "source_results": [], "records_inspected": 0, "jobs_published": 0,
        "excluded": 0, "limitations": [],
        "progress": {"sources_total": 0, "sources_processed": 0, "percent": 0},
    }


def read_status(path):
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def write_status(path, status):
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def failure_status(path, descriptor, reason):
    current = read_status(path)
    if current.get("run_id") != descriptor["run_id"]:
        current = initial_status(descriptor)
    current.update(status="failed", completed_at=now(), jobs_published=0)
    limitations = current.get("limitations")
    current["limitations"] = (limitations if isinstance(limitations, list) else []) + [reason]
    write_status(path, current)


def run(env=None, *, root=Path("/runtime"), storage=None, execute=subprocess.run, publish=finalize):
    env = dict(os.environ if env is None else env)
    run_id = admit(env)
    # Cloud Run retries reuse JSCC_RUN_ID. Never repeat provider/DB work,
    # overwrite the immutable snapshot, or delete another attempt's markers.
    if env.get("CLOUD_RUN_TASK_ATTEMPT") != "0":
        print("DEV_ATTEMPT_REPLAY_REFUSED", flush=True)
        return 1
    store = storage or Storage(env["GCP_RUNTIME_BUCKET"])
    lock_generation, descriptor = store.read(LOCK)
    active_generation, active = store.read(ACTIVE)
    if (descriptor != active or descriptor.get("run_id") != run_id
            or descriptor.get("source_sha") != env["SOURCE_SHA"]
            or (descriptor.get("request_signature") or "") != env.get("JSCC_REQUEST_SIGNATURE", "")
            or (descriptor.get("retrieve_scope") or {}) != json.loads(env.get("JSCC_RETRIEVE_SCOPE_JSON") or "{}")):
        raise RuntimeError("DEV supervisor run ownership denied")
    run_dir = root / "runs" / run_id
    # A new run ID cannot reuse debris from a previous invocation.
    run_dir.mkdir(parents=True, exist_ok=False)
    env["JSCC_RUNTIME_DATA_DIR"] = str(run_dir)
    path = run_dir / "run-status.json"
    write_status(path, initial_status(descriptor))
    rc = 1
    phase = "seed"
    try:
        for name in ("search-config.json", "search-state.json"):
            shutil.copyfile(root / "seed" / name, run_dir / name)
        phase = "snapshot"
        print("DEV_RUN_PHASE=snapshot", flush=True)
        snapshot = execute([sys.executable, "-X", "faulthandler", "scripts/gcp_source_snapshot.py",
                            str(run_dir / "sources.json")], env=env)
        if snapshot.returncode != 0:
            raise RuntimeError("snapshot_failed")
        phase = "collector"
        print("DEV_RUN_PHASE=collector", flush=True)
        result = execute([sys.executable, "-X", "faulthandler", "scripts/job_search_runner.py"], env=env)
        rc = result.returncode
        status = read_status(path)
        if rc != 0 or status.get("run_id") != run_id or status.get("status") not in (
                "completed", "completed_with_errors"):
            failure_status(path, descriptor, "collector_exit:" + str(rc))
            rc = 1
    except Exception:
        failure_status(path, descriptor, "launcher_failure:" + phase)
        rc = 1
    # Never publish or unlock if ownership has changed, or if finalization fails.
    if store.read(LOCK) != (lock_generation, descriptor) or store.read(ACTIVE) != (active_generation, active):
        raise RuntimeError("DEV run ownership changed before finalization")
    publish(env=env)
    store.delete(ACTIVE, active_generation)
    store.delete(LOCK, lock_generation)
    print("DEV_RUN_FINALIZED=" + ("PASS" if rc == 0 else "FAILED"), flush=True)
    return rc


if __name__ == "__main__":
    raise SystemExit(run())
