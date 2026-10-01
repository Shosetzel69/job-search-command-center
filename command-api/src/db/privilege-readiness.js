import { getPool } from './pool.js';

export const PROTECTED_RLS_TABLES = Object.freeze([
  'profile','profile_preferences','profile_job_state','profile_job_evaluation',
  'applications','profile_notes','profile_ui_preferences',
]);

export async function runtimePrivilegeReadiness(env = process.env, { db = getPool(env) } = {}) {
  const roleResult = await db.query(
    `SELECT current_user AS role_name,
            r.rolsuper,
            r.rolbypassrls,
            r.rolcreaterole,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
            has_database_privilege(current_user, current_database(), 'CREATE') AS database_create
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = roleResult.rows?.[0];
  if (!row) throw Object.assign(new Error('Runtime database role could not be inspected'), { status:503 });

  const tableResult = await db.query(
    `SELECT c.relname AS table_name,
            c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced,
            pg_get_userbyid(c.relowner) AS owner_role,
            c.relowner = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned_by_runtime,
            pg_has_role((SELECT oid FROM pg_roles WHERE rolname=current_user), c.relowner, 'MEMBER') AS member_of_owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
        AND c.relkind='r'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [PROTECTED_RLS_TABLES],
  );

  const byName = new Map((tableResult.rows || []).map(item => [String(item.table_name), item]));
  const protectedTables = PROTECTED_RLS_TABLES.map(tableName => {
    const item = byName.get(tableName);
    return {
      table:tableName,
      present:Boolean(item),
      rls_enabled:Boolean(item?.rls_enabled),
      rls_forced:Boolean(item?.rls_forced),
      owned_by_runtime:Boolean(item?.owned_by_runtime),
      member_of_owner:Boolean(item?.member_of_owner),
      owner_role:item?.owner_role || null,
    };
  });

  const tablesSafe = protectedTables.every(item =>
    item.present && item.rls_enabled && item.rls_forced && !item.owned_by_runtime && !item.member_of_owner
  );
  const safe = row.rolsuper === false
    && row.rolbypassrls === false
    && row.rolcreaterole === false
    && row.schema_create === false
    && row.database_create === false
    && tablesSafe;

  return Object.freeze({
    status:safe ? 'ok' : 'unsafe',
    role:row.role_name,
    superuser:Boolean(row.rolsuper),
    bypass_rls:Boolean(row.rolbypassrls),
    create_role:Boolean(row.rolcreaterole),
    schema_create:Boolean(row.schema_create),
    database_create:Boolean(row.database_create),
    protected_tables:protectedTables,
  });
}
