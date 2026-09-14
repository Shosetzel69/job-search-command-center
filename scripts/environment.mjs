#!/usr/bin/env node
import { loadManifest, parseArgs, requireEnvironment, requireSourceSha, resolveEnvironment, assertProdGate } from './environment/contract.mjs';
import { bootstrapPlan, deployPlan, isolationPlan } from './environment/plans.mjs';
import { printPlan, printValidation, statusRow } from './environment/report.mjs';
import { assertPhase5LiveGate } from './environment/live.mjs';
import { provisionEnvironment, deployEnvironment, statusEnvironment } from './environment/provision.mjs';

function usage() {
  console.log(`Usage:\n  node scripts/environment.mjs validate --env dev|test --source-sha <sha> [--dry-run]\n  node scripts/environment.mjs bootstrap --env dev|test --source-sha <sha> [--dry-run]\n  node scripts/environment.mjs bootstrap-all --source-sha <sha> --dry-run\n  node scripts/environment.mjs deploy --env dev|test --source-sha <sha> [--dry-run]\n  node scripts/environment.mjs status --env dev|test --source-sha <sha> [--dry-run]\n  node scripts/environment.mjs isolation-test --source-sha <sha> --dry-run\n\nPhase 5 permits live execution for DEV and TEST only. PROD remains blocked. bootstrap-all and isolation-test remain non-mutating.`);
}

function requireDryRun(args, action) {
  if (args.dry_run !== true) throw new Error(`${action} remains dry-run only in Phase 5`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help') return usage();
  const manifest = loadManifest(args.manifest || 'config/environments.json');
  const sourceSha = requireSourceSha(args.source_sha || process.env.SOURCE_SHA);

  if (command === 'validate') {
    const envName = requireEnvironment(args.env);
    const runtime = resolveEnvironment(manifest, envName, sourceSha);
    assertProdGate(runtime.environment, args.owner_gate);
    if (args.dry_run !== true) assertPhase5LiveGate(runtime.environment, false);
    return printValidation(runtime);
  }

  if (command === 'bootstrap') {
    const runtime = resolveEnvironment(manifest, requireEnvironment(args.env), sourceSha);
    assertProdGate(runtime.environment, args.owner_gate);
    if (args.dry_run === true) return printPlan('bootstrap', runtime, bootstrapPlan(runtime));
    assertPhase5LiveGate(runtime.environment, false);
    console.log(JSON.stringify(await provisionEnvironment(runtime), null, 2));
    return;
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
    const runtime = resolveEnvironment(manifest, requireEnvironment(args.env), sourceSha);
    assertProdGate(runtime.environment, args.owner_gate);
    if (args.dry_run === true) return printPlan('deploy', runtime, deployPlan(runtime));
    assertPhase5LiveGate(runtime.environment, false);
    console.log(JSON.stringify(await deployEnvironment(runtime), null, 2));
    return;
  }

  if (command === 'status') {
    if (args.dry_run === true) {
      const rows = ['dev', 'test', 'prod'].map(envName => {
        const runtime = resolveEnvironment(manifest, envName, sourceSha);
        return statusRow(runtime);
      });
      console.table(rows);
      return;
    }
    const runtime = resolveEnvironment(manifest, requireEnvironment(args.env), sourceSha);
    assertPhase5LiveGate(runtime.environment, false);
    const liveStatus = await statusEnvironment(runtime);
    const label = runtime.environment.toUpperCase();
    if (liveStatus.auth_configured !== true) throw new Error(`${label} is not ready: Google authentication is not fully configured`);
    if (liveStatus.github_configured !== true) throw new Error(`${label} is not ready: runtime GitHub credential is not configured`);
    console.log(JSON.stringify(liveStatus, null, 2));
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

main().catch(error => {
  console.error(`ENVIRONMENT_AUTOMATION_FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
