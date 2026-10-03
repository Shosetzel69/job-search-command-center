import { randomUUID } from 'node:crypto';
import { migrationDatabaseConfig } from '../src/db/config.js';
import { closeMigrationPool, getMigrationPool, withTransaction } from '../src/db/pool.js';
import {
  deleteTenantDomain,
  verifyTenantPersonalResidue,
} from '../src/db/tenant-gateway.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sortedTenantIds(rows) {
  return (rows || []).map(row => String(row.tenant_id)).sort();
}

export async function collectNileDevEvidence(
  env = process.env,
  { db = getMigrationPool(env) } = {},
) {
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'dev') {
    throw new Error('Managed Nile evidence is DEV-only');
  }

  const config = migrationDatabaseConfig(env);
  const database = await db.query('SELECT current_database() AS name');
  const databaseName = String(database.rows?.[0]?.name || '');
  if (databaseName !== config.expectedDatabase || databaseName !== 'jobsearch_dev') {
    throw new Error(`Managed Nile evidence requires jobsearch_dev, got ${databaseName || 'unknown'}`);
  }

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const tenantAName = `jscc-evidence-${tenantA}`;
  const tenantBName = `jscc-evidence-${tenantB}`;
  const userA = randomUUID();
  const identityA = randomUUID();
  const subjectA = `adr008-dev-evidence-${randomUUID()}`;
  let seeded = false;

  try {
    // Nile tenant guardrail: tenant-control DML is isolated and first in its transaction.
    await withTransaction(async tx => {
      await tx.query(
        'INSERT INTO tenants(id, name) VALUES ($1, $2)',
        [tenantA, tenantAName],
      );
    }, { env, db });
    await withTransaction(async tx => {
      await tx.query(`SET LOCAL nile.tenant_id = '${tenantA}'`);
      await tx.query(
        `INSERT INTO profile_preferences(tenant_id, preferences)
         VALUES ($1, '{"probe":"A"}'::jsonb)`,
        [tenantA],
      );
    }, { env, db });

    await withTransaction(async tx => {
      await tx.query(
        'INSERT INTO tenants(id, name) VALUES ($1, $2)',
        [tenantB, tenantBName],
      );
    }, { env, db });
    await withTransaction(async tx => {
      await tx.query(`SET LOCAL nile.tenant_id = '${tenantB}'`);
      await tx.query(
        `INSERT INTO profile_preferences(tenant_id, preferences)
         VALUES ($1, '{"probe":"B"}'::jsonb)`,
        [tenantB],
      );
    }, { env, db });
    seeded = true;

    const globalRows = await db.query(
      'SELECT tenant_id FROM profile_preferences WHERE tenant_id = ANY($1::uuid[]) ORDER BY tenant_id',
      [[tenantA, tenantB]],
    );
    assert(
      sortedTenantIds(globalRows.rows).join(',') === [tenantA, tenantB].sort().join(','),
      'Nile global mode did not expose both disposable evidence tenants as expected',
    );

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantA}'`);
      const contextA = await client.query(
        "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
      );
      assert(String(contextA.rows?.[0]?.tenant_id || '') === tenantA, 'Tenant A context mismatch');

      const rowsA = await client.query(
        'SELECT tenant_id FROM profile_preferences WHERE tenant_id = ANY($1::uuid[]) ORDER BY tenant_id',
        [[tenantA, tenantB]],
      );
      assert(
        sortedTenantIds(rowsA.rows).join(',') === tenantA,
        'Tenant A context exposed another tenant',
      );

      const sharedA = await client.query(
        'SELECT count(*)::integer AS count FROM collection_policy WHERE singleton=true',
      );
      assert(Number(sharedA.rows?.[0]?.count) === 1, 'Shared collection policy unavailable in tenant context');
      await client.query('COMMIT');

      const afterCommit = await client.query(
        "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
      );
      assert(!String(afterCommit.rows?.[0]?.tenant_id || '').trim(), 'Tenant context leaked after commit');

      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantA}'`);
      let crossTenantRejected = false;
      try {
        await client.query(
          `INSERT INTO profile_ui_preferences(tenant_id, preferences)
           VALUES ($1, '{"probe":"cross-tenant"}'::jsonb)`,
          [tenantB],
        );
      } catch {
        crossTenantRejected = true;
      }
      await client.query('ROLLBACK').catch(() => {});
      assert(crossTenantRejected, 'Tenant A context accepted a write for tenant B');

      const afterRollback = await client.query(
        "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
      );
      assert(!String(afterRollback.rows?.[0]?.tenant_id || '').trim(), 'Tenant context leaked after rollback');

      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantB}'`);
      const rowsB = await client.query(
        'SELECT tenant_id FROM profile_preferences WHERE tenant_id = ANY($1::uuid[]) ORDER BY tenant_id',
        [[tenantA, tenantB]],
      );
      assert(
        sortedTenantIds(rowsB.rows).join(',') === tenantB,
        'Tenant B context exposed another tenant',
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Verify the approved staged account lifecycle on tenant A using only
    // disposable synthetic account metadata.
    await withTransaction(async tx => {
      await tx.query(
        "INSERT INTO app_user(user_id, role, status) VALUES ($1, 'USER', 'ACTIVE')",
        [userA],
      );
      await tx.query(
        `INSERT INTO user_identity(
           identity_id, user_id, provider, provider_subject, email, email_verified
         ) VALUES ($1, $2, 'GOOGLE', $3, NULL, false)`,
        [identityA, userA, subjectA],
      );
      await tx.query(
        'INSERT INTO profile(profile_id, user_id, provisioned_at) VALUES ($1, $2, now())',
        [tenantA, userA],
      );
    }, { env, db });

    await withTransaction(async tx => {
      await tx.query(
        `UPDATE app_user
            SET deletion_started_at=now(), deletion_initiated_by='ADMIN',
                status='DEACTIVATED', updated_at=now()
          WHERE user_id=$1`,
        [userA],
      );
    }, { env, db });

    await deleteTenantDomain(tenantA, { env, db });
    await verifyTenantPersonalResidue(tenantA, { env, db });
    await withTransaction(async tx => {
      await tx.query('DELETE FROM app_user WHERE user_id=$1', [userA]);
    }, { env, db });
    const deletedA = await db.query(
      `SELECT
         (SELECT count(*)::integer FROM tenants WHERE name=$3) AS tenants,
         (SELECT count(*)::integer FROM profile_preferences WHERE tenant_id=$1) AS preferences,
         (SELECT count(*)::integer FROM profile WHERE profile_id=$1) AS profiles,
         (SELECT count(*)::integer FROM app_user WHERE user_id=$2) AS users,
         (SELECT count(*)::integer FROM user_identity WHERE user_id=$2) AS identities`,
      [tenantA, userA, tenantAName],
    );
    assert(
      Object.values(deletedA.rows?.[0] || {}).every(value => Number(value) === 0),
      'Tenant A lifecycle cleanup left residue',
    );

    await deleteTenantDomain(tenantB, { env, db });
    const deletedB = await db.query(
      `SELECT
         (SELECT count(*)::integer FROM tenants WHERE name=$2) AS tenants,
         (SELECT count(*)::integer FROM profile_preferences WHERE tenant_id=$1) AS preferences`,
      [tenantB, tenantBName],
    );
    assert(
      Object.values(deletedB.rows?.[0] || {}).every(value => Number(value) === 0),
      'Tenant B cleanup left residue',
    );
    seeded = false;

    return {
      status:'PASS',
      database:databaseName,
      global_mode_two_tenants:true,
      tenant_a_isolated:true,
      tenant_b_isolated:true,
      cross_tenant_write_rejected:true,
      commit_context_cleared:true,
      rollback_context_cleared:true,
      shared_visible_in_tenant_context:true,
      lifecycle_zero_residue:true,
    };
  } finally {
    if (seeded) {
      // Best-effort cleanup uses only disposable generated IDs. Each tenant
      // delete is its own transaction and its first statement, per Nile.
      await deleteTenantDomain(tenantA, { env, db }).catch(() => {});
      await deleteTenantDomain(tenantB, { env, db }).catch(() => {});
      await db.query('DELETE FROM app_user WHERE user_id=$1', [userA]).catch(() => {});
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(await collectNileDevEvidence())}\n`);
  } finally {
    await closeMigrationPool();
  }
}
