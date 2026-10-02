import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { internalAuthContext, withInternalAuthContext } from '../src/internal-auth-context.js';
import { EVALUATION_VERSION, evaluateSharedJob } from '../src/profile-evaluation.js';
import {
  mergeEffectiveConfig,
  resolveSession,
  revokeSession,
  sessionHash,
  splitLegacyConfig,
} from '../src/multiuser-repository.js';
import { migrationDatabaseConfig } from '../src/db/config.js';

const nomenclatures = JSON.parse(
  await readFile(new URL('../../data/nomenclatures.json', import.meta.url), 'utf8'),
);

test('internal AuthContext is a non-forgeable Request capability', () => {
  const source = new Request('https://app.example.test/data/jobs.json');
  const context = { user_id:'u', profile_id:'p', role:'USER', status:'ACTIVE' };
  const forwarded = withInternalAuthContext(source, context);
  assert.equal(internalAuthContext(source), null);
  assert.deepEqual(internalAuthContext(forwarded), context);
  assert.equal(forwarded.headers.get('x-jscc-user-id'), null);
});

test('session hash is deterministic SHA-256 and raw token is never the persisted identifier', () => {
  const raw = 'x'.repeat(43);
  const hash = sessionHash(raw);
  assert.equal(hash.length, 64);
  assert.equal(hash, sessionHash(raw));
  assert.notEqual(hash, raw);
});

test('missing session and idempotent logout do not require a database binding', async () => {
  await assert.rejects(() => resolveSession(null, {}), error => error?.status === 401);
  assert.equal(await revokeSession(null, {}), false);
});

test('legacy configuration splits profile preferences from system collection policy', () => {
  const input = {
    role_groups:{ pm:{ enabled:true } },
    target_country_codes:['RO'],
    freshness_hours:24,
    collection_freshness_hours:48,
    source_strategy:'shared',
    jobspipe_mode:'disabled',
    web_browser_fallback_enabled:false,
  };
  const { personal, system } = splitLegacyConfig(input);
  assert.deepEqual(personal.target_country_codes, ['RO']);
  assert.equal(personal.freshness_hours, 24);
  const migrated = splitLegacyConfig({ eligible_remote_country_codes:['RO'] });
  assert.deepEqual(migrated.personal.remote_eligible_country_codes, ['RO']);
  assert.equal('eligible_remote_country_codes' in migrated.personal, false);
  assert.equal('source_strategy' in personal, false);
  assert.equal(system.collection_freshness_hours, 48);
  assert.equal(system.source_strategy, 'shared');
  assert.equal(system.jobspipe_mode, 'disabled');
  const merged = mergeEffectiveConfig(personal, system);
  assert.deepEqual(merged.search_country_codes, ['RO']);
});

test('same shared job can produce different per-profile eligibility without provider retrieval', () => {
  const row = {
    job_id:'00000000-0000-0000-0000-000000000001',
    title:'Technical Project Manager',
    company:'Example',
    location:'Bucharest',
    country_codes:['RO'],
    work_mode:'remote',
    role_family:'PROJECT_MANAGEMENT',
    source_name:'Example',
    canonical_url:'https://example.test/job',
    posted_at:'2026-10-01T00:00:00Z',
    payload:{ description:'Bank governance project', contract_type:'contract', countries:['Romania'] },
    posting_payload:{},
  };
  const base = {
    role_groups:{ pm:{ enabled:true } },
    work_modes:{ remote:true, hybrid:true, onsite:false },
    contract_types:['contract'],
    target_country_codes:['RO'],
    target_regions:[],
    remote_eligible_country_codes:['RO'],
    excluded_country_codes:[],
    excluded_regions:[],
    keep_reposts:true,
    fit_threshold:80,
  };
  const allowed = evaluateSharedJob(row, base, nomenclatures, new Date('2026-10-01T12:00:00Z'));
  const blocked = evaluateSharedJob(row, { ...base, work_modes:{ ...base.work_modes, remote:false } }, nomenclatures, new Date('2026-10-01T12:00:00Z'));
  assert.equal(allowed.eligible, true);
  assert.equal(typeof allowed.score, 'number');
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.exclusionReason, 'remote disabled');
  const unknownRole = evaluateSharedJob(
    { ...row, role_family:'UNKNOWN' },
    base,
    nomenclatures,
    new Date('2026-10-01T12:00:00Z'),
  );
  assert.equal(unknownRole.eligible, true, 'unknown is not an explicit incompatibility');
  const incompatibleRemote = evaluateSharedJob(
    { ...row, country_codes:['US'], payload:{ ...row.payload, remote_scope:'Country' } },
    { ...base, target_country_codes:['US'], remote_eligible_country_codes:['RO'] },
    nomenclatures,
    new Date('2026-10-01T12:00:00Z'),
  );
  assert.equal(incompatibleRemote.eligible, false);
  assert.equal(incompatibleRemote.exclusionReason, 'remote eligibility geography incompatible');
  assert.equal(EVALUATION_VERSION, 'multiuser-v1');
});

test('migration credential remains fail-closed except for explicit DEV/TEST shared-role migration work', () => {
  const dev = {
    APP_ENV:'dev',
    NILE_DATABASE_URL:'postgresql://runtime:secret@db.example/jobsearch_dev',
  };
  assert.throws(() => migrationDatabaseConfig(dev), /NILE_MIGRATION_DATABASE_URL is required/);
  assert.throws(
    () => migrationDatabaseConfig({ ...dev, NILE_MIGRATION_DATABASE_URL:dev.NILE_DATABASE_URL }),
    /must be distinct/,
  );

  const devShared = migrationDatabaseConfig({
    ...dev,
    NILE_MIGRATION_DATABASE_URL:dev.NILE_DATABASE_URL,
    JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'true',
  });
  assert.equal(devShared.expectedDatabase, 'jobsearch_dev');

  const testEnv = {
    APP_ENV:'test',
    NILE_DATABASE_URL:'postgresql://runtime:secret@db.example/jobsearch_test',
    NILE_MIGRATION_DATABASE_URL:'postgresql://runtime:secret@db.example/jobsearch_test',
    JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'TRUE',
  };
  assert.equal(migrationDatabaseConfig(testEnv).expectedDatabase, 'jobsearch_test');

  const prod = {
    APP_ENV:'prod',
    NILE_DATABASE_URL:'postgresql://runtime:secret@db.example/jobsearch_prod',
    NILE_MIGRATION_DATABASE_URL:'postgresql://runtime:secret@db.example/jobsearch_prod',
    JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'true',
  };
  assert.throws(() => migrationDatabaseConfig(prod), /must be distinct/);

  const distinct = migrationDatabaseConfig({
    ...dev,
    NILE_MIGRATION_DATABASE_URL:'postgresql://migration:secret@db.example/jobsearch_dev',
  });
  assert.equal(distinct.expectedDatabase, 'jobsearch_dev');
});

test('multiuser migration encodes mandatory direct tenant RLS and account cascades', async () => {
  const sql = await readFile(new URL('../migrations/003_multiuser_core.sql', import.meta.url), 'utf8');
  for (const table of ['profile','profile_preferences','profile_job_state','profile_job_evaluation','applications','profile_notes','profile_ui_preferences']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  for (const table of ['profile_preferences','profile_job_state','profile_job_evaluation','applications','profile_notes','profile_ui_preferences']) {
    const block = sql.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0] || '';
    assert.ok(block, `missing CREATE TABLE block for ${table}`);
    assert.match(block, /profile_id uuid[^,\n]*REFERENCES profile\(profile_id\) ON DELETE CASCADE/);
  }
  assert.match(sql, /user_id uuid NOT NULL REFERENCES app_user\(user_id\) ON DELETE CASCADE/);
  assert.match(sql, /current_setting\('jscc\.profile_id', true\)/);
  assert.match(sql, /current_setting\('jscc\.user_id', true\)/);
  assert.match(sql, /CREATE TABLE system_bootstrap/);
  assert.doesNotMatch(sql, /owner_profile_id/);
  assert.doesNotMatch(sql, /BYPASSRLS/i);
});

test('admin deletion contract is narrow account-domain delete and contains no profile impersonation', async () => {
  const source = await readFile(new URL('../src/multiuser-repository.js', import.meta.url), 'utf8');
  const block = source.match(/export async function deleteAccount[\s\S]*?^}/m)?.[0] || '';
  assert.match(block, /DELETE FROM app_user WHERE user_id=\$1 RETURNING user_id/);
  assert.doesNotMatch(block, /set_config\('jscc\.profile_id'/i);
  assert.doesNotMatch(block, /withTenantTransaction/i);
});
