import { devTestSharedDbRoleAllowed } from './config.js';
import { getPool } from './pool.js';

export const TENANT_AWARE_TABLES = Object.freeze([
  'profile_preferences',
  'profile_job_state',
  'profile_job_evaluation',
  'applications',
  'profile_notes',
  'profile_ui_preferences',
]);

// Compatibility alias for older callers/tests; RLS is no longer the enforcement model.
export const PROTECTED_RLS_TABLES = TENANT_AWARE_TABLES;

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
            pg_get_userbyid(c.relowner) AS owner_role,
            c.relowner = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned_by_runtime,
            pg_has_role((SELECT oid FROM pg_roles WHERE rolname=current_user), c.relowner, 'MEMBER') AS member_of_owner,
            EXISTS (
              SELECT 1
                FROM information_schema.columns col
               WHERE col.table_schema='public'
                 AND col.table_name=c.relname
                 AND col.column_name='tenant_id'
                 AND col.data_type='uuid'
                 AND col.is_nullable='NO'
            ) AS tenant_id_ready
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
        AND c.relkind='r'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [TENANT_AWARE_TABLES],
  );

  const byName = new Map((tableResult.rows || []).map(item => [String(item.table_name), item]));
  const tenantTables = TENANT_AWARE_TABLES.map(tableName => {
    const item = byName.get(tableName);
    return {
      table:tableName,
      present:Boolean(item),
      tenant_id_ready:Boolean(item?.tenant_id_ready),
      owned_by_runtime:Boolean(item?.owned_by_runtime),
      member_of_owner:Boolean(item?.member_of_owner),
      owner_role:item?.owner_role || null,
    };
  });

  const tenantSchemaSafe = tenantTables.every(item => item.present && item.tenant_id_ready);
  const baseRoleSafe = row.rolsuper === false
    && row.rolcreaterole === false;
  const strictTablesSafe = tenantTables.every(item =>
    item.present && item.tenant_id_ready && !item.owned_by_runtime && !item.member_of_owner
  );
  const sharedRoleException = devTestSharedDbRoleAllowed(env);

  const strictSafe = baseRoleSafe
    && row.schema_create === false
    && row.database_create === false
    && strictTablesSafe;
  const exceptionSafe = sharedRoleException && baseRoleSafe && tenantSchemaSafe;
  const safe = strictSafe || exceptionSafe;

  return Object.freeze({
    status:safe ? 'ok' : 'unsafe',
    mode:strictSafe ? 'strict' : (exceptionSafe ? 'dev_test_shared_role_exception' : 'unsafe'),
    strict_privilege_separation:strictSafe,
    residual_global_mode_cross_tenant:true,
    role:row.role_name,
    superuser:Boolean(row.rolsuper),
    bypass_rls:Boolean(row.rolbypassrls),
    create_role:Boolean(row.rolcreaterole),
    schema_create:Boolean(row.schema_create),
    database_create:Boolean(row.database_create),
    tenant_tables:tenantTables,
    protected_tables:tenantTables,
  });
}
