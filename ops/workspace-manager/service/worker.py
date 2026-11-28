"""Unprivileged isolated execution worker: NO GCS, no OAuth, no JSCC credentials."""
import base64
import hashlib
import shutil
import stat
import os
import pathlib
import signal
import sys
import resource
import subprocess
import tempfile
import time
from .httpbase import BaseHandler, serve
from .common import checked_files, checked_task, checked_workdir, snapshot_sha256, checked_snapshot_sha256, checked_artifact_paths, ALLOWED_BINARIES, MAX_FILE, MAX_OUTPUT

TIMEOUT = 35

def artifact_metadata(root, path):
    """No traversal/symlink/hardlink, device, FIFO or unbounded read."""
    dirs = []
    fd = None
    try:
        dirs.append(os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        parts = path.split('/')
        for part in parts[:-1]:
            dirs.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dirs[-1]))
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirs[-1])
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_FILE:
            return {'path':path,'status':'REJECTED'}
        data = bytearray()
        while len(data) <= MAX_FILE:
            chunk = os.read(fd, min(65536, MAX_FILE + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        if (len(data) > MAX_FILE or len(data) != before.st_size or
                (before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_nlink) !=
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink)):
            return {'path':path,'status':'REJECTED'}
        return {'path':path,'status':'HASHED','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    except FileNotFoundError:
        return {'path':path,'status':'MISSING'}
    except OSError:
        return {'path':path,'status':'REJECTED'}
    finally:
        if fd is not None:
            os.close(fd)
        for item in reversed(dirs):
            os.close(item)

def execute(files, task, argv=None, cwd='.', expected_snapshot_sha256=None, artifact_paths=None):
    decoded = checked_files(files)
    digest = (snapshot_sha256(decoded) if expected_snapshot_sha256 is None else
              checked_snapshot_sha256(expected_snapshot_sha256, decoded))
    command = checked_task(task, argv)
    directory = checked_workdir(cwd, decoded)
    requested = None
    if artifact_paths is not None:
        if expected_snapshot_sha256 is None or task == 'toolchain':
            raise ValueError('invalid_artifact_paths')
        requested = checked_artifact_paths(artifact_paths)
    if task == 'toolchain':
        return {'task':task,'snapshot_sha256':digest,'versions_verified':False,
                'tools':[{'name':name,'available': bool(sys.executable) if name in ('python','python3')
                          else shutil.which(name, path='/usr/local/bin:/usr/bin:/bin') is not None}
                         for name in sorted(ALLOWED_BINARIES)]}
    if command[0] in ('python','python3'):
        command = [sys.executable, *command[1:]]
    with tempfile.TemporaryDirectory(prefix='jscc-dev-sandbox-') as tmp:
        root = pathlib.Path(tmp)/'workspace'
        root.mkdir()
        logs = pathlib.Path(tmp)/'logs'
        logs.mkdir()
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
        with open(logs/'stdout.log', 'w+b') as out, open(logs/'stderr.log', 'w+b') as err:
            p = subprocess.Popen(command, cwd=working_dir, env=env, stdout=out,
                                 stderr=err, start_new_session=True, preexec_fn=limits)
            try:
                p.wait(timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
            finally:
                # Clean up remaining members of the launched process group.
                # Not a claim about escaped process groups or host isolation.
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            # Read bounded original descriptors, not filenames the child can replace.
            out.seek(0)
            err.seek(0)
            stdout = out.read(MAX_OUTPUT+1)
            stderr = err.read(MAX_OUTPUT+1)
        duration = int((time.monotonic()-started)*1000)
        result = {
            'exit_code': 124 if timed_out else p.returncode,
            'timed_out': timed_out,
            'duration_ms': duration,
            'stdout': stdout[:MAX_OUTPUT].decode('utf-8', 'replace'),
            'stderr': stderr[:MAX_OUTPUT].decode('utf-8', 'replace'),
            'truncated': len(stdout)>MAX_OUTPUT or len(stderr)>MAX_OUTPUT,
            'snapshot_sha256': digest,
            'task': task
        }
        if requested is not None:
            result['artifacts'] = [artifact_metadata(root, path) for path in requested]
    if requested is not None:
        result['temporary_directory_removed'] = not os.path.exists(tmp)
    return result

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
            if not isinstance(data, dict) or set(data) - {'files','task','argv','cwd','expected_snapshot_sha256','artifact_paths'}:
                raise ValueError('invalid_request')
            if 'expected_snapshot_sha256' in data and data['expected_snapshot_sha256'] is None:
                raise ValueError('invalid_snapshot_sha256')
            return self.out(200, execute(data.get('files'), data.get('task'), data.get('argv'), data.get('cwd','.'), data.get('expected_snapshot_sha256'), data.get('artifact_paths')))
        except ValueError as e:
            return self.out(400, {'error':str(e)})
        except Exception:
            return self.out(500, {'error':'execution_failure'})

if __name__ == '__main__':
    if os.environ.get('K_SERVICE') and os.environ.get('JSCC_WORKER_SERVICE_ACCOUNT','') == '':
        raise SystemExit('worker_service_account_env_missing')
    serve(Handler, os.environ.get('PORT',8080))
