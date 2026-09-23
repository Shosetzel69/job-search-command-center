#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, requireSourceSha, resolveEnvironment } from './contract.mjs';
import { deployCandidateWithReconciliation } from './provision.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2).replaceAll('-', '_');
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function writeJson(path, payload) {
  if (!path) return;
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const sourceSha = requireSourceSha(args.source_sha || process.env.SOURCE_SHA);
  if (String(args.owner_gate || '').trim() !== 'PROD_GO') {
    throw new Error('PROD reconciliation requires owner_gate=PROD_GO');
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const manifest = loadManifest(resolve(root, 'config/environments.json'));
  const runtime = resolveEnvironment(manifest, 'prod', sourceSha);

  const deployment = await deployCandidateWithReconciliation(runtime, {
    configureBootstrapSecrets: true,
  });

  writeJson(args.health_output, deployment.health);
  writeJson(args.result_output, {
    status: 'PASS',
    action: 'deploy',
    environment: 'prod',
    source_sha: sourceSha,
    runtime_data_sha: deployment.runtimeDataSha,
    health: deployment.health,
    reconciliation: deployment.reconciliation,
  });

  console.log(JSON.stringify({
    status: 'PASS',
    environment: 'prod',
    source_sha: sourceSha,
    runtime_data_sha: deployment.runtimeDataSha,
  }, null, 2));
}

main().catch(error => {
  console.error(`PROD_RECONCILIATION_FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
