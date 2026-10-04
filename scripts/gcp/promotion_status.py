#!/usr/bin/env python3
import argparse, datetime, json, pathlib, re, subprocess

STEPS = [
    ("candidate-identity", "Candidate identity", "release"),
    ("immutable-artifacts", "Immutable Job/Service artifacts", "artifact-registry"),
    ("environment", "Environment mapping", "gcp"),
    ("dev-attestation", "DEV exact-candidate attestation", "release"),
    ("runtime-seed", "Runtime seed", "gcs"),
    ("secrets", "Required secrets", "secret-manager"),
    ("migration-job", "DB migration Job", "cloud-run"),
    ("db-migrations", "Candidate DB migrations", "postgresql"),
    ("schema-readiness", "Schema/checksum readiness", "postgresql"),
    ("db-privileges", "Runtime DB privilege readiness", "postgresql"),
    ("application-job", "Application search Job", "cloud-run"),
    ("job-iam", "Service -> Job IAM", "iam"),
    ("service", "Command API Service", "cloud-run"),
    ("traffic", "100% latest revision traffic", "cloud-run"),
    ("health", "Application health", "command-api"),
    ("db-health", "Database binding health", "postgresql"),
    ("auth-readiness", "Authentication readiness", "command-api"),
    ("evidence", "Promotion evidence", "release"),
]

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def sanitize(value):
    text = str(value or "")
    text = re.sub(r"postgres(?:ql)?://[^\s]+", "[REDACTED_DB_URL]", text, flags=re.I)
    text = re.sub(r"(?i)(token|secret|password)=([^\s,]+)", r"\1=[REDACTED]", text)
    return text[:500]

def upload(path, project, bucket):
    subprocess.run([
        "gcloud", "storage", "cp", str(path),
        f"gs://{bucket}/seed/promotion-status.json",
        "--project", project,
    ], check=True)

def load(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)

def save(path, payload, project, bucket):
    payload["updated_at"] = now()
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    upload(path, project, bucket)

parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest="action", required=True)

init = sub.add_parser("init")
for p in (init,):
    p.add_argument("--file", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--bucket", required=True)
init.add_argument("--environment", required=True, choices=["dev", "test"])
init.add_argument("--operation-id", required=True)
init.add_argument("--operation-type", required=True)
init.add_argument("--pipeline-sha", required=True)
init.add_argument("--candidate-sha", required=True)
init.add_argument("--job-digest", required=True)
init.add_argument("--service-digest", required=True)
init.add_argument("--dev-attestation", choices=["PASS", "N/A"], default="N/A")

mark = sub.add_parser("mark")
for p in (mark,):
    p.add_argument("--file", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--bucket", required=True)
mark.add_argument("--step", required=True)
mark.add_argument("--state", required=True, choices=["PENDING", "IN_PROGRESS", "PASS", "FAIL", "SKIPPED"])
mark.add_argument("--error")

finish = sub.add_parser("finish")
for p in (finish,):
    p.add_argument("--file", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--bucket", required=True)
finish.add_argument("--status", required=True, choices=["PASS", "FAIL"])
finish.add_argument("--error")

args = parser.parse_args()
path = pathlib.Path(args.file)

if args.action == "init":
    stamp = now()
    steps = []
    for step_id, description, component in STEPS:
        state = "PENDING"
        if step_id == "dev-attestation":
            state = args.dev_attestation
        steps.append({
            "id": step_id,
            "description": description,
            "component": component,
            "state": state,
            "started_at": stamp if state == "PASS" else None,
            "completed_at": stamp if state in ("PASS", "N/A") else None,
            "error": None,
        })
    payload = {
        "schema_version": "1.0",
        "environment": args.environment,
        "operation_id": args.operation_id,
        "operation_type": args.operation_type,
        "pipeline_sha": args.pipeline_sha,
        "candidate_sha": args.candidate_sha,
        "job_digest": args.job_digest,
        "service_digest": args.service_digest,
        "started_at": stamp,
        "updated_at": stamp,
        "completed_at": None,
        "status": "IN_PROGRESS",
        "current_step": None,
        "steps": steps,
    }
    save(path, payload, args.project, args.bucket)
elif args.action == "mark":
    payload = load(path)
    matches = [step for step in payload["steps"] if step["id"] == args.step]
    if len(matches) != 1:
        raise SystemExit(f"Unknown promotion step: {args.step}")
    step = matches[0]
    stamp = now()
    if args.state == "IN_PROGRESS" and not step.get("started_at"):
        step["started_at"] = stamp
    if args.state in ("PASS", "FAIL", "SKIPPED"):
        step["completed_at"] = stamp
    step["state"] = args.state
    step["error"] = sanitize(args.error) if args.error else None
    payload["current_step"] = args.step
    if args.state == "FAIL":
        payload["status"] = "FAIL"
    save(path, payload, args.project, args.bucket)
else:
    payload = load(path)
    if args.status == "PASS":
        incomplete = [step["id"] for step in payload["steps"] if step["state"] not in ("PASS", "N/A", "SKIPPED")]
        if incomplete:
            raise SystemExit(f"Cannot mark promotion PASS with incomplete steps: {' '.join(incomplete)}")
    payload["status"] = args.status
    payload["completed_at"] = now()
    payload["error"] = sanitize(args.error) if args.error else None
    if args.status == "PASS":
        payload["current_step"] = None
    save(path, payload, args.project, args.bucket)
