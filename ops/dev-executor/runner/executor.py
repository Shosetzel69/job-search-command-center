#!/usr/bin/env python3
"""JSCC DEV R2: controlled GCP-side worktree/patch/test/GitHub/deploy executor.
No HTTP entry point. Invoke only from an authenticated gateway/Cloud Run Job.
"""
import argparse, hashlib, hmac, json, os, pathlib, re, shutil, subprocess, tempfile, time, urllib.request, urllib.parse

SHA=re.compile(r'^[0-9a-f]{40}$')
BRANCH=re.compile(r'^dev/[a-z0-9][a-z0-9._/-]{2,75}$')
ITEM=re.compile(r'^(?:ATC-[0-9]+-[0-9]+|#[0-9]+)$')
TESTS={'ops-check':['npm','run','check'],'ops-test':['npm','test']}
ACTIONS=('verify','implement','publish','merge','deploy')
REPO='Shosetzel69/job-search-command-center'

class GateError(ValueError): pass

def run(args,cwd=None,check=True,timeout=300,env=None):
    p=subprocess.run(args,cwd=cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if check and p.returncode: raise GateError(f'command_failed_{args[0]}_{p.returncode}')
    return p

def manifest_validate(m,action):
    if type(m) is not dict or action not in ACTIONS: raise GateError('invalid_manifest_or_action')
    if not ITEM.fullmatch(str(m.get('work_item_ref',''))): raise GateError('invalid_work_item')
    if not SHA.fullmatch(str(m.get('base_sha',''))): raise GateError('invalid_base_sha')
    if not BRANCH.fullmatch(str(m.get('branch',''))) or '..' in m['branch'] or '//' in m['branch'] or m['branch'].endswith('/'): raise GateError('invalid_branch')
    if m.get('repository')!=REPO: raise GateError('repository_not_allowlisted')
    suites=m.get('suites',[])
    if type(suites) is not list or not suites or any(x not in TESTS for x in suites) or len(suites)>2 or len(set(suites))!=len(suites):raise GateError('invalid_test_suites')
    if action in ('implement','publish'):
        if type(m.get('patch_sha256')) is not str or not re.fullmatch('[0-9a-f]{64}',m['patch_sha256']):raise GateError('patch_digest_required')
    if action=='merge':
        if type(m.get('pr_number')) is not int or m['pr_number']<=0 or not SHA.fullmatch(str(m.get('expected_head_sha',''))):raise GateError('merge_expectations_required')
    if action=='deploy' and not SHA.fullmatch(str(m.get('deploy_sha',''))):raise GateError('deploy_sha_required')
    return m

def approval_check(m,action):
    """Gateway/backend-issued action-bound HMAC attestation. NOT client-approved boolean."""
    if action=='verify':return
    key=os.getenv('JSCC_DEV_APPROVAL_HMAC_KEY','')
    if len(key)<32:raise GateError('server_approval_key_unconfigured')
    a=m.get('approval')
    if not isinstance(a,dict):raise GateError('approval_missing')
    for field in ('work_item_ref','action','base_sha','branch'):
        if a.get(field)!=({'action':action,**m}.get(field) if field!='action' else action):raise GateError('approval_binding_mismatch')
    if a.get('repository')!=REPO:raise GateError('approval_repository_mismatch')
    now=int(time.time())
    if type(a.get('expires_at')) is not int or not now<=a['expires_at']<=now+3600:raise GateError('approval_expired_or_invalid')
    if action in ('implement','publish') and a.get('patch_sha256')!=m['patch_sha256']:raise GateError('approval_patch_mismatch')
    if action=='merge' and (a.get('pr_number')!=m['pr_number'] or a.get('expected_head_sha')!=m['expected_head_sha']):raise GateError('approval_merge_mismatch')
    if action=='deploy' and a.get('deploy_sha')!=m['deploy_sha']:raise GateError('approval_deploy_mismatch')
    mac=m.get('approval_signature','')
    body=json.dumps(a,sort_keys=True,separators=(',',':')).encode()
    correct=hmac.new(key.encode(),body,hashlib.sha256).hexdigest()
    if not isinstance(mac,str) or not hmac.compare_digest(mac,correct):raise GateError('approval_signature_invalid')

def gate_flag(action):
    if action in ('implement','publish','merge','deploy') and os.getenv('JSCC_DEV_ENABLE_'+action.upper())!='true':
        raise GateError('capability_disabled_'+action)

def git_base(repo,sha):
    run(['git','fetch','--no-tags','origin','main'],repo,timeout=120)
    found=run(['git','rev-parse','refs/remotes/origin/main'],repo).stdout.strip()
    if found!=sha:raise GateError('base_sha_stale')
    origin=run(['git','remote','get-url','origin'],repo).stdout.strip()
    if origin not in ('https://github.com/'+REPO+'.git','https://github.com/'+REPO,'git@github.com:'+REPO+'.git'):
        raise GateError('unexpected_git_remote')

def patch_validate(patch,sha):
    b=patch.read_bytes()
    if len(b)>2_000_000 or hashlib.sha256(b).hexdigest()!=sha:raise GateError('patch_size_or_digest_invalid')
    if b'GIT binary patch' in b or b'Binary files ' in b:raise GateError('binary_patch_disallowed')
    paths=[]
    for line in b.decode('utf8').splitlines():
        if line.startswith('+++ b/') or line.startswith('--- a/'):
            path=line[6:]
            if path=='/dev/null':continue
            p=pathlib.PurePosixPath(path)
            if p.is_absolute() or '..' in p.parts or any(part in ('', '.', '..', '.git') for part in p.parts) or '\\' in path or path.startswith('ops/node_modules/') or path.startswith('.github/workflows/'):
                raise GateError('unsafe_patch_path')
            paths.append(path)
    if not paths:raise GateError('empty_patch')
    if any(path.startswith('.github/') or path.startswith('ops/src/gateway') or path.startswith('ops/src/lib.mjs') for path in paths):raise GateError('protected_path_requires_separate_review')
    return paths

def ghjson(args,cwd=None):
    if not os.getenv('GH_TOKEN'):raise GateError('github_credential_missing')
    x=run(['gh','api',*args],cwd,timeout=90)
    return json.loads(x.stdout)

def execute_cloud_run_job(project,region,job):
    # Use the attached GCP workload identity, not an embedded credential or gcloud CLI.
    req=urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',headers={'Metadata-Flavor':'Google'})
    with urllib.request.urlopen(req,timeout=8) as response:
        token=json.load(response).get('access_token')
    if not token: raise GateError('workload_identity_unavailable')
    url=f'https://run.googleapis.com/v2/projects/{project}/locations/{region}/jobs/{job}:run'
    req=urllib.request.Request(url,data=b'{}',method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=25) as response:
        operation=json.load(response)
    name=operation.get('name','')
    if not name.startswith(f'projects/{project}/locations/{region}/operations/'):
        raise GateError('deployment_operation_unverified')
    deadline=time.monotonic()+900
    while time.monotonic()<deadline:
        req=urllib.request.Request('https://run.googleapis.com/v2/'+name,headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(req,timeout=20) as response: data=json.load(response)
        if data.get('done'):
            if data.get('error'):raise GateError('deployment_job_failed')
            return name
        time.sleep(5)
    raise GateError('deployment_wait_timeout')

def execute(m,action,repo,patch,ev):
    result={'action':action,'work_item_ref':m['work_item_ref'],'base_sha':m['base_sha'],'status':'STARTED','steps':[]}
    wt=None
    try:
        manifest_validate(m,action);approval_check(m,action);gate_flag(action)
        if action=='merge':
            git_base(repo,m['base_sha'])
            pr=ghjson([f'repos/{REPO}/pulls/{m["pr_number"]}'])
            if pr['head']['repo']['full_name']!=REPO or pr['base']['repo']['full_name']!=REPO: raise GateError('unexpected_pr_repository')
            if pr['state']!='open' or pr['head']['sha']!=m['expected_head_sha'] or pr['base']['ref']!='main' or pr['head']['ref']!=m['branch'] or pr.get('draft') or pr.get('mergeable') is not True:
                raise GateError('pull_request_preconditions_failed')
            from github_gates import verify_merge_gates
            verify_merge_gates(m['pr_number'],m['expected_head_sha'])
            # GitHub branch rules remain authoritative; no bypass. Enforce head SHA.
            response=ghjson(['--method','PUT',f'repos/{REPO}/pulls/{m["pr_number"]}/merge','-f','merge_method=squash','-f',f'sha={m["expected_head_sha"]}'])
            if response.get('merged') is not True:raise GateError('github_merge_not_confirmed')
            result['merge_sha']=response.get('sha');result['steps'].append('squash_merge_success')
        elif action=='deploy':
            if os.getenv('JSCC_DEV_DEPLOY_JOB','')=='':raise GateError('deployment_job_unconfigured')
            # Deployment job must be configured for immutable, SHA-pinned release by platform owner.
            project=os.getenv('GOOGLE_CLOUD_PROJECT','jscc-dev');region=os.getenv('JSCC_DEV_REGION','')
            if not re.fullmatch(r'[a-z]+(?:-[a-z0-9]+)+[0-9]',region):raise GateError('invalid_region')
            if os.getenv('JSCC_DEV_DEPLOY_SHA')!=m['deploy_sha']:raise GateError('immutable_deploy_sha_not_pinned')
            job=os.environ['JSCC_DEV_DEPLOY_JOB']
            if not re.fullmatch('[a-z][a-z0-9-]{1,61}',job):raise GateError('invalid_deploy_job')
            result['deployment_operation']=execute_cloud_run_job(project,region,job)
            result['steps'].append('deploy_job_completed')
        else:
            git_base(repo,m['base_sha'])
            temp=pathlib.Path(tempfile.mkdtemp(prefix='jscc-dev-wt-'));temp.rmdir();wt=temp
            run(['git','worktree','add','--detach',str(wt),m['base_sha']],repo)
            result['steps'].append('worktree_created')
            if action in ('implement','publish'):
                if patch is None:raise GateError('patch_missing')
                paths=patch_validate(patch,m['patch_sha256'])
                run(['git','apply','--check','--no-ext-diff',str(patch)],wt)
                run(['git','apply','--no-ext-diff',str(patch)],wt)
                result['changed_paths']=paths
            # Refuse to run npm suites without deterministic dependency state.
            # npm lifecycle scripts are disabled during dependency installation.
            lock=wt/'ops'/'package-lock.json'
            if not lock.is_file():raise GateError('ops_lockfile_missing')
            install=run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],wt/'ops',check=False,timeout=300)
            result['steps'].append({'dependency_install':'npm_ci','exit_code':install.returncode})
            if install.returncode:raise GateError('ops_dependency_install_failed')
            for suite in m['suites']:
                p=run(TESTS[suite],wt/'ops',check=False,timeout=600)
                (ev/(suite+'.log')).write_text('test output redacted pending vetted log sanitizer\n')
                result['steps'].append({'suite':suite,'exit_code':p.returncode})
                if p.returncode:raise GateError('tests_failed_'+suite)
            if action=='verify' and run(['git','status','--porcelain'],wt).stdout.strip():raise GateError('verification_modified_worktree')
            if action=='publish':
                if not run(['git','status','--porcelain'],wt).stdout.strip():raise GateError('no_changes')
                run(['git','switch','-c',m['branch']],wt)
                run(['git','add','--all'],wt)
                run(['git','-c','user.name=JSCC DEV Executor','-c','user.email=jscc-dev-executor@users.noreply.github.com','commit','-m',f'dev: authorized {m["work_item_ref"]}'],wt)
                if not os.getenv('GH_TOKEN'):
                    raise GateError('github_credential_missing')
                git_env = dict(os.environ, GIT_ASKPASS='/app/git-askpass.sh', GIT_TERMINAL_PROMPT='0')
                run(['git','-c','credential.helper=','push','origin',f'HEAD:refs/heads/{m["branch"]}'],wt,timeout=120,env=git_env)
                result['commit_sha']=run(['git','rev-parse','HEAD'],wt).stdout.strip()
                pr=run(['gh','pr','create','--repo',REPO,'--head',m['branch'],'--base','main','--title',f'dev: {m["work_item_ref"]}','--body',f'Authorized candidate for {m["work_item_ref"]}; evidence recorded by DEV executor.'],wt)
                result['pr_url']=pr.stdout.strip();result['steps'].append('pr_created')
        result['status']='PASS'
    except Exception as e:
        result['status']='FAIL';result['error_code']=type(e).__name__
    finally:
        if wt and wt.exists():run(['git','worktree','remove','--force',str(wt)],repo,check=False)
        ev.mkdir(exist_ok=True,parents=True)
        (ev/'result.json').write_text(json.dumps(result,indent=2))
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=ACTIONS);p.add_argument('manifest',type=pathlib.Path);p.add_argument('--repo',type=pathlib.Path,default=pathlib.Path('/workspace/repo'));p.add_argument('--patch',type=pathlib.Path);p.add_argument('--evidence',type=pathlib.Path,default=pathlib.Path('/tmp/jscc-evidence'))
    a=p.parse_args();m=json.loads(a.manifest.read_text());r=execute(m,a.action,a.repo,a.patch,a.evidence);print(json.dumps(r));raise SystemExit(0 if r['status']=='PASS' else 1)
if __name__=='__main__':main()
