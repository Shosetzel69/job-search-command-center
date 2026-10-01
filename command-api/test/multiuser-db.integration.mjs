import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

import {
  createApplication,
  createSession,
  deleteAccount,
  deleteApplication,
  effectiveConfig,
  listApplications,
  nomenclatureReferenceCount,
  resolveOrProvisionGoogleIdentity,
  resolveSession,
  savePreferences,
  setAccountStatus,
  updateApplication,
} from '../src/multiuser-repository.js';
import { runtimePrivilegeReadiness } from '../src/db/privilege-readiness.js';

const { Pool } = pg;

const runtimeUrl = process.env.JSCC_INTEGRATION_DATABASE_URL;
const migrationUrl = process.env.NILE_MIGRATION_DATABASE_URL;
const adminUrl = process.env.JSCC_TEST_ADMIN_DATABASE_URL;
const enabled = Boolean(runtimeUrl && migrationUrl && adminUrl);

test('real PostgreSQL multiuser isolation, lifecycle and privilege contract', { skip:!enabled }, async () => {
  const runtimeDb = new Pool({ connectionString:runtimeUrl, max:6 });
  const migrationDb = new Pool({ connectionString:migrationUrl, max:2 });
  const adminDb = new Pool({ connectionString:adminUrl, max:1 });
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
    assert.equal(privilege.bypass_rls, false);
    assert.equal(privilege.schema_create, false);
    assert.equal(privilege.database_create, false);
    assert.equal(privilege.protected_tables.every(item =>
      item.present && item.rls_enabled && item.rls_forced && !item.owned_by_runtime && !item.member_of_owner
    ), true);

    await assert.rejects(
      runtimeDb.query('CREATE TABLE runtime_must_not_create(id integer)'),
      /permission denied/i,
    );
    await assert.rejects(
      runtimeDb.query('ALTER TABLE profile DISABLE ROW LEVEL SECURITY'),
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

    const userConfig = await effectiveConfig(user, env, { db:runtimeDb });
    assert.equal('rate_min_eur_day' in userConfig, false);
    assert.equal('excluded_company_patterns' in userConfig, false);
    assert.equal('target_regions' in userConfig, false);

    const storedUserPrefs = await adminDb.query(
      'SELECT preferences FROM profile_preferences WHERE profile_id=$1',
      [user.profile_id],
    );
    assert.deepEqual(storedUserPrefs.rows[0].preferences, {});

    const noContext = await runtimeDb.query('SELECT count(*)::integer AS count FROM profile_preferences');
    assert.equal(noContext.rows[0].count, 0);

    const ownerApplication = await createApplication(ownerA, {
      company:'Tenant A',
      title:'Project Manager',
      status:'applied',
    }, env, { db:runtimeDb });

    await assert.rejects(
      updateApplication(user, ownerApplication.id, { status:'interview' }, env, { db:runtimeDb }),
      error => error?.status === 404,
    );

    await savePreferences(user, {
      target_regions:['EU'],
      remote_eligible_country_codes:['RO'],
      work_modes:{ remote:true },
      contract_types:['contract'],
    }, env, { db:runtimeDb });
    await createApplication(user, {
      company:'Tenant B',
      title:'Delivery Manager',
      status:'applied',
    }, env, { db:runtimeDb });

    assert.ok(await nomenclatureReferenceCount('regions', 'EU', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('countries', 'RO', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('work_modes', 'remote', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('contract_types', 'contract', env, { db:runtimeDb }) >= 1);
    assert.ok(await nomenclatureReferenceCount('application_statuses', 'applied', env, { db:runtimeDb }) >= 2);

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
         (SELECT count(*)::integer FROM app_user WHERE user_id=$1) AS users,
         (SELECT count(*)::integer FROM user_identity WHERE user_id=$1) AS identities,
         (SELECT count(*)::integer FROM profile WHERE profile_id=$2) AS profiles,
         (SELECT count(*)::integer FROM profile_preferences WHERE profile_id=$2) AS preferences,
         (SELECT count(*)::integer FROM applications WHERE profile_id=$2) AS applications,
         (SELECT count(*)::integer FROM user_session WHERE user_id=$1) AS sessions`,
      [originalOwnerUserId, originalOwnerProfileId],
    );
    assert.deepEqual(residue.rows[0], {
      users:0, identities:0, profiles:0, preferences:0, applications:0, sessions:0,
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
  }
});
