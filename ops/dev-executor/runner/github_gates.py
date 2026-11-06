"""Fail-closed GitHub PR merge policy. No merge is performed by this module."""
import os
from executor import GateError, REPO, ghjson

GRAPHQL='''query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
 repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
  reviewThreads(first:100,after:$cursor) { pageInfo {hasNextPage endCursor}
   nodes {isResolved isOutdated} }
 } } }'''

def verify_review_threads(pr_number, request=ghjson):
    cursor=None
    for page in range(100):
        args=['graphql','-f','query='+GRAPHQL,'-F','owner=Shosetzel69',
              '-F','repo=job-search-command-center','-F',f'number={pr_number}']
        if cursor:args+=['-f','cursor='+cursor]
        data=request(args)
        if data.get('errors'):raise GateError('graphql_review_errors')
        pr=((data.get('data') or {}).get('repository') or {}).get('pullRequest')
        threads=(pr or {}).get('reviewThreads')
        if not isinstance(threads,dict) or not isinstance(threads.get('nodes'),list):raise GateError('review_threads_unavailable')
        if any(t.get('isResolved') is not True for t in threads['nodes']):raise GateError('unresolved_review_thread')
        info=threads.get('pageInfo') or {}
        if info.get('hasNextPage') is False:return
        nxt=info.get('endCursor')
        if info.get('hasNextPage') is not True or not isinstance(nxt,str) or not nxt or nxt==cursor:raise GateError('review_thread_pagination_invalid')
        cursor=nxt
    raise GateError('review_thread_page_limit')

def paged_reviews(pr_number,request=ghjson):
    reviews=[]
    for page in range(1,102):
        batch=request([f'repos/{REPO}/pulls/{pr_number}/reviews?per_page=100&page={page}'])
        if not isinstance(batch,list):raise GateError('reviews_unavailable')
        if page==101:raise GateError('reviews_page_limit')
        reviews+=batch
        if len(batch)<100:return reviews
    raise GateError('reviews_page_limit')

def verify_reviews(pr_number,head_sha,request=ghjson):
    reviews=paged_reviews(pr_number,request)
    latest={}
    for r in reviews:
        login=(r.get('user') or {}).get('login')
        if not login or not r.get('submitted_at'):raise GateError('invalid_review_entry')
        if r.get('commit_id')!=head_sha:continue
        previous=latest.get(login)
        if previous is None or (r['submitted_at'],r.get('id',0))>(previous['submitted_at'],previous.get('id',0)):
            latest[login]=r
    if any(r.get('state')=='CHANGES_REQUESTED' for r in latest.values()):raise GateError('changes_requested')
    if not any(r.get('state')=='APPROVED' for r in latest.values()):raise GateError('head_sha_review_approval_missing')

def verify_checks(sha,request=ghjson):
    required=set(x.strip() for x in os.getenv('JSCC_DEV_REQUIRED_CHECKS','').split(',') if x.strip())
    if not required or 'gitleaks' not in required:raise GateError('required_checks_not_configured')
    seen=[]
    for page in range(1,102):
        batch=request([f'repos/{REPO}/commits/{sha}/check-runs?per_page=100&page={page}'])
        if not isinstance(batch,dict) or not isinstance(batch.get('check_runs'),list):raise GateError('checks_unavailable')
        if page==101:raise GateError('checks_page_limit')
        seen.extend(batch['check_runs'])
        if len(batch['check_runs'])<100:
            if batch.get('total_count',len(seen))!=len(seen):raise GateError('checks_truncated')
            break
    checks={}
    for c in seen:
        if c.get('head_sha')!=sha:raise GateError('check_sha_mismatch')
        if c.get('name') in required:
            checks.setdefault(c['name'],[]).append(c)
    for name in required:
        entries=checks.get(name,[])
        if not entries or any(c.get('status')!='completed' or c.get('conclusion')!='success' for c in entries):raise GateError('required_check_not_successful')

def verify_merge_gates(number,sha,request=ghjson):
    verify_checks(sha,request)
    verify_reviews(number,sha,request)
    verify_review_threads(number,request)
