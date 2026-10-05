import { getPool } from './pool.js';
import { ensureSearchProfileFoundation } from '../multiuser-repository.js';

export async function backfillSearchProfileFoundations(
  env = process.env,
  { db = getPool(env) } = {},
) {
  const accounts = await db.query(
    `SELECT a.user_id, a.role, a.status, p.profile_id
       FROM app_user a
       JOIN profile p ON p.user_id = a.user_id
      WHERE p.provisioned_at IS NOT NULL
        AND a.deletion_started_at IS NULL
      ORDER BY a.created_at, a.user_id`,
  );

  let processed = 0;
  const foundations = [];
  for (const row of accounts.rows || []) {
    const authContext = Object.freeze({
      user_id:String(row.user_id),
      profile_id:String(row.profile_id),
      role:String(row.role),
      status:String(row.status),
    });
    const foundation = await ensureSearchProfileFoundation(authContext, env, { db });
    foundations.push({
      tenant_id:authContext.profile_id,
      search_profile_id:foundation.search_profile_id,
      candidate_profile_id:foundation.candidate_profile_id,
    });
    processed += 1;
  }

  return Object.freeze({ status:'ok', processed, foundations });
}
