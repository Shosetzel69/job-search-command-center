#!/usr/bin/env bash
# #589 F2 evidence: GET Cloud Run v2 service API and print only allowlisted keys.
# Never writes raw API responses or OAuth tokens; no IAM or deployment changes.
set -Eeuo pipefail
[[ "$(gcloud config get-value project 2>/dev/null)" == "jscc-dev" ]] || {
  echo 'BLOCKED: expected jscc-dev' >&2; exit 2;
}
python3 - <<'PY'
import json
import subprocess
import urllib.request

project='jscc-dev'
region='europe-west1'
names=(
  'jscc-dev-workspace-manager',
  'jscc-dev-sandbox-worker',
  'jscc-ops-gateway-dev',
  'jscc-command-api-dev',
)
token=subprocess.check_output(
    ['gcloud','auth','print-access-token'],text=True,stderr=subprocess.DEVNULL
).strip()
if not token or len(token)>8192:
    raise SystemExit('BLOCKED: cannot obtain user token')
for service in names:
    resource=f'projects/{project}/locations/{region}/services/{service}'
    url='https://run.googleapis.com/v2/'+resource
    req=urllib.request.Request(
        url,
        headers={'Authorization':'Bearer '+token,'Accept':'application/json'},
        method='GET'
    )
    with urllib.request.urlopen(req,timeout=12) as response:
        if response.status!=200:
            raise SystemExit('BLOCKED: v2 response not 200 for '+service)
        raw=response.read(128*1024+1)
    if len(raw)>128*1024:
        raise SystemExit('BLOCKED: upstream response too large')
    data=json.loads(raw)
    if data.get('name')!=resource:
        raise SystemExit('BLOCKED: cross-project resource mismatch')
    # Intentionally project *only* traffic fields. Never print templates,
    # containers.env, IAM, build substitutions, annotations, or secrets.
    allowed_rows=[]
    for item in data.get('trafficStatuses',[]):
        if not isinstance(item,dict):
            raise SystemExit('BLOCKED: malformed traffic')
        allowed_rows.append({
           k:item[k] for k in ('type','revision','percent')
           if k in item
        })
    output={
      'service':service,
      'name':resource,
      'reconciling':data.get('reconciling'),
      'latestReadyRevision':data.get('latestReadyRevision'),
      'trafficStatuses':allowed_rows,
    }
    print('R1B_V2_SANITIZED_FIXTURE='+json.dumps(output,separators=(',',':')))
print('R1B_V2_FIXTURE_CAPTURE_PASS')
PY
