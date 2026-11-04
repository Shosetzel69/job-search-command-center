"""GCS-backed source controller; NEVER executes repository code itself."""
import base64
import json
import os
import urllib.parse
import urllib.request
from .httpbase import BaseHandler, serve
from .backend import GCSBackend, LocalBackend, GenerationConflict
from .common import checked_path, checked_content, checked_task, MAX_FILES, MAX_TOTAL, MAX_REQUEST, json_bytes
from .workspace_ops import checksum, find_literal, compare, replace_once

WORKER_URL = os.environ.get('WORKER_URL','').rstrip('/')
if os.environ.get('K_SERVICE'):
    if os.environ.get('JSCC_LOCAL_BACKEND'):
        raise SystemExit('local_backend_disabled_in_cloud')
    if not WORKER_URL.startswith('https://'):
        raise SystemExit('private_worker_https_required')
    if os.environ.get('GOOGLE_CLOUD_PROJECT') not in ('jscc-dev',None):
        raise SystemExit('dev_project_required')
    backend = GCSBackend(os.environ['JSCC_DEV_WORKSPACE_BUCKET'])
else:
    if not os.environ.get('JSCC_LOCAL_BACKEND'):
        raise SystemExit('local_mode_explicit_opt_in_required')
    if not WORKER_URL.startswith('http://127.0.0.1:'):
        raise SystemExit('local_worker_required')
    backend = LocalBackend(os.environ['JSCC_LOCAL_BACKEND'])

def execute_worker(snapshot, task, argv=None):
    files = {k:base64.b64encode(v).decode() for k,v in snapshot.items()}
    payload = json_bytes({'files':files,'task':task,'argv':argv})
    headers = {'Content-Type':'application/json'}
    if os.environ.get('K_SERVICE'):
        import google.auth.transport.requests
        from google.oauth2 import id_token
        headers['Authorization'] = 'Bearer ' + id_token.fetch_id_token(google.auth.transport.requests.Request(),WORKER_URL)
    req = urllib.request.Request(WORKER_URL+'/internal/execute',data=payload,headers=headers,method='POST')
    with urllib.request.urlopen(req,timeout=58) as r:
        return json.load(r)

class Handler(BaseHandler):
    def do_GET(self):
        if self.path == '/health':
            return self.out(200, {'ok':True,'component':'jscc-dev-workspace-manager','backend':'gcs' if os.environ.get('K_SERVICE') else 'local','git_required':False})
        q = urllib.parse.urlsplit(self.path)
        if q.path == '/v1/files':
            try:
                snap = backend.snapshot()
                return self.out(200,{'files':sorted(snap),'file_count':len(snap),'total_bytes':sum(map(len,snap.values()))})
            except ValueError as e:
                return self.out(413,{'error':str(e)})
        if q.path == '/v1/file':
            try:
                p = urllib.parse.parse_qs(q.query).get('path',[''])[0]
                result=backend.get(checked_path(p))
                if result is None: return self.out(404,{'error':'not_found'})
                data, generation=result
                try: content = data.decode('utf-8')
                except UnicodeDecodeError: return self.out(422,{'error':'binary_file'})
                return self.out(200,{'path':p,'content':content,'generation':generation})
            except ValueError as e:
                return self.out(400,{'error':str(e)})
        if q.path == '/v1/checksum':
            try:
                query=urllib.parse.parse_qs(q.query,keep_blank_values=True)
                if set(query) != {'path'} or len(query['path']) != 1:
                    raise ValueError('invalid_request')
                found=checksum(backend,query['path'][0])
                return self.out(200,found) if found is not None else self.out(404,{'error':'not_found'})
            except ValueError as e:
                return self.out(400,{'error':str(e)})
        if q.path == '/v1/search':
            try:
                query=urllib.parse.parse_qs(q.query,keep_blank_values=True)
                if set(query) != {'term'} or len(query['term']) != 1:
                    raise ValueError('invalid_request')
                return self.out(200,find_literal(backend,query['term'][0]))
            except ValueError as e:
                return self.out(413 if str(e) in ('file_count_limit','workspace_too_large') else 400,{'error':str(e)})
        if q.path == '/v1/compare':
            try:
                query=urllib.parse.parse_qs(q.query,keep_blank_values=True)
                if set(query) != {'left','right'} or len(query['left']) != 1 or len(query['right']) != 1:
                    raise ValueError('invalid_request')
                found=compare(backend,query['left'][0],query['right'][0])
                return self.out(200,found) if found is not None else self.out(404,{'error':'not_found'})
            except ValueError as e:
                return self.out(400,{'error':str(e)})
        return self.out(404,{'error':'not_found'})

    def do_PUT(self):
        if self.path != '/v1/file':
            return self.out(404,{'error':'not_found'})
        try:
            o = self.body()
            if not isinstance(o,dict) or set(o) - {'path','content','if_generation_match'}:
                raise ValueError('invalid_request')
            name = checked_path(o.get('path'))
            content = checked_content(o.get('content'))
            gen=o.get('if_generation_match',0)
            if type(gen) is not int or gen<0:
                raise ValueError('invalid_generation')
            version=backend.put(name,content,gen)
            return self.out(200,{'path':name,'generation':version})
        except GenerationConflict:
            return self.out(409,{'error':'generation_conflict'})
        except ValueError as e:
            return self.out(400,{'error':str(e)})

    def do_POST(self):
        if self.path == '/v1/replace':
            try:
                o=self.body()
                if not isinstance(o,dict) or set(o) != {'path','old','new','if_generation_match'}:
                    raise ValueError('invalid_request')
                found=replace_once(backend,o['path'],o['old'],o['new'],o['if_generation_match'])
                return self.out(200,found) if found is not None else self.out(404,{'error':'not_found'})
            except GenerationConflict:
                return self.out(409,{'error':'generation_conflict'})
            except ValueError as e:
                return self.out(400,{'error':str(e)})
        if self.path != '/v1/run':
            return self.out(404,{'error':'not_found'})
        try:
            o=self.body()
            if not isinstance(o,dict) or set(o)-{'task','argv'}:
                raise ValueError('invalid_request')
            cmd=checked_task(o.get('task'),o.get('argv'))
            snap=backend.snapshot()
            if len(snap)>MAX_FILES or sum(map(len,snap.values()))>MAX_TOTAL:
                raise ValueError('workspace_limit')
            return self.out(200,execute_worker(snap,o['task'],o.get('argv')))
        except ValueError as e:
            return self.out(400,{'error':str(e)})
        except urllib.error.HTTPError as e:
            return self.out(502,{'error':'worker_http_error','status':e.code})
        except Exception:
            return self.out(502,{'error':'worker_unavailable'})

if __name__ == '__main__':
    serve(Handler, os.environ.get('PORT',8080))
