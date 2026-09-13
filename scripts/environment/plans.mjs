import { INTERNAL_DATA_FILES, PROTECTED_DATA_FILES } from '../../shared/runtime-data.mjs';

export function runtimeDataFiles() {
  return [...PROTECTED_DATA_FILES, ...INTERNAL_DATA_FILES].map(file => `data/${file}`);
}

export function bootstrapPlan(runtime) {
  return [
    { id: 'validate', type: 'preflight', target: runtime.environment },
    { id: 'runtime-repository', type: 'github-repository', target: runtime.runtimeRepository },
    { id: 'runtime-seed', type: 'runtime-data', target: runtime.runtimeRepository, files: runtimeDataFiles() },
    { id: 'runtime-workflow', type: 'workflow', target: `${runtime.runtimeRepository}/.github/workflows/${runtime.workflow}` },
    { id: 'source-read-access', type: 'github-readonly-source', target: runtime.sourceRepository },
    { id: 'runtime-secrets', type: 'github-secrets', target: runtime.runtimeRepository },
    { id: 'cloudflare-account', type: 'cloudflare-account', target: runtime.cloudflareAccountId },
    { id: 'worker-config', type: 'cloudflare-worker', target: runtime.workerName },
    { id: 'deploy', type: 'deploy', sourceSha: runtime.sourceSha },
    { id: 'health', type: 'health', target: runtime.frontendOrigin },
  ];
}

export function deployPlan(runtime) {
  return [
    { id: 'validate', type: 'preflight', target: runtime.environment },
    { id: 'source-checkout', type: 'git-checkout', repository: runtime.sourceRepository, sha: runtime.sourceSha },
    { id: 'runtime-checkout', type: 'git-checkout', repository: runtime.runtimeRepository, ref: runtime.runtimeRef },
    { id: 'runtime-snapshot', type: 'runtime-data-snapshot', files: runtimeDataFiles() },
    { id: 'build', type: 'worker-build', sourceSha: runtime.sourceSha },
    { id: 'deploy', type: 'worker-deploy', target: runtime.workerName },
    { id: 'health', type: 'health-identity', target: runtime.frontendOrigin },
  ];
}

export function isolationPlan(manifest) {
  return [
    ['dev', 'test'],
    ['dev', 'prod'],
    ['test', 'prod'],
  ].map(([from, to]) => ({
    id: `${from}-cannot-write-${to}`,
    from,
    to,
    runtimeRepository: manifest.environments[to].runtime_repository,
    cloudflareAccountIdEnv: manifest.environments[to].cloudflare_account_id_env,
  }));
}
