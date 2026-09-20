import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKFLOWS = resolve(ROOT, '.github', 'workflows');
const SHA_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})(?:\s+#\s+(.+))?$/;
const MUTABLE_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@(.+)$/;

function externalActionRefs() {
  const refs = [];
  for (const name of readdirSync(WORKFLOWS).filter(name => /\.ya?ml$/.test(name)).sort()) {
    const lines = readFileSync(resolve(WORKFLOWS, name), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s]+(?:\s+#\s+.*)?)\s*$/);
      if (!match) return;
      const ref = match[1].trim();
      if (ref.startsWith('./') || ref.startsWith('docker://')) return;
      refs.push({ file:name, line:index + 1, ref });
    });
  }
  return refs;
}

test('all external GitHub Actions use full immutable SHAs with release comments', () => {
  const refs = externalActionRefs();
  assert.ok(refs.length > 0, 'Expected at least one external action reference');

  for (const item of refs) {
    const parsed = item.ref.match(SHA_REF);
    assert.ok(
      parsed,
      `${item.file}:${item.line} must use owner/action@<40-char-sha> with a release comment; found ${item.ref}`,
    );
    assert.ok(parsed[3]?.trim(), `${item.file}:${item.line} is missing the human-readable version comment`);
  }
});

test('no mutable external action tag or branch remains in active workflows', () => {
  for (const item of externalActionRefs()) {
    const parsed = item.ref.match(MUTABLE_REF);
    assert.ok(parsed, `Malformed action reference: ${item.ref}`);
    const version = parsed[2].split(/\s+#/)[0].trim();
    assert.match(version, /^[0-9a-f]{40}$/, `${item.file}:${item.line} uses mutable ref ${version}`);
  }
});
