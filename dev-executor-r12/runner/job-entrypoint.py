#!/usr/bin/env python3
"""Fixed-input GCP Cloud Run Job entrypoint. No arbitrary command execution."""
import hashlib, hmac, json, os, pathlib, re, subprocess, sys, tempfile, urllib.parse, urllib.request, time
from executor import execute, GateError, REPO

BUCKET=re.compile(r'^jscc-[a-z0-9-]{3,55}$')
OBJECT=re.compile(r'^executor-input/[0-9a-f-]{36}\.json$')
PATCH=re.compile(r'^executor-patches/[0-9a-f-]{36}\.patch$')
SHA=re.compile(r'^[a-f0-9]{40}$')
LIMIT=200000
ADMISSION_KEY_ENV="JSCC_DEV_ADMISSION_HMAC_KEY"

def consume_admission(envelope,bucket,access,operation_id):
    """Authenticate and atomically consume a unique privileged-operation ticket."""
    action=envelope["action"]
    if action=="verify":return
    key=os.getenv(ADMISSION_KEY_ENV,"")
    if len(key)<32:raise GateError("admission_key_missing")
    ticket=envelope.get("admission")
    if not isinstance(ticket,dict) or set(ticket)!={"operation_id","action","manifest_digest","expires_at","nonce"}:
        raise GateError("admission_invalid")
    if ticket["operation_id"]!=operation_id or ticket["action"]!=action:
        raise GateError("admission_operation_mismatch")
    if type(ticket["expires_at"]) is not int or not int(time.time())<=ticket["expires_at"]<=int(time.time())+600:
        raise GateError("admission_expired")
    if not re.fullmatch(r"[a-f0-9]{32}",str(ticket["nonce"])):
        raise GateError("admission_nonce_invalid")
    digest=hashlib.sha256(json.dumps(envelope["manifest"],sort_keys=True,separators=(",",":")).encode()).hexdigest()
    if not hmac.compare_digest(digest,str(ticket["manifest_digest"])):
        raise GateError("admission_manifest_mismatch")
    signed=json.dumps(ticket,sort_keys=True,separators=(",",":")).encode()
    expected=hmac.new(key.encode(),signed,hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,str(envelope.get("admission_signature", ""))):
        raise GateError("admission_signature_invalid")
    # GCS generation precondition zero gives a durable, single-consumer receipt.
    # If the write fails for any reason, no privileged action is executed.
    try:
        gs_write(bucket,f"executor-admissions/{operation_id}.json",access,json.dumps({"consumed":True,"operation_id":operation_id,"action":action}).encode())
    except Exception as exc:raise GateError("admission_already_consumed_or_unavailable") from exc


def token():
    r=urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',headers={'Metadata-Flavor':'Google'})
    with urllib.request.urlopen(r,timeout=6) as f: return json.load(f)['access_token']

def gs_read(bucket,obj,access,maxbytes,generation=None):
    if generation is not None and not re.fullmatch(r"[1-9][0-9]{0,19}",str(generation)):
        raise GateError("invalid_gcs_generation")
    url=f'https://storage.googleapis.com/storage/v1/b/{bucket}/o/{urllib.parse.quote(obj,safe="")}?alt=media'
    if generation is not None: url+='&generation='+str(generation)
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+access})
    with urllib.request.urlopen(req,timeout=20) as f: data=f.read(maxbytes+1)
    if len(data)>maxbytes:raise GateError('object_too_large')
    return data

def gs_write(bucket,obj,access,data):
    url=f'https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={urllib.parse.quote(obj,safe="")}&ifGenerationMatch=0'
    req=urllib.request.Request(url,data=data,method='POST',headers={'Authorization':'Bearer '+access,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as f:return json.load(f)

def git(args,where=None):
    p=subprocess.run(['git',*args],cwd=where,capture_output=True,text=True,timeout=180)
    if p.returncode:raise GateError('repository_bootstrap_failed')
    return p.stdout.strip()

def bootstrap(root,sha):
    if not SHA.fullmatch(sha):raise GateError('invalid_base_sha')
    repo=root/'repo'
    git(['init',str(repo)])
    git(['remote','add','origin',f'https://github.com/{REPO}.git'],repo)
    git(['fetch','--no-tags','--depth=1','origin','main'],repo)
    if git(['rev-parse','FETCH_HEAD'],repo)!=sha: raise GateError('base_sha_stale')
    git(['update-ref','refs/remotes/origin/main',sha],repo)
    return repo

def main():
    bucket=os.getenv('JSCC_DEV_INPUT_BUCKET','')
    obj=os.getenv('JSCC_INPUT_OBJECT','')
    if not BUCKET.fullmatch(bucket) or not OBJECT.fullmatch(obj):raise GateError('input_not_allowlisted')
    access=token(); raw=gs_read(bucket,obj,access,LIMIT)
    envelope=json.loads(raw)
    if not isinstance(envelope,dict) or set(envelope)-{'action','manifest','patch_object','patch_generation','admission','admission_signature'} or not {'action','manifest'}<=set(envelope):raise GateError('invalid_envelope')
    action=envelope['action']; manifest=envelope['manifest']
    if not isinstance(manifest,dict):raise GateError('invalid_manifest')
    if action not in ('verify','implement','publish','merge','deploy'):raise GateError('action_not_allowlisted')
    patch_obj=envelope.get('patch_object')
    if (action in ('implement','publish'))!=bool(patch_obj):raise GateError('patch_reference_required_or_disallowed')
    if patch_obj and not PATCH.fullmatch(patch_obj):raise GateError('invalid_patch_reference')
    generation=envelope.get('patch_generation')
    if patch_obj and not re.fullmatch(r'[1-9][0-9]{0,19}',str(generation or '')):raise GateError('patch_generation_required')
    if not patch_obj and generation is not None:raise GateError('unexpected_patch_generation')
    operation_id=obj.split('/')[-1][:-5]
    consume_admission(envelope,bucket,access,operation_id)
    with tempfile.TemporaryDirectory(prefix='jscc-dev-run-') as tmp:
        root=pathlib.Path(tmp); evidence=root/'evidence'; evidence.mkdir()
        patch_path=None
        try:
            # Checkout from exact main HEAD; credentials are never embedded in the image.
            repo=bootstrap(root,manifest.get('base_sha',''))
            if patch_obj:
                patch=gs_read(bucket,patch_obj,access,2_000_000,generation)
                if hashlib.sha256(patch).hexdigest()!=manifest.get('patch_sha256'):raise GateError('patch_digest_mismatch')
                patch_path=root/'candidate.patch';patch_path.write_bytes(patch)
            result=execute(manifest,action,repo,patch_path,evidence)
        except Exception as e:
            result={'status':'FAIL','action':action,'error_code':type(e).__name__}
            (evidence/'result.json').write_text(json.dumps(result))
        # Persist bounded structured evidence with conditional create to prevent overwrite.
        operation_id=obj.split('/')[-1][:-5]
        report={'status':result.get('status'),'action':action,'operation_id':operation_id,'steps':result.get('steps',[]),'error_code':str(result.get('error_code') or result.get('error') or '')[:240]}
        gs_write(bucket,f'executor-evidence/{operation_id}.json',access,json.dumps(report,sort_keys=True).encode())
        print(json.dumps(report))
        return 0 if result.get('status')=='PASS' else 1

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:
        print(json.dumps({'status':'FAIL','error_code':type(e).__name__}),file=sys.stderr)
        sys.exit(1)
