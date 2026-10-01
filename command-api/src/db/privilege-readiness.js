import { getPool } from './pool.js';

export async function runtimePrivilegeReadiness(env = process.env, { db = getPool(env) } = {}) {
  const roleResult = await db.query(
    `SELECT current_user AS role_name,
            r.rolsuper,
            r.rolbypassrls,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = roleResult.rows?.[0];
  if (!row) throw Object.assign(new Error('Runtime database role could not be inspected'), { status:503 });

  const safe = row.rolsuper === false && row.rolbypassrls === false && row.schema_create === false;
  return Object.freeze({
    status:safe ? 'ok' : 'unsafe',
    role:row.role_name,
    superuser:Boolean(row.rolsuper),
    bypass_rls:Boolean(row.rolbypassrls),
    schema_create:Boolean(row.schema_create),
  });
}
