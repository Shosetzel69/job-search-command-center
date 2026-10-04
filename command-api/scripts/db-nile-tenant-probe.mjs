import { randomUUID } from 'node:crypto';
import { getMigrationPool, closeMigrationPool } from '../src/db/pool.js';

export async function probeNileTenantContext(env = process.env, { db = getMigrationPool(env) } = {}) {
  const client = await db.connect();
  const tenantId = randomUUID();
  const tenantName = `jscc-probe-${tenantId}`;

  try {
    await client.query('BEGIN');

    // Managed Nile requires tenant-table DML to be the first statement in the
    // transaction. This disposable tenant is rolled back below.
    await client.query(
      'INSERT INTO tenants(id, name) VALUES ($1, $2)',
      [tenantId, tenantName],
    );

    // Creating/updating schema after tenant context is established is rejected
    // by managed Nile, so this pre-migration probe intentionally performs no DDL.
    await client.query(`SET LOCAL nile.tenant_id = '${tenantId}'`);

    const context = await client.query(
      "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
    );
    if (String(context.rows?.[0]?.tenant_id || '') !== tenantId) {
      throw new Error('SET LOCAL nile.tenant_id did not establish the requested context');
    }

    await client.query('ROLLBACK');

    const after = await client.query(
      "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
    );
    const afterValue = String(after.rows?.[0]?.tenant_id || '').trim();
    if (afterValue) {
      throw new Error('Tenant context leaked after rollback');
    }

    const tenantResidue = await client.query(
      'SELECT count(*)::integer AS count FROM tenants WHERE name=$1',
      [tenantName],
    );
    if (Number(tenantResidue.rows?.[0]?.count) !== 0) {
      throw new Error('Rollback-only tenant probe left tenant residue');
    }

    return {
      status:'ok',
      tenant_dml_first:true,
      transaction_local:true,
      tenant_context_cleared:true,
      tenant_residue:0,
      shared_visibility:'deferred_to_post_migration_evidence',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(await probeNileTenantContext())}\n`);
  } finally {
    await closeMigrationPool();
  }
}
