#!/usr/bin/env bash
# JSCC #589 F1: read-only Cloud Run v2 tasks.list probe.
# Uses Cloud SDK impersonation only for obtaining an access token.
# No IAM changes, no task execution, no token or task payload output.
set -euo pipefail
command -v python3 >/dev/null || { echo "BLOCKED: python3 missing" >&2; exit 3; }
command -v gcloud >/dev/null || { echo "BLOCKED: gcloud missing" >&2; exit 3; }
python3 - <<'PY'
import json
import subprocess
import sys
import urllib.error
import urllib.request

principal = "jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com"
project = "jscc-dev"
region = "europe-west1"
job = "jscc-diagnostics-dev"
execution = "jscc-diagnostics-dev-5lf4k"
url = (
    f"https://run.googleapis.com/v2/projects/{project}/locations/{region}"
    f"/jobs/{job}/executions/{execution}/tasks?pageSize=5"
)
try:
    token_result = subprocess.run(
        [
            "gcloud", "auth", "print-access-token",
            f"--impersonate-service-account={principal}",
            f"--project={project}",
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, timeout=30, check=False,
    )
    if token_result.returncode != 0:
        print(f"V2_PROBE_BLOCKED: impersonation_failed exit={token_result.returncode}")
        sys.exit(3)
    token = token_result.stdout.strip()
    if not token or "\n" in token or "\r" in token:
        print("V2_PROBE_BLOCKED: invalid_impersonated_token")
        sys.exit(3)
    request = urllib.request.Request(
        url,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = response.status
            # Bound response size. No raw metadata or token output.
            raw = response.read(131073)
            if len(raw) > 131072:
                print("V2_PROBE_BLOCKED: response_too_large")
                sys.exit(3)
            body = json.loads(raw)
    except urllib.error.HTTPError as exc:
        print(f"V2_TASKS_HTTP_STATUS={exc.code}")
        print("V2_TASKS_VERDICT=HTTP_DENIED" if exc.code == 403
              else "V2_TASKS_VERDICT=HTTP_ERROR")
        sys.exit(2)
    if status != 200 or not isinstance(body, dict):
        print("V2_TASKS_VERDICT=UNEXPECTED_RESPONSE")
        sys.exit(3)
    tasks = body.get("tasks", [])
    if not isinstance(tasks, list):
        print("V2_TASKS_VERDICT=INVALID_TASK_LIST")
        sys.exit(3)
    expected_prefix = (
        f"projects/{project}/locations/{region}/jobs/{job}"
        f"/executions/{execution}/tasks/"
    )
    if any(
        not isinstance(t, dict) or
        not isinstance(t.get("name"), str) or
        not t["name"].startswith(expected_prefix)
        for t in tasks
    ):
        print("V2_TASKS_VERDICT=EXECUTION_BINDING_MISMATCH")
        sys.exit(3)
    print("V2_TASKS_HTTP_STATUS=200")
    print(f"V2_TASK_COUNT_FIRST_PAGE={len(tasks)}")
    print("V2_TASKS_VERDICT=READ_GRANTED")
    print("NOTE: Cloud Shell impersonation PASS is not worker runtime E2E PASS.")
except (subprocess.TimeoutExpired, TimeoutError):
    print("V2_PROBE_BLOCKED: timeout")
    sys.exit(3)
except (urllib.error.URLError, json.JSONDecodeError, ValueError):
    print("V2_PROBE_BLOCKED: transport_or_response_error")
    sys.exit(3)
PY
