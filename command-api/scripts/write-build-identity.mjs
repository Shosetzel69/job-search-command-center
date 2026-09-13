import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const projectDir = process.cwd();
const repoRoot = resolve(projectDir, '..');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim().toLowerCase();
if (!SHA_RE.test(sourceSha)) throw new Error('Could not resolve immutable SOURCE_SHA from git HEAD');

const requestedSourceSha = String(process.env.SOURCE_SHA || '').trim().toLowerCase();
if (requestedSourceSha && requestedSourceSha !== sourceSha) {
  throw new Error(`SOURCE_SHA ${requestedSourceSha} does not match checked-out source ${sourceSha}`);
}

// Phase 2 transition: runtime data are built from the same repository checkout.
// Phase 3 must provide RUNTIME_DATA_SHA explicitly once runtime repositories are separated.
const runtimeDataSha = String(process.env.RUNTIME_DATA_SHA || sourceSha).trim().toLowerCase();
if (!SHA_RE.test(runtimeDataSha)) throw new Error('RUNTIME_DATA_SHA must be a full 40-character commit SHA');

const output = `export const BUILD_IDENTITY = Object.freeze({\n  sourceSha: '${sourceSha}',\n  runtimeDataSha: '${runtimeDataSha}',\n});\n`;
writeFileSync(resolve(projectDir, 'src/build-identity.generated.js'), output, 'utf8');
console.log(`Build identity: SOURCE_SHA=${sourceSha} RUNTIME_DATA_SHA=${runtimeDataSha}`);
