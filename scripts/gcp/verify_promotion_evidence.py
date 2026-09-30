import argparse, json, re

p=argparse.ArgumentParser()
p.add_argument("--file", required=True)
p.add_argument("--environment", required=True, choices=["dev","test"])
p.add_argument("--candidate-sha", required=True)
args=p.parse_args()

with open(args.file,encoding="utf-8") as f:
    data=json.load(f)

assert data.get("schema_version")=="1.0", data
assert data.get("environment")==args.environment, data
assert data.get("candidate_sha")==args.candidate_sha, data
assert re.fullmatch(r"sha256:[0-9a-f]{64}", data.get("job_digest","")), data
assert re.fullmatch(r"sha256:[0-9a-f]{64}", data.get("service_digest","")), data
assert data.get("health")=="PASS", data
assert data.get("db_health")=="PASS", data
assert data.get("seed_manifest")=="PASS", data
print("PROMOTION_EVIDENCE_PASS")
