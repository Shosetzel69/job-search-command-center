import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

import {
  createApplication,
  createSession,
  deleteAccount,
  deleteApplication,
  effectiveConfig,
  ensureSearchProfileFoundation,
  listApplications,
  listProfileJobs,
  nomenclatureReferenceCount,
  resolveActiveSearchProfile,
  resolveOrProvisionGoogleIdentity,
  resolveSession,
  savePreferences,
  setAccountStatus,
  updateApplication,
} from '../src/multiuser-repository.js';
import { runtimePrivilegeReadiness } from '../src/db/privilege-readiness.js';
import { backfillSearchProfileFoundations } from '../src/db/search-profile-backfill.js';
import { withTenantTransaction } from '../src/db/tenant-gateway.js';
import { deleteNomenclatureValue } from '../src/nomenclature-governance.js';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;

const runtimeUrl = process.env.JSCC_INTEGRATION_DATABASE_URL;
const migrationUrl = process.env.NILE_MIGRATION_DATABASE_URL;
const adminUrl = process.env.JSCC_TEST_ADMIN_DATABASE_URL;
const enabled = Boolean(runtimeUrl && migrationUrl && adminUrl);

test('real PostgreSQL multiuser isolation, lifecycle and privilege contract', { skip:!enabled }, async () => {
  const runtimeDb = new Pool({ connectionString:runtimeUrl, max:6 });
  const migrationDb = new Pool({ connectionString:migrationUrl, max:2 });
  const adminDb = new Pool({ connectionString:adminUrl, max:1 });
  const tenantProbeDb = new Pool({ connectionString:runtimeUrl, max:1 });
  const env = {
    APP_ENV:'dev',
    NILE_DATABASE_URL:runtimeUrl,
    NILE_MIGRATION_DATABASE_URL:migrationUrl,
    JSCC_MAX_USERS:'50',
    BOOTSTRAP_ADMIN_GOOGLE_SUB:'owner-sub',
  };

  try {
    const privilege = await runtimePrivilegeReadiness(env, { db:runtimeDb });
    assert.equal(privilege.status, 'ok');
    assert.equal(privilege.superuser, false);
    assert.equal(privilege.schema_create, false);
    assert.equal(privilege.database_create, false);
    assert.equal(privilege.residual_global_mode_cross_tenant, true);
    assert.equal(privilege.tenant_tables.every(item =>
      item.present && item.tenant_id_ready && !item.owned_by_runtime && !item.member_of_owner
    ), true);

    await assert.rejects(
      runtimeDb.query('CREATE TABLE runtime_must_not_create(id integer)'),
      /permission denied/i,
    );
    await assert.rejects(
      runtimeDb.query('ALTER TABLE profile ADD COLUMN runtime_must_not_add integer'),
      /must be owner|permission denied/i,
    );

    const ownerSeed = {
      config:{
        role_groups:{ pm:{ enabled:true } },
        rate_min_eur_day:999,
        target_regions:['EU'],
        excluded_company_patterns:['owner-secret-company'],
        work_modes:{ remote:true, hybrid:true, onsite:false },
        contract_types:['contract'],
        collection_freshness_hours:72,
        source_strategy:'shared',
        jobspipe_mode:'disabled',
      },
      applications:{
        schema_version:'1.0',
        applications:[{
          id:'legacy-owner-app',
          company:'Legacy Owner Co',
          title:'Legacy Project Manager',
          status:'applied',
          applied_at:'2026-09-01',
        }],
      },
    };

    const ownerPayload = { sub:'owner-sub', email:'owner@example.test', email_verified:true };
    const [ownerA, ownerB] = await Promise.all([
      resolveOrProvisionGoogleIdentity(ownerPayload, env, { db:runtimeDb, bootstrapSeed:ownerSeed }),
      resolveOrProvisionGoogleIdentity(ownerPayload, env, { db:runtimeDb, bootstrapSeed:ownerSeed }),
    ]);
    assert.equal(ownerA.user_id, ownerB.user_id);
    assert.equal(ownerA.profile_id, ownerB.profile_id);
    assert.equal(ownerA.role, 'ADMIN');
    assert.equal(ownerB.role, 'ADMIN');

    const ownerFoundationA = await resolveActiveSearchProfile(ownerA, env, { db:runtimeDb });
    const ownerFoundationB = await ensureSearchProfileFoundation(ownerB, env, { db:runtimeDb });
    assert.equal(ownerFoundationA.search_profile_id, ownerFoundationB.search_profile_id);
    assert.equal(ownerFoundationA.candidate_profile_id, ownerFoundationB.candidate_profile_id);
    assert.notEqual(ownerFoundationA.search_profile_id, ownerA.profile_id);
    assert.notEqual(ownerFoundationA.candidate_profile_id, ownerA.profile_id);
    assert.notEqual(ownerFoundationA.search_profile_id, ownerFoundationA.candidate_profile_id);

    const ownerConfig = await effectiveConfig(ownerA, env, { db:runtimeDb });
    assert.equal(ownerConfig.rate_min_eur_day, 999);
    assert.deepEqual(ownerConfig.excluded_company_patterns, ['owner-secret-company']);
    assert.equal((await listApplications(ownerA, env, { db:runtimeDb })).applications.length, 1);

    const user = await resolveOrProvisionGoogleIdentity(
      { sub:'user-b', email:'user-b@example.test', email_verified:true },
      env,
      { db:runtimeDb },
    );
    assert.equal(user.role, 'USER');

    const userFoundation = await resolveActiveSearchProfile(user, env, { db:runtimeDb });
    assert.notEqual(userFoundation.search_profile_id, user.profile_id);
    assert.notEqual(userFoundation.candidate_profile_id, user.profile_id);
    assert.notEqual(userFoundation.search_profile_id, ownerFoundationA.search_profile_id);

    const ownerProfileProbe = await withTenantTransaction(user, async tx => {
      const result = await tx.query(
        'SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND search_profile_id=$2',
        [user.profile_id, ownerFoundationA.search_profile_id],
      );
      return result.rows;
    }, { env, db:runtimeDb });
    assert.equal(ownerProfileProbe.length, 0);

    await withTenantTransaction(user, async tx => {
      await tx.query(
        'DELETE FROM candidate_profile WHERE tenant_id=$1 AND candidate_profile_id=$2',
        [user.profile_id, userFoundation.candidate_profile_id],
      );
    }, { env, db:runtimeDb });
    await assert.rejects(
      resolveActiveSearchProfile(user, env, { db:runtimeDb }),
      error => error?.status === 503
        && /Candidate Profile reference is unavailable/.test(error.message),
    );
    const repairedFoundation = await ensureSearchProfileFoundation(user, env, { db:runtimeDb });
    assert.equal(repairedFoundation.search_profile_id, userFoundation.search_profile_id);
    assert.equal(repairedFoundation.candidate_profile_id, userFoundation.candidate_profile_id);

    await withTenantTransaction(user, async tx => {
      await tx.query('DELETE FROM search_profile WHERE tenant_id=$1', [user.profile_id]);
      await tx.query('DELETE FROM candidate_profile WHERE tenant_id=$1', [user.profile_id]);
    }, { env, db:runtimeDb });
    await assert.rejects(
      resolveActiveSearchProfile(user, env, { db:runtimeDb }),
      error => error?.status === 503,
    );
    const backfill = await backfillSearchProfileFoundations(env, { db:runtimeDb });
    assert.ok(backfill.processed >= 2);
    const restoredFoundation = await resolveActiveSearchProfile(user, env, { db:runtimeDb });
    assert.equal(restoredFoundation.search_profile_id, userFoundation.search_profile_id);
    assert.equal(restoredFoundation.candidate_profile_id, userFoundation.candidate_profile_id);

    const userConfig = await effectiveConfig(user, env, { db:runtimeDb });
    assert.equal('rate_min_eur_day' in userConfig, false);
    assert.equal('excluded_company_patterns' in userConfig, false);
    assert.equal('target_regions' in userConfig, false);

    const storedUserPrefs = await adminDb.query(
      `SELECT preferences
         FROM search_profile_preferences
        WHERE tenant_id=$1 AND search_profile_id=$2`,
      [user.profile_id, userFoundation.search_profile_id],
    );
    assert.deepEqual(storedUserPrefs.rows[0].preferences, {});

    const noContext = await runtimeDb.query('SELECT count(*)::integer AS count FROM search_profile_preferences');
    assert.ok(
      Number(noContext.rows[0].count) >= 2,
      'ADR-008 residual risk must stay explicit: no-context/global mode can see multiple tenants',
    );

    const scopedTenant = await withTenantTransaction(user, async tx => {
      const context = await tx.query("SELECT current_setting('nile.tenant_id', true) AS tenant_id");
      return String(context.rows[0].tenant_id);
    }, { env, db:tenantProbeDb });
    assert.equal(scopedTenant, user.profile_id);

    const afterCommit = await tenantProbeDb.query(
      "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
    );
    assert.equal(String(afterCommit.rows[0].tenant_id || '').trim(), '');

    await assert.rejects(
      withTenantTransaction(user, async tx => {
        const context = await tx.query("SELECT current_setting('nile.tenant_id', true) AS tenant_id");
        assert.equal(String(context.rows[0].tenant_id), user.profile_id);
        throw new Error('forced rollback');
      }, { env, db:tenantProbeDb }),
      /forced rollback/,
    );
    const afterRollback = await tenantProbeDb.query(
      "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
    );
    assert.equal(String(afterRollback.rows[0].tenant_id || '').trim(), '');

    const ownerApplication = await createApplication(ownerA, {
      company:'Tenant A',
      title:'Project Manager',
      status:'applied',
    }, env, { db:runtimeDb });

    await assert.rejects(
      updateApplication(user, ownerApplication.id, { status:'interview' }, env, { db:runtimeDb }),
      error => error?.status === 404,
    );

    const versionBeforePreferences = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    const criteria = {
      target_regions:['EU'],
      remote_eligible_country_codes:['RO'],
      work_modes:{ remote:true },
      contract_types:['contract'],
    };
    await savePreferences(user, criteria, env, { db:runtimeDb });
    const versionAfterChange = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    assert.equal(versionAfterChange, versionBeforePreferences + 1);

    await savePreferences(user, criteria, env, { db:runtimeDb });
    const versionAfterNoop = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    assert.equal(versionAfterNoop, versionAfterChange);

    await savePreferences(user, {
      ...criteria,
      work_modes:{ remote:true, hybrid:true },
    }, env, { db:runtimeDb });
    const versionAfterSecondChange = (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version;
    assert.equal(versionAfterSecondChange, versionAfterChange + 1);
    await createApplication(user, {
      company:'Tenant B',
      title:'Delivery Manager',
      status:'applied',
    }, env, { db:runtimeDb });

    const lazyJobId = '33333333-3333-4333-8333-333333333333';
    const lazyPostingId = '44444444-4444-4444-8444-444444444444';
    await adminDb.query(
      `INSERT INTO canonical_jobs(
          job_id, title, company, location, country_codes, work_mode, role_family,
          lifecycle_status, first_seen_at, last_seen_at, payload,
          job_version, role_subfamily, seniority, contract_type, remote_scope,
          classification_status, classification_confidence, classification_version,
          evaluation_basis_hash
        )
        VALUES (
          $1, 'ATC48903CACHE Technical Project Manager', 'Cache Example', 'Bucharest',
          ARRAY['RO']::text[], 'remote', 'PROJECT_MANAGEMENT',
          'ACTIVE', $2, $2, '{"description":"Bank governance contract role"}'::jsonb,
          1, ARRAY['technical_project_manager']::text[], 'mid', 'contract', 'Country',
          'matched', 1, '2026.09.25-1', repeat('a', 64)
        )
        ON CONFLICT(job_id) DO UPDATE SET
          title=EXCLUDED.title,
          last_seen_at=EXCLUDED.last_seen_at,
          job_version=EXCLUDED.job_version`,
      [lazyJobId, new Date('2026-10-05T10:00:00Z')],
    );
    await adminDb.query(
      `INSERT INTO source_postings(
          posting_id, job_id, source_id, source_name, external_job_id,
          canonical_url, identity_kind, identity_value, posted_at,
          lifecycle_status, first_seen_at, last_seen_at, seen_run_id, payload
        )
        VALUES (
          $1, $2, 'integration-atc-489-03', 'Integration',
          'atc-489-03-cache-job', 'https://example.test/atc-489-03-cache-job',
          'EXTERNAL_ID', 'atc-489-03-cache-job', $3,
          'ACTIVE', $3, $3, 'integration-atc-489-03', '{}'::jsonb
        )
        ON CONFLICT(source_id, identity_kind, identity_value)
        DO UPDATE SET job_id=EXCLUDED.job_id, last_seen_at=EXCLUDED.last_seen_at`,
      [lazyPostingId, lazyJobId, new Date('2026-10-05T10:00:00Z')],
    );

    const jobNomenclatures = JSON.parse(
      await readFile(new URL('../../data/nomenclatures.json', import.meta.url), 'utf8'),
    );
    const cacheQuery = { limit:1, prefetch:0, q:'ATC48903CACHE' };
    const cacheConfigA = await effectiveConfig(user, env, { db:runtimeDb });
    const firstLazy = await listProfileJobs(
      user, cacheConfigA, jobNomenclatures, cacheQuery, env,
      { db:runtimeDb, now:new Date('2026-10-05T12:00:00Z') },
    );
    assert.equal(firstLazy.results, 1);
    assert.equal(firstLazy.evaluations_computed, 1);
    assert.equal(firstLazy.cache_hits, 0);
    assert.equal(firstLazy.bounded, true);

    const secondLazy = await listProfileJobs(
      user, cacheConfigA, jobNomenclatures, cacheQuery, env,
      { db:runtimeDb, now:new Date('2026-10-05T12:01:00Z') },
    );
    assert.equal(secondLazy.results, 1);
    assert.equal(secondLazy.evaluations_computed, 0);
    assert.equal(secondLazy.cache_hits, 1);

    await savePreferences(user, {
      ...cacheConfigA,
      fit_threshold:Number(cacheConfigA.fit_threshold || 80) + 1,
    }, env, { db:runtimeDb });
    const cacheConfigB = await effectiveConfig(user, env, { db:runtimeDb });
    const thirdLazy = await listProfileJobs(
      user, cacheConfigB, jobNomenclatures, cacheQuery, env,
      { db:runtimeDb, now:new Date('2026-10-05T12:02:00Z') },
    );
    assert.equal(thirdLazy.results, 1);
    assert.equal(thirdLazy.evaluations_computed, 1, 'profile_version change invalidates only the bounded cache row');

    const cacheRow = await adminDb.query(
      `SELECT search_profile_id, profile_version, job_version, fit_algorithm_version, eligibility_state
         FROM profile_job_evaluation
        WHERE tenant_id=$1 AND search_profile_id=$2 AND job_id=$3`,
      [user.profile_id, restoredFoundation.search_profile_id, lazyJobId],
    );
    assert.equal(cacheRow.rows.length, 1);
    assert.equal(String(cacheRow.rows[0].search_profile_id), restoredFoundation.search_profile_id);
    assert.equal(Number(cacheRow.rows[0].profile_version),
      (await resolveActiveSearchProfile(user, env, { db:runtimeDb })).profile_version);
    assert.equal(Number(cacheRow.rows[0].job_version), 1);
    assert.equal(cacheRow.rows[0].fit_algorithm_version, 'fit-v1');
    assert.equal(cacheRow.rows[0].eligibility_state, 'ELIGIBLE');

    assert.ok(await nomenclatureReferenceCount('regions', 'EU', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('countries', 'RO', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('work_modes', 'remote', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('contract_types', 'contract', env, { db:runtimeDb }) >= 1);
    const appliedReferenceCount = await nomenclatureReferenceCount('application_statuses', 'applied', env, { db:runtimeDb });
    assert.ok(appliedReferenceCount >= 2);

    const catalog = JSON.parse(
      await readFile(new URL('../../data/nomenclatures.json', import.meta.url), 'utf8'),
    );
    assert.throws(
      () => deleteNomenclatureValue(
        structuredClone(catalog),
        'application_statuses',
        'applied',
        { searchConfig:{}, applications:{ applications:[] }, dbReferenceCount:appliedReferenceCount },
      ),
      error => error?.status === 409 && error?.references?.includes('database.application_statuses'),
      'DB-held reference from another profile must block nomenclature delete without exposing personal content',
    );

    const session = await createSession(user, env, { db:runtimeDb });
    const resolved = await resolveSession(session.rawToken, env, { db:runtimeDb });
    assert.equal(resolved.user_id, user.user_id);

    await setAccountStatus(ownerA, user.user_id, 'DEACTIVATED', env, { db:runtimeDb });
    await assert.rejects(
      resolveSession(session.rawToken, env, { db:runtimeDb }),
      error => error?.status === 401,
    );
    await setAccountStatus(ownerA, user.user_id, 'ACTIVE', env, { db:runtimeDb });

    const ownerApps = (await listApplications(ownerA, env, { db:runtimeDb })).applications;
    for (const application of ownerApps) {
      await deleteApplication(ownerA, application.id, env, { db:runtimeDb });
    }
    assert.equal((await listApplications(ownerA, env, { db:runtimeDb })).applications.length, 0);
    assert.equal((await listApplications(ownerA, env, { db:runtimeDb })).applications.length, 0);

    const originalOwnerUserId = ownerA.user_id;
    const originalOwnerProfileId = ownerA.profile_id;
    await deleteAccount(ownerA, originalOwnerUserId, env, { db:runtimeDb });

    const residue = await adminDb.query(
      `SELECT
         (SELECT count(*)::integer FROM tenants WHERE name=$3) AS tenants,
         (SELECT count(*)::integer FROM app_user WHERE user_id=$1) AS users,
         (SELECT count(*)::integer FROM user_identity WHERE user_id=$1) AS identities,
         (SELECT count(*)::integer FROM profile WHERE profile_id=$2) AS profiles,
         (SELECT count(*)::integer FROM candidate_profile WHERE tenant_id=$2) AS candidate_profiles,
         (SELECT count(*)::integer FROM search_profile WHERE tenant_id=$2) AS search_profiles,
         (SELECT count(*)::integer FROM search_profile_preferences WHERE tenant_id=$2) AS search_profile_preferences,
         (SELECT count(*)::integer FROM profile_preferences WHERE tenant_id=$2) AS preferences,
         (SELECT count(*)::integer FROM applications WHERE tenant_id=$2) AS applications,
         (SELECT count(*)::integer FROM user_session WHERE user_id=$1) AS sessions`,
      [originalOwnerUserId, originalOwnerProfileId, `jscc-${originalOwnerProfileId}`],
    );
    assert.deepEqual(residue.rows[0], {
      tenants:0, users:0, identities:0, profiles:0,
      candidate_profiles:0, search_profiles:0, search_profile_preferences:0,
      preferences:0, applications:0, sessions:0,
    });

    const bootstrapMarker = await adminDb.query(
      `SELECT owner_bootstrapped_at, owner_preferences_imported_at, owner_applications_imported_at,
              to_jsonb(system_bootstrap) ? 'owner_profile_id' AS has_profile_identifier
         FROM system_bootstrap WHERE singleton=true`,
    );
    assert.ok(bootstrapMarker.rows[0].owner_bootstrapped_at);
    assert.ok(bootstrapMarker.rows[0].owner_preferences_imported_at);
    assert.ok(bootstrapMarker.rows[0].owner_applications_imported_at);
    assert.equal(bootstrapMarker.rows[0].has_profile_identifier, false);

    const resigned = await resolveOrProvisionGoogleIdentity(ownerPayload, env, { db:runtimeDb });
    assert.equal(resigned.role, 'USER');
    assert.notEqual(resigned.user_id, originalOwnerUserId);
    assert.notEqual(resigned.profile_id, originalOwnerProfileId);
    assert.equal((await listApplications(resigned, env, { db:runtimeDb })).applications.length, 0);
    const resignedConfig = await effectiveConfig(resigned, env, { db:runtimeDb });
    assert.equal('rate_min_eur_day' in resignedConfig, false);
    assert.equal('excluded_company_patterns' in resignedConfig, false);
  } finally {
    await runtimeDb.end();
    await migrationDb.end();
    await adminDb.end();
    await tenantProbeDb.end();
  }
});
