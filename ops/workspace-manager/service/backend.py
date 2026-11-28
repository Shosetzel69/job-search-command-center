"""GCS object-generation storage, or file backend only for local tests."""
import os
import hashlib
import urllib.parse
import pathlib
import threading
from .common import checked_path, checked_content, MAX_FILES, MAX_TOTAL

class GenerationConflict(Exception):
    pass

def checked_move(source, destination, expected):
    a, b = checked_path(source), checked_path(destination)
    if a == b or a.startswith(b + '/') or b.startswith(a + '/'):
        raise ValueError('invalid_move_path')
    if type(expected) is not int or expected <= 0:
        raise ValueError('invalid_generation')
    return a, b


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

    def move(self, source, destination, expected):
        a, b = checked_move(source, destination, expected)
        with self.lock:
            found = self.get(a)
            if found is None or found[1] != expected or self.get(b) is not None:
                raise GenerationConflict()
            src, dest = self.root / a, self.root / b
            for p in (src, dest):
                if p.is_symlink() or any(x.is_symlink() for x in p.parents if x != self.root.parent):
                    raise ValueError('symlink_forbidden')
            if dest.exists():
                raise GenerationConflict()
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.rename(src, dest)
            self.generations.pop(a, None)
            generation = expected + 1
            self.generations[b] = generation
            return {'source':a, 'destination':b, 'source_generation':expected,
                    'generation':generation, 'sha256':hashlib.sha256(found[0]).hexdigest(),
                    'bytes':len(found[0]), 'moved':True}

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

    def move(self, source, destination, expected):
        a, b = checked_move(source, destination, expected)
        # Existing google-auth dependency; use the documented atomic JSON API
        # rather than a copy/delete fallback or an unpinned SDK upgrade.
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/devstorage.read_write'])
        root = 'https://storage.googleapis.com/storage/v1/b/' + urllib.parse.quote(self.bucket_name, safe='')
        quote = lambda path: urllib.parse.quote(self.PREFIX + path, safe='')
        with AuthorizedSession(credentials) as session:
            layout = session.get(root, params={'fields':'name,hierarchicalNamespace'},
                                 timeout=5, allow_redirects=False)
            if layout.status_code != 200:
                raise ValueError('move_storage_layout_unverified')
            info = layout.json()
            if info.get('name') != self.bucket_name or info.get('hierarchicalNamespace', {}).get('enabled') is not True:
                raise ValueError('atomic_move_unsupported')
            found = self.get(a)
            if found is None or found[1] != expected:
                raise GenerationConflict()
            response = session.post(root + '/o/' + quote(a) + '/moveTo/o/' + quote(b),
                                    params={'ifSourceGenerationMatch':str(expected),
                                            'ifGenerationMatch':'0','projection':'noAcl'},
                                    timeout=10, allow_redirects=False)
            if response.status_code in (409, 412):
                raise GenerationConflict()
            if response.status_code != 200:
                raise ValueError('move_outcome_unconfirmed')
            receipt = response.json()
            gen = receipt.get('generation')
            if (receipt.get('bucket') != self.bucket_name or
                receipt.get('name') != self.PREFIX + b or
                not isinstance(gen, str) or not gen.isascii() or not gen.isdecimal() or
                len(gen) > 20 or int(gen) <= 0 or int(gen) == expected):
                raise ValueError('move_outcome_unconfirmed')
            dest = self.get(b)
            if dest is None or dest[1] != int(gen) or dest[0] != found[0] or self.get(a) is not None:
                raise ValueError('move_outcome_unconfirmed')
            return {'source':a,'destination':b,'source_generation':expected,
                    'generation':int(gen),'sha256':hashlib.sha256(found[0]).hexdigest(),
                    'bytes':len(found[0]),'moved':True}

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
