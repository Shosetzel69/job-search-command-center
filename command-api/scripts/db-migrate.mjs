import { migrate } from '../src/db/migrations.js';
import { backfillSearchProfileFoundations } from '../src/db/search-profile-backfill.js';
import { closeMigrationPool, getMigrationPool } from '../src/db/pool.js';

const db = getMigrationPool();

try {
  const migration = await migrate({ db });
  const backfill = await backfillSearchProfileFoundations(process.env, { db });
  process.stdout.write(`${JSON.stringify({
    ...migration,
    search_profile_backfill:backfill,
  })}\n`);
} finally {
  await closeMigrationPool();
}
