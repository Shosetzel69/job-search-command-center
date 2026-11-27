"""Unprivileged isolated execution worker: NO GCS, no OAuth, no JSCC credentials."""
import base64
import os
import pathlib
import signal
import sys
import resource
import subprocess
import tempfile
import time
from .httpbase import BaseHandler, serve
from .common import checked_files, checked_task, checked_workdir, snapshot_sha256, checked_snapshot_sha256, MAX_OUTPUT

TIMEOUT = 35

def execute(files, task, argv=None, cwd='.', expected_snapshot_sha256=None):
    decoded = checked_files(files)
    digest = (snapshot_sha256(decoded) if expected_snapshot_sha256 is None else
              checked_snapshot_sha256(expected_snapshot_sha256, decoded))
    command = checked_task(task, argv)
    directory = checked_workdir(cwd, decoded)
    if command[0] in ('python','python3'):
        command = [sys.executable, *command[1:]]
    with tempfile.TemporaryDirectory(prefix='jscc-dev-sandbox-') as tmp:
        root = pathlib.Path(tmp)
        for name, data in decoded.items():
            target = root.joinpath(*name.split('/'))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        working_dir = root if directory == '.' else root.joinpath(*directory.split('/'))
        if not working_dir.is_dir() or not working_dir.resolve().is_relative_to(root.resolve()):
            raise ValueError('invalid_working_directory')
        env = {
            'PATH': '/usr/local/bin:/usr/bin:/bin',
            'HOME': tmp,
            'TMPDIR': tmp,
            'PYTHONDONTWRITEBYTECODE': '1',
            'PYTHONNOUSERSITE': '1',
            'PIP_DISABLE_PIP_VERSION_CHECK': '1',
            'CI': 'true',
        }
        started = time.monotonic()
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE, (2*1024*1024, 2*1024*1024))
            resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT, TIMEOUT+1))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        timed_out = False
        with open(root/'stdout.log', 'wb') as out, open(root/'stderr.log', 'wb') as err:
            p = subprocess.Popen(command, cwd=working_dir, env=env, stdout=out,
                                 stderr=err, start_new_session=True, preexec_fn=limits)
            try:
                p.wait(timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
        stdout = (root/'stdout.log').read_bytes()[:MAX_OUTPUT+1]
        stderr = (root/'stderr.log').read_bytes()[:MAX_OUTPUT+1]
        duration = int((time.monotonic()-started)*1000)
        return {
            'exit_code': 124 if timed_out else p.returncode,
            'timed_out': timed_out,
            'duration_ms': duration,
            'stdout': stdout[:MAX_OUTPUT].decode('utf-8', 'replace'),
            'stderr': stderr[:MAX_OUTPUT].decode('utf-8', 'replace'),
            'truncated': len(stdout)>MAX_OUTPUT or len(stderr)>MAX_OUTPUT,
            'snapshot_sha256': digest,
            'task': task
        }

class Handler(BaseHandler):
    def do_GET(self):
        if self.path == '/health':
            return self.out(200, {'ok':True,'component':'jscc-dev-sandbox-worker','gcp_permissions':'none'})
        return self.out(404, {'error':'not_found'})
    def do_POST(self):
        if self.path != '/internal/execute':
            return self.out(404, {'error':'not_found'})
        try:
            data = self.body()
            if not isinstance(data, dict) or set(data) - {'files','task','argv','cwd','expected_snapshot_sha256'}:
                raise ValueError('invalid_request')
            if 'expected_snapshot_sha256' in data and data['expected_snapshot_sha256'] is None:
                raise ValueError('invalid_snapshot_sha256')
            return self.out(200, execute(data.get('files'), data.get('task'), data.get('argv'), data.get('cwd','.'), data.get('expected_snapshot_sha256')))
        except ValueError as e:
            return self.out(400, {'error':str(e)})
        except Exception:
            return self.out(500, {'error':'execution_failure'})

if __name__ == '__main__':
    if os.environ.get('K_SERVICE') and os.environ.get('JSCC_WORKER_SERVICE_ACCOUNT','') == '':
        raise SystemExit('worker_service_account_env_missing')
    serve(Handler, os.environ.get('PORT',8080))
