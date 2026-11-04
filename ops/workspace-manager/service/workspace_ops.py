"""Pure bounded read/edit operations for the existing DEV workspace manager.

No Git access, external network, shell, IAM, Cloud Build or deployment.
No source-content snippets are returned from search/compare endpoints.
"""
import difflib
import hashlib
from .common import checked_path, checked_content, MAX_FILE


def checksum(backend, path):
    name = checked_path(path)
    found = backend.get(name)
    if found is None:
        return None
    data, generation = found
    return {
        'path': name, 'generation': generation,
        'sha256': hashlib.sha256(data).hexdigest(),
        'bytes': len(data),
    }


def find_literal(backend, term):
    if not isinstance(term, str) or not term or len(term.encode('utf-8')) > 100:
        raise ValueError('invalid_search_term')
    # Snapshots enforce MAX_FILES / MAX_TOTAL and reject unsafe object paths.
    snapshot = backend.snapshot()
    matches = []
    truncated = False
    for name, data in sorted(snapshot.items()):
        try:
            content = data.decode('utf-8')
        except UnicodeDecodeError:
            continue
        for i, line in enumerate(content.splitlines(), start=1):
            if term not in line:
                continue
            if len(matches) == 40:
                truncated = True
                break
            # A match identifies file + line only. No secret-bearing snippets.
            matches.append({'path': name, 'line': i})
        if truncated:
            break
    return {'matches': matches, 'match_count': len(matches), 'truncated': truncated}


def compare(backend, left, right):
    a, b = checked_path(left), checked_path(right)
    source, target = backend.get(a), backend.get(b)
    if source is None or target is None:
        return None
    left_data, left_gen = source
    right_data, right_gen = target
    result = {
        'left': a, 'right': b, 'left_generation': left_gen, 'right_generation': right_gen,
        'left_sha256': hashlib.sha256(left_data).hexdigest(),
        'right_sha256': hashlib.sha256(right_data).hexdigest(),
        'equal': left_data == right_data,
        'changed_line_ranges': [], 'diff_available': False, 'truncated': False,
    }
    if result['equal']:
        result['diff_available'] = True
        return result
    try:
        aa = left_data.decode('utf-8').splitlines()
        bb = right_data.decode('utf-8').splitlines()
    except UnicodeDecodeError:
        return result
    # Prevent pathologically expensive alignment of huge/sparse input.
    if len(aa) > 2000 or len(bb) > 2000:
        return result
    result['diff_available'] = True
    for op, x1, x2, y1, y2 in difflib.SequenceMatcher(None, aa, bb, autojunk=True).get_opcodes():
        if op == 'equal':
            continue
        if len(result['changed_line_ranges']) == 40:
            result['truncated'] = True
            break
        result['changed_line_ranges'].append({
            'type': op, 'left_start': x1 + 1, 'left_end': x2,
            'right_start': y1 + 1, 'right_end': y2,
        })
    return result


def replace_once(backend, path, old, new, expected_generation):
    name = checked_path(path)
    if not isinstance(expected_generation, int) or isinstance(expected_generation, bool) or expected_generation <= 0:
        raise ValueError('invalid_generation')
    if not isinstance(old, str) or not old or len(old.encode('utf-8')) > 8192:
        raise ValueError('invalid_search_text')
    if not isinstance(new, str) or len(new.encode('utf-8')) > 8192:
        raise ValueError('invalid_replacement_text')
    found = backend.get(name)
    if found is None:
        return None
    data, generation = found
    from .backend import GenerationConflict
    if generation != expected_generation:
        raise GenerationConflict()
    try:
        content = data.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('binary_file') from None
    if content.count(old) != 1:
        raise ValueError('replacement_not_unique')
    updated = checked_content(content.replace(old, new, 1))
    # Existing GCSBackend.put uses if_generation_match; local test backend
    # does the same under lock. Lost updates fail closed with HTTP 409.
    new_generation = backend.put(name, updated, expected_generation)
    return {
        'path': name, 'generation': new_generation,
        'sha256': hashlib.sha256(updated).hexdigest(),
        'bytes': len(updated),
    }
