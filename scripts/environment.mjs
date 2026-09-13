#!/usr/bin/env node
import { loadManifest, parseArgs, requireEnvironment, requireSourceSha, resolveEnvironment, assertProdGate } from './environment/contract.mjs';
import { bootstrapPlan, deployPlan, isolationPlan } from './environment/plans.mjs';
import { printPlan, printValidation, statusRow } from './environment/report.mjs';

function usage() {
  console.log(`Usage:\n  node scripts/environment.mjs validate --env dev --source-sha <sha> [--dry-run]\n  node scripts/environment.mjs bootstrap --env dev --source-sha <sha> --dry-run\n  node scripts/environment.mjs bootstrap-all --source-sha <sha> --dry-run\n  node scripts/environment.mjs deploy --env dev --source-sha <sha> --dry-run\n  node scripts/environment.mjs status --source-sha <sha> --dry-run\n  node scripts/environment.mjs isolation-test --source-sha <sha> --dry-run\n\nPhase 3 permits dry-run/validation only. Live provisioning starts at the environment-specific phase gate.`);
}

function requireDryRun(args, action) {
  if (args.dry_run !== true) throw new Error(`${action} live execution is gated until DEV/TEST provisioning phase; use --dry-run`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help') return usage();
  const manifest = loadManifest(args.manifest || 'config/environments.json');
  const sourceSha = requireSourceSha(args.source_sha || process.env.SOURCE_SHA);

  if (command === 'validate') {
    const envName = requireEnvironment(args.env);
    const runtime = resolveEnvironment(manifest, envName, sourceSha);
    assertProdGate(runtime.environment, args.owner_gate);
    return printValidation(runtime);
  }

  if (command === 'bootstrap') {
    requireDryRun(args, 'bootstrap');
    const runtime = resolveEnvironment(manifest, requireEnvironment(args.env), sourceSha);
    assertProdGate(runtime.environment, args.owner_gate);
    return printPlan('bootstrap', runtime, bootstrapPlan(runtime));
  }

  if (command === 'bootstrap-all') {
    requireDryRun(args, 'bootstrap-all');
    for (const envName of ['dev', 'test']) {
      const runtime = resolveEnvironment(manifest, envName, sourceSha);
      printPlan('bootstrap', runtime, bootstrapPlan(runtime));
    }
    return;
  }

  if (command === 'deploy') {
    requireDryRun(args, 'deploy');
    const runtime = resolveEnvironment(manifest, requireEnvironment(args.env), sourceSha);
    assertProdGate(runtime.environment, args.owner_gate);
    return printPlan('deploy', runtime, deployPlan(runtime));
  }

  if (command === 'status') {
    requireDryRun(args, 'status');
    const rows = ['dev', 'test', 'prod'].map(envName => {
      const runtime = resolveEnvironment(manifest, envName, sourceSha);
      return statusRow(runtime);
    });
    console.table(rows);
    return;
  }

  if (command === 'isolation-test') {
    requireDryRun(args, 'isolation-test');
    const envs = Object.fromEntries(['dev', 'test', 'prod'].map(envName => [envName, resolveEnvironment(manifest, envName, sourceSha)]));
    const checks = isolationPlan(manifest).map(item => ({
      ...item,
      result: envs[item.from].runtimeRepository === envs[item.to].runtimeRepository ? 'FAIL' : 'PASS',
    }));
    if (checks.some(item => item.result !== 'PASS')) throw new Error('Static isolation contract failed');
    console.log(JSON.stringify({ status: 'PASS', mode: 'static-dry-run', checks }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`ENVIRONMENT_AUTOMATION_FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
