"""Finalize one Cloud Run collection attempt without overwriting concurrent state."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def finalize(*, env=None, request=None):
    env = os.environ if env is None else env
    request = urllib.request.urlopen if request is None else request
    run_id = env["JSCC_RUN_ID"]
    bucket = env["GCP_RUNTIME_BUCKET"]
    generation = env["GCP_CURRENT_GENERATION"]
    with open(os.path.join(env["JSCC_RUNTIME_DATA_DIR"], "run-status.json"), encoding="utf-8") as stream:
        status = json.load(stream)
    if status.get("run_id") != run_id:
        raise RuntimeError("Finalizer run ownership mismatch")
    token_request = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    token = json.load(request(token_request))["access_token"]
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    base = ("https://storage.googleapis.com/upload/storage/v1/b/"
            + urllib.parse.quote(bucket, safe="") + "/o?uploadType=media&name=")

    def upload(name, content, expected):
        url = base + urllib.parse.quote(name, safe="") + "&ifGenerationMatch=" + str(expected)
        body = json.dumps(content).encode("utf-8")
        return request(urllib.request.Request(url, data=body, method="POST", headers=headers))

    record = {
        "run_id": run_id,
        "status": status.get("status"),
        "completed_at": status.get("completed_at"),
        "cloud_run_execution": env.get("CLOUD_RUN_EXECUTION"),
        "artifact_identity": "runs/" + run_id + "/run-status.json",
    }
    upload("run-completions/" + run_id + ".json", record, "0")
    metadata_url = ("https://storage.googleapis.com/storage/v1/b/"
                    + urllib.parse.quote(bucket, safe="") + "/o/latest-run.json")
    try:
        metadata = json.load(request(urllib.request.Request(
            metadata_url, headers={"Authorization": "Bearer " + token})))
        expected = metadata["generation"]
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        expected = "0"
    upload("latest-run.json", record, expected)
    if status.get("status") not in ("completed", "completed_with_errors"):
        return
    upload("current.json", {
        "run_id": run_id, "artifact_identity": "runs/" + run_id + "/jobs.json",
    }, generation)


if __name__ == "__main__":
    finalize()
