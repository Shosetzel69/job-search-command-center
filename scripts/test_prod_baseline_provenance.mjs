import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, 'config/prod-baseline-migration-332.json'), 'utf8'),
);
const HISTORICAL = MANIFEST.historical_candidate_sha;
const TARGET = MANIFEST.target_candidate_sha;
const PATHS = ['data/sources.json','data/source-categories.json','data/nomenclatures.json'];

function gitBytes(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { cwd:ROOT });
}

function prodSnapshotBytes(path) {
  return readFileSync(resolve(ROOT, 'config/provenance/prod-baseline-332/runtime', path));
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function gitBlob(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

test('frozen #332 manifest digests match exact historical, target and reviewed PROD provenance bytes', () => {
  for (const path of PATHS) {
    const historical = gitBytes(HISTORICAL, path);
    const target = gitBytes(TARGET, path);
    const prod = prodSnapshotBytes(path);
    const contract = MANIFEST.files[path];

    assert.equal(sha256(historical), contract.historical_digest, `historical digest: ${path}`);
    assert.equal(sha256(target), contract.target_candidate_digest, `target digest: ${path}`);
    assert.equal(sha256(prod), contract.expected_pre_migration_digest, `PROD pre-state digest: ${path}`);
    assert.equal(gitBlob(prod), contract.current_prod_git_blob, `PROD Git blob: ${path}`);
  }
});

test('nomenclatures provenance is byte-identical across exact historical, target and PROD snapshot', () => {
  const path = 'data/nomenclatures.json';
  const historical = gitBytes(HISTORICAL, path);
  const target = gitBytes(TARGET, path);
  const prod = prodSnapshotBytes(path);
  const expected = 'sha256:f352e2f5317800ac3d10bd3b5d11f2277e3908c4141eb9577ec8a42cf3fa82f3';

  assert.equal(historical.length, 16428);
  assert.deepEqual(historical, target);
  assert.deepEqual(target, prod);
  assert.equal(sha256(historical), expected);
  assert.equal(MANIFEST.files[path].historical_digest, expected);
  assert.equal(MANIFEST.files[path].target_candidate_digest, expected);
  assert.equal(MANIFEST.files[path].expected_pre_migration_digest, expected);
  assert.equal(MANIFEST.files[path].resolved_target_digest, expected);
});

test('real historical to PROD source delta is exactly the approved Monster overlay', () => {
  const historical = JSON.parse(gitBytes(HISTORICAL, 'data/sources.json').toString('utf8'));
  const prod = JSON.parse(prodSnapshotBytes('data/sources.json').toString('utf8'));
  const target = JSON.parse(gitBytes(TARGET, 'data/sources.json').toString('utf8'));

  assert.equal(historical.count, 130);
  assert.equal(prod.count, 130);
  assert.equal(target.count, 160);
  assert.equal(prod.sources.some(source => source.name === 'NTT RO'), false);
  assert.equal(target.sources.some(source => source.name === 'NTT RO'), false);

  const prodById = new Map(prod.sources.map(source => [source.id, source]));
  const deltas = [];
  for (const source of historical.sources) {
    const runtime = prodById.get(source.id);
    if (!runtime || JSON.stringify(source) !== JSON.stringify(runtime)) {
      deltas.push({ historical:source, runtime:runtime || null });
    }
  }
  for (const source of prod.sources) {
    if (!historical.sources.some(item => item.id === source.id)) {
      deltas.push({ historical:null, runtime:source });
    }
  }

  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].historical.id, MANIFEST.approved_overlay.source_id);
  assert.deepEqual(deltas[0].historical, MANIFEST.approved_overlay.historical_record);
  assert.deepEqual(deltas[0].runtime, MANIFEST.approved_overlay.runtime_record);
});
