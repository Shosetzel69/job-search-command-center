import { getPool, withTransaction } from './pool.js';

export const PERSONAL_TABLES = Object.freeze([
  'candidate_profile',
  'search_profile',
  'profile_preferences',
  'profile_job_state',
  'profile_job_evaluation',
  'applications',
  'profile_notes',
  'profile_ui_preferences',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function requireUuid(value, label) {
  const normalized = String(value || '').trim();
  if (!UUID_RE.test(normalized)) throw httpError(`${label} is invalid`, 400);
  return normalized;
}

function requireTenantAuthContext(authContext) {
  if (!authContext?.user_id || !authContext?.profile_id) {
    throw httpError('Authenticated tenant context is required', 401);
  }
  return Object.freeze({
    user_id:requireUuid(authContext.user_id, 'user_id'),
    profile_id:requireUuid(authContext.profile_id, 'profile_id'),
    role:String(authContext.role || ''),
    status:String(authContext.status || ''),
  });
}

export async function establishTenantContext(tx, profileId) {
  const tenantId = requireUuid(profileId, 'profile_id');
  await tx.query(`SET LOCAL nile.tenant_id = '${tenantId}'`);
  const result = await tx.query(
    "SELECT current_setting('nile.tenant_id', true) AS tenant_id",
  );
  const established = String(result.rows?.[0]?.tenant_id || '').trim();
  if (established !== tenantId) {
    throw httpError('Nile tenant context could not be established', 503);
  }
  return tenantId;
}

export async function withTenantTransaction(
  authContext,
  fn,
  { env = process.env, db = getPool(env) } = {},
) {
  if (typeof fn !== 'function') throw new TypeError('tenant transaction callback is required');
  const context = requireTenantAuthContext(authContext);

  return withTransaction(async tx => {
    const tenantId = await establishTenantContext(tx, context.profile_id);
    const tenantTx = Object.freeze({
      tenantId,
      authContext:context,
      query:(text, params=[]) => tx.query(text, params),
    });
    return fn(tenantTx);
  }, { env, db });
}

// Managed Nile requires tenants-table DML to be the first SQL statement after BEGIN.
export async function createTenantFirst(tx, profileId) {
  const tenantId = requireUuid(profileId, 'profile_id');
  const tenantName = `jscc-${tenantId}`;
  await tx.query(
    'INSERT INTO tenants(id, name) VALUES ($1, $2)',
    [tenantId, tenantName],
  );
  return Object.freeze({ tenant_id:tenantId, tenant_name:tenantName });
}

export async function ensureTenant(
  profileId,
  { env = process.env, db = getPool(env) } = {},
) {
  const tenantId = requireUuid(profileId, 'profile_id');
  try {
    return await withTransaction(
      tx => createTenantFirst(tx, tenantId),
      { env, db },
    );
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const existing = await db.query(
      'SELECT id, name FROM tenants WHERE id=$1',
      [tenantId],
    );
    const row = existing.rows?.[0];
    if (!row) throw httpError('Nile tenant creation collided without a tenant row', 503);
    return Object.freeze({ tenant_id:String(row.id), tenant_name:String(row.name), existing:true });
  }
}

export async function verifyTenantMapping(
  profileId,
  { env = process.env, db = getPool(env) } = {},
) {
  const tenantId = requireUuid(profileId, 'profile_id');
  const result = await db.query(
    'SELECT id, name FROM tenants WHERE id=$1',
    [tenantId],
  );
  const row = result.rows?.[0];
  if (!row || String(row.id) !== tenantId) {
    throw httpError('Account tenant mapping is unavailable', 503);
  }
  return Object.freeze({ tenant_id:tenantId, tenant_name:String(row.name || '') });
}

export async function deleteTenantFirst(tx, profileId) {
  const tenantId = requireUuid(profileId, 'profile_id');
  const result = await tx.query(
    'DELETE FROM tenants WHERE id=$1 RETURNING id',
    [tenantId],
  );
  return Object.freeze({
    tenant_id:tenantId,
    deleted:Boolean(result.rows?.length),
  });
}

export async function deleteTenantDomain(
  profileId,
  { env = process.env, db = getPool(env) } = {},
) {
  const tenantId = requireUuid(profileId, 'profile_id');
  return withTransaction(
    tx => deleteTenantFirst(tx, tenantId),
    { env, db },
  );
}

// Narrow lifecycle aggregate verification only. No personal payload or identifiers
// are returned to callers beyond the already-known target profile id.
export async function verifyTenantPersonalResidue(
  profileId,
  { env = process.env, db = getPool(env) } = {},
) {
  const tenantId = requireUuid(profileId, 'profile_id');
  const result = await db.query(
    `SELECT
       (SELECT count(*)::integer FROM tenants WHERE id=$1) AS tenants,
       (SELECT count(*)::integer FROM candidate_profile WHERE tenant_id=$1) AS candidate_profiles,
       (SELECT count(*)::integer FROM search_profile WHERE tenant_id=$1) AS search_profiles,
       (SELECT count(*)::integer FROM profile_preferences WHERE tenant_id=$1) AS preferences,
       (SELECT count(*)::integer FROM profile_job_state WHERE tenant_id=$1) AS job_state,
       (SELECT count(*)::integer FROM profile_job_evaluation WHERE tenant_id=$1) AS evaluations,
       (SELECT count(*)::integer FROM applications WHERE tenant_id=$1) AS applications,
       (SELECT count(*)::integer FROM profile_notes WHERE tenant_id=$1) AS notes,
       (SELECT count(*)::integer FROM profile_ui_preferences WHERE tenant_id=$1) AS ui_preferences`,
    [tenantId],
  );
  const counts = result.rows?.[0] || {};
  if (Object.values(counts).some(value => Number(value) !== 0)) {
    throw httpError('Tenant deletion left personal residue', 503);
  }
  return Object.freeze({ status:'ok', profile_id:tenantId });
}

export async function resolveAccountDeletionTarget(
  db,
  userId,
) {
  const accountId = requireUuid(userId, 'user_id');
  const result = await db.query(
    `SELECT a.user_id, a.status, a.deletion_started_at, a.deletion_initiated_by,
            p.profile_id, p.provisioned_at
       FROM app_user a
       LEFT JOIN profile p ON p.user_id = a.user_id
      WHERE a.user_id=$1`,
    [accountId],
  );
  const row = result.rows?.[0];
  if (!row) return Object.freeze({ result:'NOT_FOUND', user_id:accountId, profile_id:null });
  if (!row.profile_id) {
    throw httpError('Account profile mapping is unavailable; delete aborted', 503);
  }
  return Object.freeze({
    result:'FOUND',
    user_id:accountId,
    profile_id:requireUuid(row.profile_id, 'profile_id'),
    status:String(row.status || ''),
    provisioned_at:row.provisioned_at || null,
    deletion_started_at:row.deletion_started_at || null,
    deletion_initiated_by:row.deletion_initiated_by || null,
  });
}
