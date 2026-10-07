import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { internalAuthContext, withInternalAuthContext } from '../src/internal-auth-context.js';
import { EVALUATION_VERSION, FIT_ALGORITHM_VERSION, evaluateSharedJob, materializeCachedJob } from '../src/profile-evaluation.js';
import { evaluateEligibility } from '../src/eligibility.js';
import { classifyCanonicalJob } from '../../shared/job-classification.mjs';
import {
  decodeJobCursor,
  deterministicTenantEntityUuid,
  encodeJobCursor,
  mergeEffectiveConfig,
  normalizeJobSearchQuery,
  ownerBootstrapPending,
  resolveOrProvisionGoogleIdentity,
  resolveSession,
  revokeSession,
  sessionHash,
  splitLegacyConfig,
} from '../src/multiuser-repository.js';
import { migrationDatabaseConfig } from '../src/db/config.js';
import { runtimePrivilegeReadiness, TENANT_AWARE_TABLES } from '../src/db/privilege-readiness.js';
import { deleteTenantFirst, resolveAccountDeletionTarget } from '../src/db/tenant-gateway.js';
import { provisionRuntimeRole } from '../scripts/db-provision-runtime.mjs';
import { personalPreferencesChanged } from '../src/multiuser-api.js';

const nomenclatures = JSON.parse(
  await readFile(new URL('../../data/nomenclatures.json', import.meta.url), 'utf8'),
);

test('internal AuthContext is a non-forgeable Request capability', () => {
  const source = new Request('https://app.example.test/me/jobs');
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

test('tenant-local Search/Candidate Profile ids are stable, distinct and not the tenant id', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const searchA = deterministicTenantEntityUuid('search-profile', tenantId);
  const searchB = deterministicTenantEntityUuid('search-profile', tenantId);
  const candidate = deterministicTenantEntityUuid('candidate-profile', tenantId);
  assert.equal(searchA, searchB);
  assert.notEqual(searchA, tenantId);
  assert.notEqual(candidate, tenantId);
  assert.notEqual(searchA, candidate);
});

test('missing session and idempotent logout do not require a database binding', async () => {
  await assert.rejects(() => resolveSession(null, {}), error => error?.status === 401);
  assert.equal(await revokeSession(null, {}), false);
});

test('self-service account deletion is same-origin and cannot accept a caller-selected target', async () => {
  const source = await readFile(new URL('../src/multiuser-api.js', import.meta.url), 'utf8');
  const start = source.indexOf("request.method === 'DELETE' && url.pathname === '/me/account'");
  assert.ok(start >= 0);
  const block = source.slice(start, start + 420);
  assert.match(block, /requireSameOrigin\(request, env\)/);
  assert.match(block, /deleteOwnAccount\(context, env\)/);
  assert.match(block, /clearSessionCookie\(\)/);
  assert.doesNotMatch(block, /request\.json|userId|profile_id|tenant_id/);
});

test('DEV provisioning errors expose the failing shared-transaction stage without changing the database flow', async () => {
  const queries = [];
  const query = async text => {
    queries.push(text);
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows:[] };
    if (text.includes("pg_advisory_xact_lock(hashtext('jscc-account-provision'))")) return { rows:[{}] };
    if (text.includes('FROM user_identity i')) return { rows:[] };
    if (text.includes('FROM system_bootstrap')) return { rows:[{ owner_bootstrapped_at:null }] };
    if (text.includes('INSERT INTO app_user')) {
      throw new Error('No tenant ID specified in write query');
    }
    throw new Error(`Unexpected diagnostic-test query: ${text}`);
  };
  const db = {
    query,
    connect:async () => ({ query, release() {} }),
  };

  await assert.rejects(
    () => resolveOrProvisionGoogleIdentity(
      { sub:'owner-sub', email:'owner@example.test', email_verified:true },
      { APP_ENV:'dev', ALLOWED_GOOGLE_SUB:'owner-sub' },
      { db },
    ),
    error => error?.status === 500
      && error.message === '[provision-stage:app-user-insert] No tenant ID specified in write query',
  );
  assert.ok(queries.includes('ROLLBACK'));
});

test('DEV provisioning diagnostics cover pre-transaction identity reads', async () => {
  const db = {
    query:async () => { throw new Error('No tenant ID specified in write query'); },
  };

  await assert.rejects(
    () => resolveOrProvisionGoogleIdentity(
      { sub:'owner-sub' },
      { APP_ENV:'dev', ALLOWED_GOOGLE_SUB:'owner-sub' },
      { db },
    ),
    error => error?.message === '[provision-stage:ready-context-read] No tenant ID specified in write query',
  );
});

test('DEV owner bootstrap preflight exposes its database stage', async () => {
  const db = {
    query:async () => { throw new Error('No tenant ID specified in write query'); },
  };

  await assert.rejects(
    () => ownerBootstrapPending(
      'owner-sub',
      { APP_ENV:'dev', ALLOWED_GOOGLE_SUB:'owner-sub' },
      { db },
    ),
    error => error?.message === '[provision-stage:owner-bootstrap-read] No tenant ID specified in write query',
  );
});

test('non-DEV provisioning errors keep their original message', async () => {
  const query = async text => {
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows:[] };
    if (text.includes("pg_advisory_xact_lock(hashtext('jscc-account-provision'))")) return { rows:[{}] };
    if (text.includes('FROM user_identity i')) return { rows:[] };
    if (text.includes('FROM system_bootstrap')) return { rows:[{ owner_bootstrapped_at:null }] };
    if (text.includes('INSERT INTO app_user')) throw new Error('provider write failed');
    throw new Error(`Unexpected diagnostic-test query: ${text}`);
  };
  const db = {
    query,
    connect:async () => ({ query, release() {} }),
  };

  await assert.rejects(
    () => resolveOrProvisionGoogleIdentity(
      { sub:'owner-sub' },
      { APP_ENV:'test', ALLOWED_GOOGLE_SUB:'owner-sub' },
      { db },
    ),
    error => error?.message === 'provider write failed',
  );
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

test('shared classification reuses canonical role taxonomy and is deterministic', () => {
  const row = {
    title:'Technical Project Manager',
    company:'Example',
    location:'Bucharest',
    country_codes:['RO'],
    work_mode:'remote',
    payload:{
      contract_type:'contract',
      remote_scope:'EU',
      description:'Bank governance delivery',
    },
  };
  const first = classifyCanonicalJob(row);
  const second = classifyCanonicalJob(row);
  assert.equal(first.role_family, 'PROJECT_DELIVERY_MANAGEMENT');
  assert.deepEqual(first.role_subfamily, ['project_management']);
  assert.equal(first.contract_type, 'contract');
  assert.equal(first.remote_scope, 'EU');
  assert.equal(first.classification_status, 'matched');
  assert.equal(first.classification_confidence, 1);
  assert.equal(first.classification_version, '2026.10.08-1');
  assert.equal(first.evaluation_basis_hash.length, 64);
  assert.equal(first.evaluation_basis_hash, second.evaluation_basis_hash);
});

test('Eligibility v1 is tri-state and only explicit contradiction excludes', () => {
  const row = {
    title:'Technical Project Manager',
    company:'Example',
    country_codes:['RO'],
    work_mode:'remote',
    role_family:'PROJECT_DELIVERY_MANAGEMENT',
    role_subfamily:['project_management'],
    contract_type:'contract',
    remote_scope:'Country',
    payload:{ description:'Bank governance project' },
  };
  const criteria = {
    target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],
    target_role_subfamilies:['project_management'],
    target_country_codes:['RO'],
    target_regions:[],
    excluded_country_codes:[],
    excluded_regions:[],
    remote_eligible_country_codes:['RO'],
    work_modes:{ remote:true, hybrid:true, onsite:false },
    contract_types:['contract'],
    keep_reposts:true,
  };

  assert.equal(evaluateEligibility(row, criteria, nomenclatures).state, 'ELIGIBLE');
  assert.deepEqual(
    evaluateEligibility({ ...row, work_mode:'onsite' }, criteria, nomenclatures),
    { state:'INELIGIBLE', reason_code:'WORK_MODE_EXCLUDED', reasons:['WORK_MODE_EXCLUDED'] },
  );
  assert.deepEqual(
    evaluateEligibility({ ...row, contract_type:'unknown' }, criteria, nomenclatures),
    { state:'UNKNOWN', reason_code:'CONTRACT_TYPE_UNKNOWN', reasons:['CONTRACT_TYPE_UNKNOWN'] },
  );
  assert.deepEqual(
    evaluateEligibility({ ...row, role_family:'UNKNOWN' }, criteria, nomenclatures),
    { state:'UNKNOWN', reason_code:'ROLE_FAMILY_UNKNOWN', reasons:['ROLE_FAMILY_UNKNOWN'] },
  );
  assert.equal(
    evaluateEligibility(
      { ...row, country_codes:[], remote_scope:'unknown' },
      criteria,
      nomenclatures,
    ).state,
    'UNKNOWN',
  );
  assert.equal(
    evaluateEligibility(row, { ...criteria, rate_min_eur_day:999, fit_threshold:95 }, nomenclatures).state,
    'ELIGIBLE',
    'soft preferences must not affect Eligibility',
  );
  assert.equal(
    evaluateEligibility(
      { ...row, country_codes:[], remote_scope:'worldwide' },
      criteria,
      nomenclatures,
    ).state,
    'ELIGIBLE',
    'remote scope aliases must normalize canonically',
  );
  assert.deepEqual(
    evaluateEligibility(
      { ...row, country_codes:[], remote_scope:'EMEA' },
      { ...criteria, target_country_codes:['US'], target_regions:[], remote_eligible_country_codes:['US'] },
      nomenclatures,
    ),
    {
      state:'UNKNOWN',
      reason_code:'GEOGRAPHY_SCOPE_PARTIAL_UNKNOWN',
      reasons:['GEOGRAPHY_SCOPE_PARTIAL_UNKNOWN','REMOTE_AUTHORIZATION_SCOPE_UNKNOWN'],
    },
    'EMEA without a canonical membership proof must not be falsely excluded',
  );
});

test('ATC-489-02 migration encodes Search Profile criteria and shared classification versioning', async () => {
  const sql = await readFile(new URL('../migrations/007_shared_classification_eligibility.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE search_profile_preferences/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, search_profile_id\)/);
  assert.match(sql, /ADD COLUMN job_version integer NOT NULL DEFAULT 1/);
  assert.match(sql, /ADD COLUMN role_subfamily text\[\]/);
  assert.match(sql, /ADD COLUMN contract_type text NOT NULL DEFAULT 'unknown'/);
  assert.match(sql, /ADD COLUMN classification_version text NOT NULL DEFAULT 'legacy'/);
  assert.match(sql, /ADD COLUMN evaluation_basis_hash text NOT NULL DEFAULT ''/);
  assert.ok(TENANT_AWARE_TABLES.includes('search_profile_preferences'));
});


test('ATC-489-03 migration rebuilds derived evaluation cache with Search Profile/version identity', async () => {
  const sql = await readFile(new URL('../migrations/008_bounded_search_lazy_fit.sql', import.meta.url), 'utf8');
  assert.match(sql, /TRUNCATE TABLE profile_job_evaluation/);
  assert.match(sql, /ALTER TABLE profile_job_evaluation/);
  assert.match(sql, /search_profile_id uuid NOT NULL/);
  assert.match(sql, /eligibility_state text NOT NULL/);
  assert.match(sql, /profile_version integer NOT NULL/);
  assert.match(sql, /job_version integer NOT NULL/);
  assert.match(sql, /fit_algorithm_version text NOT NULL/);
  assert.match(sql, /PRIMARY KEY\(tenant_id, search_profile_id, job_id\)/);
  assert.doesNotMatch(sql, /DROP TABLE profile_job_evaluation/);
  assert.doesNotMatch(sql, /FOREIGN KEY[\s\S]*search_profile/i);
  assert.doesNotMatch(sql, /FOREIGN KEY[\s\S]*canonical_jobs/i);
});

test('bounded jobs cursor is opaque, deterministic and rejects malformed input', () => {
  const row = {
    sort_at:new Date('2026-10-05T10:00:00Z'),
    job_id:'11111111-1111-4111-8111-111111111111',
  };
  const encoded = encodeJobCursor(row);
  assert.equal(encoded.includes('2026-10-05'), false);
  assert.deepEqual(decodeJobCursor(encoded), {
    sort_at:'2026-10-05T10:00:00.000Z',
    job_id:row.job_id,
  });
  assert.throws(() => decodeJobCursor('not-a-valid-cursor'), /Invalid jobs cursor/);
  const malformedUuidCursor = Buffer.from(JSON.stringify({
    v:1,
    sort_at:'2026-10-05T10:00:00.000Z',
    job_id:'------------------------------------',
  }), 'utf8').toString('base64url');
  assert.throws(() => decodeJobCursor(malformedUuidCursor), /Invalid jobs cursor/);
});

test('bounded jobs query caps page/prefetch and keeps temporary filters view-only', () => {
  const query = normalizeJobSearchQuery({
    limit:'40',
    prefetch:'12',
    role_family:['PROJECT_DELIVERY_MANAGEMENT,PRODUCT_AGILE'],
    role_subfamily:['project_management,product_owner'],
    work_mode:['remote'],
    contract_type:['contract'],
    freshness_hours:'48',
    min_fit:'70',
    include_archived:'true',
    q:'technical project',
  });
  assert.equal(query.limit, 40);
  assert.equal(query.prefetch, 12);
  assert.deepEqual(query.role_family, ['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE']);
  assert.deepEqual(query.role_subfamily, ['project_management','product_owner']);
  assert.deepEqual(query.work_mode, ['remote']);
  assert.deepEqual(query.contract_type, ['contract']);
  assert.equal(query.freshness_hours, 48);
  assert.equal(query.min_fit, 70);
  assert.equal(query.include_archived, true);
  assert.equal(query.q, 'technical project');
  assert.throws(() => normalizeJobSearchQuery({ limit:'101' }), /limit must be an integer/);
  assert.throws(() => normalizeJobSearchQuery({ prefetch:'51' }), /prefetch must be an integer/);
});

test('ATC-489-07 keeps jobs bounded and removes the legacy jobs adapter', async () => {
  const repository = await readFile(new URL('../src/multiuser-repository.js', import.meta.url), 'utf8');
  const boundedStart = repository.indexOf('export async function listProfileJobs(');
  const nextExport = repository.indexOf('\nexport async function nomenclatureReferenceCount', boundedStart);
  const boundedBlock = repository.slice(boundedStart, nextExport);
  assert.match(boundedBlock, /JOB_CANDIDATE_WINDOW_MAX/);
  assert.ok(boundedBlock.includes("LIMIT ${limitParam}::integer"));
  assert.match(boundedBlock, /profile_version/);
  assert.match(boundedBlock, /job_version/);
  assert.match(boundedBlock, /FIT_ALGORITHM_VERSION/);
  assert.match(boundedBlock, /evaluationCacheValid/);
  assert.match(boundedBlock, /spec\.prefetch/);
  assert.doesNotMatch(repository, /export async function evaluateProfileJobs\(/);
  assert.doesNotMatch(repository, /LEGACY_JOB_PAGE_LIMIT/);
});

test('lazy FIT cache-hit materialization is stable with freshly evaluated job output', () => {
  const row = {
    job_id:'55555555-5555-4555-8555-555555555555',
    title:'Technical Project Manager',
    company:'Example Bank',
    location:'Bucharest',
    country_codes:['RO'],
    work_mode:'remote',
    role_family:'PROJECT_DELIVERY_MANAGEMENT',
    role_subfamily:['project_management'],
    contract_type:'contract',
    remote_scope:'Country',
    source_name:'Example',
    canonical_url:'https://example.test/cache-stability',
    posted_at:'2026-10-05T10:00:00Z',
    payload:{ description:'Bank governance B2B project', contract_type:'contract', remote_scope:'Country' },
    posting_payload:{},
  };
  const preferences = {
    target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],
    target_role_subfamilies:['project_management'],
    work_modes:{ remote:true, hybrid:true, onsite:false },
    contract_types:['contract'],
    target_country_codes:['RO'],
    target_regions:[],
    excluded_country_codes:[],
    excluded_regions:[],
    remote_eligible_country_codes:['RO'],
    fit_threshold:80,
    keep_reposts:true,
  };
  const evaluated = evaluateSharedJob(row, preferences, nomenclatures, new Date('2026-10-05T12:00:00Z'));
  assert.equal(evaluated.eligible, true);
  const cached = materializeCachedJob(row, evaluated, preferences, new Date('2026-10-05T12:00:00Z'));
  assert.deepEqual(cached, evaluated.job);
});

test('Selection Criteria authority uses Search Profile preferences and semantic profile versioning', async () => {
  const repository = await readFile(new URL('../src/multiuser-repository.js', import.meta.url), 'utf8');
  const saveStart = repository.indexOf('export async function savePreferences(');
  const saveEnd = repository.indexOf('\nexport async function ', saveStart + 1);
  const block = repository.slice(saveStart, saveEnd);
  assert.match(block, /search_profile_preferences/);
  assert.match(block, /preferences IS DISTINCT FROM/);
  assert.match(block, /profile_version=profile_version\+1/);
  assert.doesNotMatch(block, /INSERT INTO profile_preferences/);
});

test('same shared job can produce different per-profile eligibility without provider retrieval', () => {
  const row = {
    job_id:'00000000-0000-0000-0000-000000000001',
    title:'Technical Project Manager',
    company:'Example',
    location:'Bucharest',
    country_codes:['RO'],
    work_mode:'remote',
    role_family:'PROJECT_DELIVERY_MANAGEMENT',
    source_name:'Example',
    canonical_url:'https://example.test/job',
    posted_at:'2026-10-01T00:00:00Z',
    payload:{ description:'Bank governance project', contract_type:'contract', countries:['Romania'] },
    posting_payload:{},
  };
  const base = {
    target_role_families:['PROJECT_DELIVERY_MANAGEMENT'],
    target_role_subfamilies:['project_management'],
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
  assert.equal(EVALUATION_VERSION, 'fit-v1');
  assert.equal(FIT_ALGORITHM_VERSION, 'fit-v1');
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


test('DEV/TEST shared-role privilege mode accepts tenant-aware schema but records residual risk', async () => {
  const rows = TENANT_AWARE_TABLES.map(table_name => ({
    table_name,
    tenant_id_ready:true,
    owner_role:'khnum_user',
    owned_by_runtime:true,
    member_of_owner:true,
  }));
  const db = {
    calls:0,
    async query() {
      this.calls += 1;
      if (this.calls === 1) {
        return { rows:[{
          role_name:'khnum_user',
          rolsuper:false,
          rolbypassrls:false,
          rolcreaterole:false,
          schema_create:true,
          database_create:true,
        }] };
      }
      return { rows };
    },
  };
  const result = await runtimePrivilegeReadiness({
    APP_ENV:'dev',
    JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'true',
  }, { db });
  assert.equal(result.status, 'ok');
  assert.equal(result.mode, 'dev_test_shared_role_exception');
  assert.equal(result.strict_privilege_separation, false);
  assert.equal(result.residual_global_mode_cross_tenant, true);
  assert.equal(result.tenant_tables.every(item => item.present && item.tenant_id_ready), true);
});

test('shared-role override never makes PROD privilege readiness pass', async () => {
  const rows = TENANT_AWARE_TABLES.map(table_name => ({
    table_name,
    tenant_id_ready:true,
    owner_role:'khnum_user',
    owned_by_runtime:true,
    member_of_owner:true,
  }));
  const db = {
    calls:0,
    async query() {
      this.calls += 1;
      if (this.calls === 1) {
        return { rows:[{
          role_name:'khnum_user',
          rolsuper:false,
          rolbypassrls:false,
          rolcreaterole:false,
          schema_create:true,
          database_create:true,
        }] };
      }
      return { rows };
    },
  };
  const result = await runtimePrivilegeReadiness({
    APP_ENV:'prod',
    JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'true',
  }, { db });
  assert.equal(result.status, 'unsafe');
  assert.equal(result.mode, 'unsafe');
});

test('runtime provisioning is explicitly skipped under DEV/TEST shared-role mode', async () => {
  const result = await provisionRuntimeRole({
    APP_ENV:'dev',
    NILE_DATABASE_URL:'postgresql://khnum_user:secret@db.example/jobsearch_dev',
    JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'true',
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.mode, 'dev_test_shared_role_exception');
  assert.equal(result.runtime_role, 'khnum_user');
});

test('multiuser migration encodes Nile tenant-aware ownership and contains no RLS DDL', async () => {
  const sql = await readFile(new URL('../migrations/003_multiuser_core.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tenants/);
  assert.match(sql, /profile_id uuid PRIMARY KEY,/);
  assert.doesNotMatch(sql, /profile_id uuid PRIMARY KEY REFERENCES tenants\(id\)/);
  assert.match(sql, /provisioned_at timestamptz/);
  assert.match(sql, /deletion_started_at timestamptz/);
  assert.match(sql, /deletion_initiated_by text/);
  for (const table of ['profile_preferences','profile_job_state','profile_job_evaluation','applications','profile_notes','profile_ui_preferences']) {
    const marker = `CREATE TABLE ${table} (`;
    const start = sql.indexOf(marker);
    assert.ok(start >= 0, `missing CREATE TABLE block for ${table}`);
    const end = sql.indexOf('\n);', start);
    assert.ok(end > start, `unterminated CREATE TABLE block for ${table}`);
    const block = sql.slice(start, end + 3);
    assert.match(block, /tenant_id uuid[^,\n]*REFERENCES tenants\(id\) ON DELETE CASCADE/);
    assert.doesNotMatch(block, /profile_id uuid/);
  }
  assert.match(sql, /PRIMARY KEY\(tenant_id, application_id\)/);
  assert.doesNotMatch(sql, /job_id uuid(?: NOT NULL)? REFERENCES canonical_jobs/);
  assert.match(sql, /user_id uuid NOT NULL UNIQUE REFERENCES app_user\(user_id\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY/i);
  assert.doesNotMatch(sql, /jscc\.(?:user_id|profile_id)/i);
  assert.match(sql, /CREATE TABLE system_bootstrap/);
  assert.doesNotMatch(sql, /owner_profile_id/);
});

test('search profile foundation migration keeps tenant/workspace separate and uses a logical Candidate Profile reference', async () => {
  const sql = await readFile(new URL('../migrations/006_search_profile_foundation.sql', import.meta.url), 'utf8');
  for (const table of ['candidate_profile','search_profile']) {
    const marker = `CREATE TABLE ${table} (`;
    const start = sql.indexOf(marker);
    assert.ok(start >= 0, `missing CREATE TABLE block for ${table}`);
    const end = sql.indexOf('\n);', start);
    assert.ok(end > start, `unterminated CREATE TABLE block for ${table}`);
    const block = sql.slice(start, end + 3);
    assert.match(block, /tenant_id uuid[^,\n]*REFERENCES tenants\(id\) ON DELETE CASCADE/);
  }
  assert.match(sql, /PRIMARY KEY \(tenant_id, candidate_profile_id\)/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, search_profile_id\)/);
  assert.doesNotMatch(
    sql,
    /FOREIGN KEY \(tenant_id, candidate_profile_id\)[\s\S]*REFERENCES candidate_profile\(tenant_id, candidate_profile_id\)/,
  );
  assert.doesNotMatch(sql, /UNIQUE\s*\(tenant_id\)/i);
  assert.ok(TENANT_AWARE_TABLES.includes('candidate_profile'));
  assert.ok(TENANT_AWARE_TABLES.includes('search_profile'));
});

test('account delete target resolution fails closed when user exists without tenant/profile mapping', async () => {
  const db = {
    async query(sql) {
      assert.match(sql, /LEFT JOIN profile/);
      return {
        rows:[{
          user_id:'11111111-1111-4111-8111-111111111111',
          profile_id:null,
        }],
      };
    },
  };
  await assert.rejects(
    resolveAccountDeletionTarget(db, '11111111-1111-4111-8111-111111111111'),
    error => error?.status === 503 && /mapping is unavailable/.test(error.message),
  );
});

test('tenant lifecycle delete starts with tenant DML and is independently idempotent', async () => {
  const calls = [];
  const tx = {
    async query(sql) {
      calls.push(sql);
      assert.equal(calls.length, 1);
      assert.match(sql, /^DELETE FROM tenants/);
      return { rows:[{ id:'22222222-2222-4222-8222-222222222222' }] };
    },
  };

  const result = await deleteTenantFirst(tx, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.deleted, true);
  assert.match(calls[0], /^DELETE FROM tenants/);
});

test('ADMIN and SELF deletion converge on the staged lifecycle gateway', async () => {
  const repository = await readFile(new URL('../src/multiuser-repository.js', import.meta.url), 'utf8');
  const gateway = await readFile(new URL('../src/db/tenant-gateway.js', import.meta.url), 'utf8');
  const lifecycle = repository.match(/async function deleteAccountLifecycle[\s\S]*?^}/m)?.[0] || '';
  const admin = repository.match(/export async function deleteAccount\([\s\S]*?^}/m)?.[0] || '';
  const self = repository.match(/export async function deleteOwnAccount[\s\S]*?^}/m)?.[0] || '';

  assert.match(lifecycle, /startAccountDeletion/);
  assert.match(lifecycle, /deleteTenantDomain/);
  assert.match(lifecycle, /verifyTenantPersonalResidue/);
  assert.match(lifecycle, /finalizeAccountDeletion/);
  assert.doesNotMatch(lifecycle, /withTenantTransaction/i);

  assert.match(admin, /requireAdmin\(authContext\)/);
  assert.match(admin, /deleteAccountLifecycle\(userId, 'ADMIN'/);
  assert.match(self, /deleteAccountLifecycle\(authContext\.user_id, 'SELF'/);
  assert.doesNotMatch(self, /userId|request\.json/);

  assert.match(repository, /deletion_started_at/);
  assert.match(repository, /deletion_initiated_by/);
  assert.match(repository, /DELETE FROM app_user WHERE user_id=\$1 RETURNING user_id/);
  assert.match(gateway, /DELETE FROM tenants WHERE id=\$1 RETURNING id/);
  assert.match(gateway, /Tenant deletion left personal residue/);
  assert.doesNotMatch(gateway, /DELETE FROM app_user/);
  assert.doesNotMatch(gateway, /jscc\.(?:user_id|profile_id)/i);
});



test('preference response changed flag reflects semantic personal change only', () => {
  const current = {
    schema_version:'1.0',
    work_modes:{ remote:true, hybrid:true, onsite:false },
    target_country_codes:['RO'],
    search_country_codes:['RO'],
    jobspipe_mode:'disabled',
  };
  assert.equal(personalPreferencesChanged(current, structuredClone(current)), false);
  assert.equal(
    personalPreferencesChanged(current, {
      ...structuredClone(current),
      work_modes:{ remote:true, hybrid:true, onsite:true },
    }),
    true,
  );
  assert.equal(
    personalPreferencesChanged(current, { ...structuredClone(current), jobspipe_mode:'direct' }),
    false,
    'system collection policy must not affect personal semantic changed flag',
  );
});