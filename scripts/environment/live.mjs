import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SHA_RE } from './contract.mjs';

const PRE_CUTOVER_LIVE_ENVIRONMENTS = new Set(['dev', 'test']);

export function assertPreCutoverLiveGate(environment, dryRun) {
  if (dryRun === true) return;
  if (!PRE_CUTOVER_LIVE_ENVIRONMENTS.has(environment)) {
    throw new Error(`Pre-cutover live execution permits DEV/TEST only; ${String(environment).toUpperCase()} remains blocked until separate Phase 7 GO`);
  }
}

// Backward-compatible alias for Phase 4/5 callers and historical tests.
export const assertPhase5LiveGate = assertPreCutoverLiveGate;

export function verifyLocalSourceSha(sourceSha, cwd = process.cwd()) {
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim().toLowerCase();
  if (!SHA_RE.test(actual)) throw new Error('Could not resolve immutable local SOURCE_SHA');
  if (actual !== sourceSha) throw new Error(`Local checkout ${actual} does not match requested SOURCE_SHA ${sourceSha}`);
  return actual;
}

export function makeRuntimeWorkspace() {
  const root = mkdtempSync(resolve(tmpdir(), 'job-search-runtime-'));
  return Object.freeze({
    root,
    dataDir: resolve(root, 'data'),
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  });
}
