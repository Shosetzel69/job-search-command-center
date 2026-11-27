import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const admission = join(root, 'scripts/gcp/assert_trusted_ops_source.sh');
const config = readFileSync(join(root, 'cloudbuild.ops.yaml'), 'utf8');

test('ops admission rejects a clean checkout with a different HEAD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-source-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-b', 'main');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    writeFileSync(join(dir, 'fixture'), 'first');
    git('add', 'fixture');
    git('commit', '-m', 'first');
    const old = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'fixture'), 'second');
    git('commit', '-am', 'second');
    const approved = git('rev-parse', 'HEAD');
    const run = () => spawnSync('bash', [admission], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, SOURCE_SHA: approved, TRUSTED_OPS_REF: 'refs/heads/main', OPS_SOURCE_REMOTE: dir },
    });
    assert.equal(run().status, 0);
    git('checkout', '--detach', old);
    const wrong = run();
    assert.equal(wrong.status, 4);
    assert.match(wrong.stderr, /local_head_mismatch/);
    git('checkout', 'main');
    writeFileSync(join(dir, 'fixture'), 'dirty');
    const dirty = run();
    assert.equal(dirty.status, 4);
    assert.match(dirty.stderr, /dirty_worktree/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ops build consumes the verified archive and gates both image pushes', () => {
  const step = id => {
    const start = config.indexOf('  - id: ' + id + '\n');
    assert.notEqual(start, -1, id);
    const end = config.indexOf('\n  - id: ', start + 1);
    return config.slice(start, end === -1 ? undefined : end);
  };
  assert.match(step('materialize-verified-source'), /rev-parse FETCH_HEAD/);
  assert.match(step('materialize-verified-source'), /archive --format=tar/);
  for (const id of ['python-contract-tests', 'ops-contract-tests', 'build-gateway', 'build-worker']) {
    assert.match(step(id), /\/workspace\/jscc589-ops-verified-src/);
  }
  const verify = step('verify-image-source');
  assert.match(verify, /docker pull/);
  assert.match(verify, /docker inspect/);
  assert.match(verify, /diff -qr/);
  assert.match(verify, /\/workspace\/\.gateway-exists gateway/);
  assert.match(verify, /\/workspace\/\.worker-exists worker/);
  assert.ok(config.indexOf('  - id: verify-image-source') < config.indexOf('  - id: push-gateway'));
  assert.ok(config.indexOf('  - id: verify-image-source') < config.indexOf('  - id: push-worker'));
});
