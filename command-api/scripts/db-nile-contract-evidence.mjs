import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.NILE_TEST_DATABASE_URL;
if (!connectionString) throw new Error('NILE_TEST_DATABASE_URL is required');

function compactError(error) {
  return { code:error?.code || null, message:String(error?.message || error) };
}

async function safeRollback(client) {
  await client.query('ROLLBACK').catch(() => {});
}

async function createTenant(client, tenantId, name) {
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO tenants(id, name) VALUES ($1, $2)', [tenantId, name]);
    await client.query('COMMIT');
  } catch (error) {
    await safeRollback(client);
    throw error;
  }
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  const results = {
    status:'EVIDENCE_COLLECTED',
    advisory_lock_plus_shared_write_tx:null,
    shared_profile_fk_to_tenants:null,
    tenant_control_plus_shared_write_tx:null,
    tenant_init_separate_tx:null,
    shared_read_plus_tenant_write:null,
    mixed_shared_plus_tenant_write_rejected:null,
    hard_delete_tenant_plus_shared_tx:null,
    tenant_delete_cascade:null,
    tenant_delete_retry_idempotent:null,
    search_profile_logical_reference_write:null,
    search_profile_preferences_write:null,
    search_profile_cross_tenant_isolation:null,
    search_profile_preferences_cross_tenant_isolation:null,
    search_profile_delete_cascade:null,
    details:{},
  };

  const tenantMeta = randomUUID();
  const userMeta = randomUUID();

  try {
    await client.query(`
      CREATE TABLE __jscc_user_probe (
        user_id uuid PRIMARY KEY,
        status text NOT NULL
      )
    `);

    // P0. Exact first shared provisioning shape: advisory xact lock followed by
    // a write to a shared table, with no tenant context.
    try {
      const advisoryUser = randomUUID();
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('jscc-account-provision'))`);
      await client.query(
        'INSERT INTO __jscc_user_probe(user_id, status) VALUES ($1, $2)',
        [advisoryUser, 'ACTIVE'],
      );
      await client.query('COMMIT');
      results.advisory_lock_plus_shared_write_tx = true;
    } catch (error) {
      await safeRollback(client);
      results.advisory_lock_plus_shared_write_tx = false;
      results.details.advisory_lock_plus_shared_write_tx = compactError(error);
    }

    // A. Can a shared profile physically reference built-in tenants?
    try {
      await client.query(`
        CREATE TABLE __jscc_profile_fk_probe (
          profile_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          user_id uuid NOT NULL UNIQUE REFERENCES __jscc_user_probe(user_id) ON DELETE CASCADE
        )
      `);
      results.shared_profile_fk_to_tenants = true;
    } catch (error) {
      results.shared_profile_fk_to_tenants = false;
      results.details.shared_profile_fk_to_tenants = compactError(error);
    }

    // B. Can built-in tenant creation and shared account metadata be written in one tx?
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO tenants(id, name) VALUES ($1, $2)',
        [tenantMeta, `jscc-meta-${tenantMeta}`],
      );
      await client.query(
        'INSERT INTO __jscc_user_probe(user_id, status) VALUES ($1, $2)',
        [userMeta, 'ACTIVE'],
      );
      await client.query('COMMIT');
      results.tenant_control_plus_shared_write_tx = true;
    } catch (error) {
      await safeRollback(client);
      results.tenant_control_plus_shared_write_tx = false;
      results.details.tenant_control_plus_shared_write_tx = compactError(error);
    }

    // Independent schema for tenant behavior probes.
    await client.query(`
      CREATE TABLE __jscc_pref_probe (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await client.query(`
      CREATE TABLE __jscc_job_probe (
        job_id uuid PRIMARY KEY,
        title text NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE __jscc_state_probe (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        job_id uuid NOT NULL,
        state jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (tenant_id, job_id)
      )
    `);

    const tenantData = randomUUID();
    const jobId = randomUUID();
    await createTenant(client, tenantData, `jscc-data-${tenantData}`);
    await client.query(
      'INSERT INTO __jscc_job_probe(job_id, title) VALUES ($1, $2)',
      [jobId, 'provider-evidence'],
    );

    // C. Personal initialization in its own tenant transaction.
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantData}'`);
      await client.query(
        `INSERT INTO __jscc_pref_probe(tenant_id, payload)
         VALUES ($1, '{"ready":true}'::jsonb)`,
        [tenantData],
      );
      await client.query('COMMIT');
      results.tenant_init_separate_tx = true;
    } catch (error) {
      await safeRollback(client);
      results.tenant_init_separate_tx = false;
      results.details.tenant_init_separate_tx = compactError(error);
    }

    // D. ADR-008 §4.1: shared READ + tenant-aware WRITE.
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantData}'`);
      const shared = await client.query(
        'SELECT job_id FROM __jscc_job_probe WHERE job_id=$1',
        [jobId],
      );
      if (!shared.rows?.length) throw new Error('shared job not visible in tenant context');
      await client.query(
        `INSERT INTO __jscc_state_probe(tenant_id, job_id, state)
         VALUES ($1, $2, '{"seen":true}'::jsonb)`,
        [tenantData, jobId],
      );
      await client.query('COMMIT');
      results.shared_read_plus_tenant_write = true;
    } catch (error) {
      await safeRollback(client);
      results.shared_read_plus_tenant_write = false;
      results.details.shared_read_plus_tenant_write = compactError(error);
    }

    // E. Documented unsupported pattern: tenant-aware WRITE + shared WRITE.
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantData}'`);
      await client.query(
        `UPDATE __jscc_state_probe
            SET state='{"seen":false}'::jsonb
          WHERE tenant_id=$1 AND job_id=$2`,
        [tenantData, jobId],
      );
      await client.query(
        'UPDATE __jscc_job_probe SET title=$1 WHERE job_id=$2',
        ['mixed-write', jobId],
      );
      await client.query('COMMIT');
      results.mixed_shared_plus_tenant_write_rejected = false;
      results.details.mixed_shared_plus_tenant_write_rejected = {
        message:'container accepted an officially unsupported pattern; JSCC must still prohibit it',
      };
    } catch (error) {
      await safeRollback(client);
      results.mixed_shared_plus_tenant_write_rejected = true;
      results.details.mixed_shared_plus_tenant_write_rejected = compactError(error);
    }

    // E2. #489 foundation: tenant-local logical Candidate/Search Profile relationship and isolation.
    // No physical FK is used because Nile tenant deletion tears down tenant-aware
    // partitions independently and a cross-table FK blocks that lifecycle.
    const tenantProfileA = randomUUID();
    const tenantProfileB = randomUUID();
    const candidateProfileA = randomUUID();
    const searchProfileA = randomUUID();
    await createTenant(client, tenantProfileA, `jscc-profile-a-${tenantProfileA}`);
    await createTenant(client, tenantProfileB, `jscc-profile-b-${tenantProfileB}`);

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantProfileA}'`);
      await client.query(
        `INSERT INTO candidate_profile(tenant_id, candidate_profile_id)
         VALUES ($1, $2)`,
        [tenantProfileA, candidateProfileA],
      );
      await client.query(
        `INSERT INTO search_profile(
            tenant_id, search_profile_id, candidate_profile_id,
            name, status, profile_version, onboarding_state
          )
          VALUES ($1, $2, $3, 'Default', 'ACTIVE', 1, 'NOT_CONFIGURED')`,
        [tenantProfileA, searchProfileA, candidateProfileA],
      );
      await client.query(
        `INSERT INTO search_profile_preferences(
            tenant_id, search_profile_id, preferences
          )
          VALUES ($1, $2, '{"target_country_codes":["RO"]}'::jsonb)`,
        [tenantProfileA, searchProfileA],
      );
      await client.query('COMMIT');
      results.search_profile_logical_reference_write = true;
      results.search_profile_preferences_write = true;
    } catch (error) {
      await safeRollback(client);
      results.search_profile_logical_reference_write = false;
      results.search_profile_preferences_write = false;
      results.details.search_profile_logical_reference_write = compactError(error);
      results.details.search_profile_preferences_write = compactError(error);
    }

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL nile.tenant_id = '${tenantProfileB}'`);
      const invisible = await client.query(
        'SELECT search_profile_id FROM search_profile WHERE search_profile_id=$1',
        [searchProfileA],
      );
      const invisiblePreferences = await client.query(
        'SELECT search_profile_id FROM search_profile_preferences WHERE search_profile_id=$1',
        [searchProfileA],
      );
      await client.query('COMMIT');
      results.search_profile_cross_tenant_isolation = invisible.rows.length === 0;
      results.search_profile_preferences_cross_tenant_isolation = invisiblePreferences.rows.length === 0;
    } catch (error) {
      await safeRollback(client);
      results.search_profile_cross_tenant_isolation = false;
      results.search_profile_preferences_cross_tenant_isolation = false;
      results.details.search_profile_cross_tenant_isolation = compactError(error);
      results.details.search_profile_preferences_cross_tenant_isolation = compactError(error);
    }

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tenants WHERE id=$1 RETURNING id', [tenantProfileA]);
      await client.query('COMMIT');
      const residue = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM candidate_profile WHERE tenant_id=$1) AS candidate_profiles,
           (SELECT count(*)::integer FROM search_profile WHERE tenant_id=$1) AS search_profiles`,
        [tenantProfileA],
      );
      results.search_profile_delete_cascade =
        Number(residue.rows?.[0]?.candidate_profiles) === 0
        && Number(residue.rows?.[0]?.search_profiles) === 0
        && Number(residue.rows?.[0]?.search_profile_preferences) === 0;
    } catch (error) {
      await safeRollback(client);
      results.search_profile_delete_cascade = false;
      results.details.search_profile_delete_cascade = compactError(error);
    }

    // F/G. Is the current one-transaction hard-delete shape possible?
    // Use a shared profile without the already-proven-invalid FK to tenants, so
    // this test isolates DELETE tenants + DELETE shared account in one tx.
    await client.query(`
      CREATE TABLE __jscc_profile_probe (
        profile_id uuid PRIMARY KEY,
        user_id uuid NOT NULL UNIQUE REFERENCES __jscc_user_probe(user_id) ON DELETE CASCADE
      )
    `);

    const tenantDelete = randomUUID();
    const userDelete = randomUUID();
    await createTenant(client, tenantDelete, `jscc-delete-${tenantDelete}`);
    await client.query(
      'INSERT INTO __jscc_user_probe(user_id, status) VALUES ($1, $2)',
      [userDelete, 'ACTIVE'],
    );
    await client.query(
      'INSERT INTO __jscc_profile_probe(profile_id, user_id) VALUES ($1, $2)',
      [tenantDelete, userDelete],
    );
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL nile.tenant_id = '${tenantDelete}'`);
      await client.query(
        `INSERT INTO __jscc_pref_probe(tenant_id, payload)
         VALUES ($1, '{"delete":true}'::jsonb)
         ON CONFLICT (tenant_id) DO UPDATE SET payload=EXCLUDED.payload`,
        [tenantDelete],
      );
      await client.query('COMMIT');
    } catch (error) {
      await safeRollback(client);
      throw error;
    }

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tenants WHERE id=$1 RETURNING id', [tenantDelete]);
      await client.query(
        'DELETE FROM __jscc_user_probe WHERE user_id=$1 RETURNING user_id',
        [userDelete],
      );
      await client.query('COMMIT');
      results.hard_delete_tenant_plus_shared_tx = true;
    } catch (error) {
      await safeRollback(client);
      results.hard_delete_tenant_plus_shared_tx = false;
      results.details.hard_delete_tenant_plus_shared_tx = compactError(error);
    }

    // Independently prove documented tenant cascade semantics.
    const tenantCascade = randomUUID();
    await createTenant(client, tenantCascade, `jscc-cascade-${tenantCascade}`);
    await client.query('BEGIN');
    await client.query(`SET LOCAL nile.tenant_id = '${tenantCascade}'`);
    await client.query(
      `INSERT INTO __jscc_pref_probe(tenant_id, payload)
       VALUES ($1, '{"cascade":true}'::jsonb)`,
      [tenantCascade],
    );
    await client.query('COMMIT');

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tenants WHERE id=$1 RETURNING id', [tenantCascade]);
      await client.query('COMMIT');
      const residue = await client.query(
        'SELECT count(*)::integer AS count FROM __jscc_pref_probe WHERE tenant_id=$1',
        [tenantCascade],
      );
      results.tenant_delete_cascade = Number(residue.rows?.[0]?.count) === 0;
    } catch (error) {
      await safeRollback(client);
      results.tenant_delete_cascade = false;
      results.details.tenant_delete_cascade = compactError(error);
    }

    // H. Retry semantics: deleting an already-absent tenant must be classifiable
    // as an already-completed step rather than a destructive failure.
    try {
      await client.query('BEGIN');
      const retry = await client.query(
        'DELETE FROM tenants WHERE id=$1 RETURNING id',
        [tenantCascade],
      );
      await client.query('COMMIT');
      results.tenant_delete_retry_idempotent = retry.rows.length === 0;
    } catch (error) {
      await safeRollback(client);
      results.tenant_delete_retry_idempotent = false;
      results.details.tenant_delete_retry_idempotent = compactError(error);
    }

    const required489 = [
      'search_profile_logical_reference_write',
      'search_profile_preferences_write',
      'search_profile_cross_tenant_isolation',
      'search_profile_preferences_cross_tenant_isolation',
      'search_profile_delete_cascade',
    ];
    const failed489 = required489.filter(key => results[key] !== true);
    process.stdout.write(`${JSON.stringify(results)}\n`);
    if (failed489.length) {
      throw new Error(`#489 Nile Search Profile contract failed: ${failed489.join(', ')}`);
    }
  } finally {
    await client.end();
  }
}

await main();
