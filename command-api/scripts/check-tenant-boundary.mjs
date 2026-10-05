import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const PERSONAL_TABLES = [
  'candidate_profile',
  'search_profile',
  'search_profile_preferences',
  'profile_preferences',
  'profile_job_state',
  'profile_job_evaluation',
  'applications',
  'profile_notes',
  'profile_ui_preferences',
];

const PERSONAL_SQL_ALLOWED = new Set([
  'multiuser-repository.js',
  'db/tenant-gateway.js',
  'db/privilege-readiness.js',
  'db/cross-tenant-reference-guard.js',
  'db/cross-tenant-refresh-scope-aggregator.js',
  'db/atc-489-02-backfill.js',
]);

const TENANT_PRIMITIVE_ALLOWED = new Set([
  'db/tenant-gateway.js',
]);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes:true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

function fail(message) {
  process.stderr.write(`tenant-boundary guard: ${message}\n`);
  process.exitCode = 1;
}

function sourceHasSqlReference(source, table) {
  // Table names are internal constants containing only [a-z_], so they can be
  // embedded directly in this regex without accepting caller-controlled input.
  const reference = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE|REFERENCES)\\s+(?:public\\.)?["']?${table}["']?\\b`
      + `|\\bDELETE\\s+FROM\\s+(?:public\\.)?["']?${table}["']?\\b`,
    'i',
  );
  return reference.test(source);
}

const files = await walk(SRC_ROOT);
for (const path of files) {
  const rel = relative(SRC_ROOT, path).replaceAll('\\', '/');
  const source = await readFile(path, 'utf8');

  const personalHits = PERSONAL_TABLES.filter(table => sourceHasSqlReference(source, table));
  if (personalHits.length && !PERSONAL_SQL_ALLOWED.has(rel)) {
    fail(`${rel} contains personal-table SQL outside the allowlist: ${personalHits.join(', ')}`);
  }

  if (
    (source.includes('nile.tenant_id')
      || /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+tenants\b/i.test(source))
    && !TENANT_PRIMITIVE_ALLOWED.has(rel)
  ) {
    fail(`${rel} references Nile tenant-management primitives outside tenant-gateway.js`);
  }
}


const refreshAggregatorPath = join(SRC_ROOT, 'db/cross-tenant-refresh-scope-aggregator.js');
const refreshAggregator = await readFile(refreshAggregatorPath, 'utf8');
const refreshSelect = refreshAggregator.match(/SELECT[\s\S]*?FROM search_profile/i)?.[0] || '';
for (const forbidden of ['tenant_id','search_profile_id','user_id','email','structured_evidence','applications','profile_job_evaluation']) {
  if (new RegExp('\\b' + forbidden + '\\b', 'i').test(refreshSelect)) {
    fail(`cross-tenant refresh aggregator SELECT leaks forbidden field: ${forbidden}`);
  }
}
if (!refreshAggregator.includes("account.status = 'ACTIVE'") || !refreshAggregator.includes("sp.status = 'ACTIVE'")) {
  fail('cross-tenant refresh aggregator must restrict active accounts and Search Profiles');
}

const repositoryPath = join(SRC_ROOT, 'multiuser-repository.js');
const repository = await readFile(repositoryPath, 'utf8');

for (const fn of [
  'effectiveConfig',
  'savePreferences',
  'listProfileJobs',
  'setJobState',
  'listApplications',
  'createApplication',
  'updateApplication',
  'deleteApplication',
]) {
  const start = repository.indexOf(`export async function ${fn}(`);
  if (start < 0) {
    fail(`missing expected personal repository function ${fn}`);
    continue;
  }
  const next = repository.indexOf('\nexport async function ', start + 1);
  const block = repository.slice(start, next < 0 ? repository.length : next);
  if (!block.includes('withTenantTransaction(')) {
    fail(`${fn} does not use withTenantTransaction`);
  }
}

// ATC-489-03: the legacy jobs endpoint is a compatibility adapter only.
// It may delegate to the guarded listProfileJobs() boundary, but it must not
// regain direct personal/shared SQL or a second tenant-transaction implementation.
{
  const fn = 'evaluateProfileJobs';
  const start = repository.indexOf(`export async function ${fn}(`);
  const next = start < 0 ? -1 : repository.indexOf('\nexport async function ', start + 1);
  const block = start < 0 ? '' : repository.slice(start, next < 0 ? repository.length : next);
  if (start < 0) {
    fail(`missing expected compatibility adapter ${fn}`);
  } else {
    if (!block.includes('listProfileJobs(')) {
      fail(`${fn} must delegate to listProfileJobs`);
    }
    if (block.includes('withTenantTransaction(') || /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\b/i.test(block)) {
      fail(`${fn} compatibility adapter must not own SQL or tenant transactions`);
    }
  }
}

if (/set_config\('jscc\.(?:user_id|profile_id)'/i.test(repository)) {
  fail('superseded jscc.user_id/jscc.profile_id session context remains in runtime code');
}

if (!process.exitCode) {
  process.stdout.write('ADR-008 tenant-boundary static guard: PASS\n');
}
