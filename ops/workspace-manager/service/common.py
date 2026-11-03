"""Bounded, no-Git DEV workspace protocol shared by controller and sandbox."""
import base64
import json
import re

MAX_FILE = 128 * 1024
MAX_FILES = 100
MAX_TOTAL = 2 * 1024 * 1024
MAX_REQUEST = 3 * 1024 * 1024
MAX_OUTPUT = 16 * 1024
VALID_PATH = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.\-/]{0,179}\Z")
RESTRICTED = {'.env', '.git', '.ssh', 'id_rsa', '.aws', 'credentials.json'}

def checked_path(path):
    if not isinstance(path, str) or not VALID_PATH.fullmatch(path):
        raise ValueError('invalid_path')
    components = path.split('/')
    if any(p in ('', '.', '..') or p in RESTRICTED for p in components):
        raise ValueError('invalid_path')
    return path

def checked_content(content):
    if not isinstance(content, str):
        raise ValueError('invalid_content')
    encoded = content.encode('utf-8')
    if len(encoded) > MAX_FILE:
        raise ValueError('file_too_large')
    return encoded

def checked_files(files):
    if not isinstance(files, dict) or len(files) > MAX_FILES:
        raise ValueError('file_count_limit')
    total = 0
    seen = set()
    decoded = {}
    for path, content in files.items():
        checked_path(path)
        if path in seen:
            raise ValueError('duplicate_path')
        seen.add(path)
        if not isinstance(content, str):
            raise ValueError('invalid_content')
        try:
            raw = base64.b64decode(content, validate=True)
        except Exception:
            raise ValueError('invalid_base64') from None
        if len(raw) > MAX_FILE:
            raise ValueError('file_too_large')
        total += len(raw)
        if total > MAX_TOTAL:
            raise ValueError('workspace_too_large')
        decoded[path] = raw
    return decoded

ALLOWED_TASKS = {'python_syntax', 'pytest', 'command'}
ALLOWED_BINARIES = {'python', 'python3', 'pytest', 'bash', 'node', 'npm'}

def checked_task(task, argv):
    if task not in ALLOWED_TASKS:
        raise ValueError('unsupported_task')
    if task == 'python_syntax':
        return ['python', '-m', 'compileall', '-q', '.']
    if task == 'pytest':
        return ['python', '-m', 'pytest', '-q', '--disable-warnings', '--maxfail=1']
    if not isinstance(argv, list) or not (1 <= len(argv) <= 18):
        raise ValueError('invalid_argv')
    if not all(isinstance(v, str) and v and len(v) <= 1000 for v in argv):
        raise ValueError('invalid_argv')
    if argv[0] not in ALLOWED_BINARIES:
        raise ValueError('binary_not_allowlisted')
    if sum(map(len, argv)) > 4000:
        raise ValueError('command_too_long')
    return argv

def json_bytes(obj):
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
