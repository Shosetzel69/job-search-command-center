"""GCS object-generation storage, or file backend only for local tests."""
import os
import pathlib
import threading
from .common import checked_path, checked_content, MAX_FILES, MAX_TOTAL

class GenerationConflict(Exception):
    pass

class LocalBackend:
    """Local backend ONLY for deterministic offline tests; never enable in Cloud Run."""
    def __init__(self, root):
        self.root = pathlib.Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.generations = {}

    def get(self, path):
        path = checked_path(path)
        with self.lock:
            p = self.root.joinpath(*path.split('/'))
            if not p.is_file():
                return None
            return p.read_bytes(), self.generations.get(path, 1)

    def put(self, path, content, expected=0):
        checked_path(path)
        with self.lock:
            p = self.root.joinpath(*path.split('/'))
            current = self.generations.get(path, 0)
            if current != expected:
                raise GenerationConflict()
            p.parent.mkdir(parents=True, exist_ok=True)
            # Test-only backend never processes untrusted absolute/symlink paths.
            if p.is_symlink() or any(x.is_symlink() for x in p.parents if x != self.root.parent):
                raise ValueError('symlink_forbidden')
            p.write_bytes(content)
            self.generations[path] = current + 1
            return current + 1

    def delete(self, path, expected):
        path = checked_path(path)
        if type(expected) is not int or expected <= 0:
            raise ValueError('invalid_generation')
        with self.lock:
            current = self.generations.get(path, 0)
            if current != expected:
                raise GenerationConflict()
            p = self.root.joinpath(*path.split('/'))
            if p.is_symlink() or any(x.is_symlink() for x in p.parents if x != self.root.parent):
                raise ValueError('symlink_forbidden')
            if not p.is_file():
                raise GenerationConflict()
            p.unlink()
            del self.generations[path]
            return True

    def snapshot(self):
        with self.lock:
            result = {}
            for p in self.root.rglob('*'):
                if p.is_file() and not p.is_symlink():
                    name = p.relative_to(self.root).as_posix()
                    checked_path(name)
                    result[name] = p.read_bytes()
            return result

class GCSBackend:
    PREFIX = 'workspace/v3/'
    def __init__(self, bucket_name):
        from google.cloud import storage
        from google.api_core.exceptions import PreconditionFailed, Conflict
        self.PreconditionFailed, self.Conflict = PreconditionFailed, Conflict
        self.client = storage.Client(project='jscc-dev')
        self.bucket_name = bucket_name
        self.bucket = self.client.bucket(bucket_name)

    def get(self, path):
        checked_path(path)
        blob = self.bucket.blob(self.PREFIX + path)
        if not blob.exists():
            return None
        blob.reload()
        if blob.size > 128 * 1024:
            raise ValueError('file_too_large')
        return blob.download_as_bytes(if_generation_match=blob.generation), int(blob.generation)

    def put(self, path, content, expected=0):
        checked_path(path)
        blob = self.bucket.blob(self.PREFIX + path)
        try:
            blob.upload_from_string(content, content_type='application/octet-stream', if_generation_match=expected)
        except (self.PreconditionFailed, self.Conflict):
            raise GenerationConflict() from None
        return int(blob.generation)

    def delete(self, path, expected):
        path = checked_path(path)
        if type(expected) is not int or expected <= 0:
            raise ValueError('invalid_generation')
        from google.api_core.exceptions import NotFound
        blob = self.bucket.blob(self.PREFIX + path)
        try:
            blob.delete(if_generation_match=expected)
        except (self.PreconditionFailed, self.Conflict):
            raise GenerationConflict() from None
        except NotFound:
            return False
        return True

    def snapshot(self):
        items = list(self.client.list_blobs(self.bucket_name, prefix=self.PREFIX, max_results=MAX_FILES + 1))
        if len(items) > MAX_FILES:
            raise ValueError('file_count_limit')
        result, total = {}, 0
        for blob in items:
            path = checked_path(blob.name[len(self.PREFIX):])
            if blob.size and blob.size > 128 * 1024:
                raise ValueError('file_too_large')
            data = blob.download_as_bytes(if_generation_match=blob.generation)
            total += len(data)
            if total > MAX_TOTAL:
                raise ValueError('workspace_too_large')
            result[path] = data
        return result
