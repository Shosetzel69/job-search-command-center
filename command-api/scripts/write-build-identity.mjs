import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const projectDir = process.cwd();
const repoRoot = resolve(projectDir, '..');
const requestedSourceSha = String(process.env.SOURCE_SHA || '').trim().toLowerCase();
const trustedPayloadBuild = String(process.env.TRUSTED_PAYLOAD_BUILD || '') === '1';

let sourceSha;
if (trustedPayloadBuild) {
  if (!SHA_RE.test(requestedSourceSha)) {
    throw new Error('SOURCE_SHA is required for trusted payload builds');
  }
  const attestedSourceSha = readFileSync(resolve(repoRoot, '.candidate-source-sha'), 'utf8').trim().toLowerCase();
  if (!SHA_RE.test(attestedSourceSha) || attestedSourceSha !== requestedSourceSha) {
    throw new Error('Trusted payload source attestation does not match SOURCE_SHA');
  }
  sourceSha = requestedSourceSha;
} else {
  sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim().toLowerCase();
  if (!SHA_RE.test(sourceSha)) throw new Error('Could not resolve immutable SOURCE_SHA from git HEAD');
  if (requestedSourceSha && requestedSourceSha !== sourceSha) {
    throw new Error(`SOURCE_SHA ${requestedSourceSha} does not match checked-out source ${sourceSha}`);
  }
}

const appEnv = String(process.env.APP_ENV || 'prod').trim().toLowerCase();
const requestedRuntimeDataSha = String(process.env.RUNTIME_DATA_SHA || '').trim().toLowerCase();
if (appEnv !== 'prod' && !requestedRuntimeDataSha) {
  throw new Error(`RUNTIME_DATA_SHA is required for isolated ${appEnv.toUpperCase()} builds`);
}

// Transitional PROD keeps the existing source/runtime mapping until Phase 6/7.
const runtimeDataSha = requestedRuntimeDataSha || sourceSha;
if (!SHA_RE.test(runtimeDataSha)) throw new Error('RUNTIME_DATA_SHA must be a full 40-character commit SHA');

const output = `export const BUILD_IDENTITY = Object.freeze({\n  sourceSha: '${sourceSha}',\n  runtimeDataSha: '${runtimeDataSha}',\n});\n`;
writeFileSync(resolve(projectDir, 'src/build-identity.generated.js'), output, 'utf8');
console.log(`Build identity: APP_ENV=${appEnv} SOURCE_SHA=${sourceSha} RUNTIME_DATA_SHA=${runtimeDataSha}`);
