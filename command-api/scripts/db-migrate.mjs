import { migrate } from '../src/db/migrations.js';
import { backfillSearchProfileFoundations } from '../src/db/search-profile-backfill.js';
import { closeMigrationPool, getMigrationPool } from '../src/db/pool.js';
import { backfillCanonicalJobClassification, backfillSearchProfilePreferences } from '../src/db/atc-489-02-backfill.js';

const db = getMigrationPool();

try {
  const migration = await migrate({ db });
  const backfill = await backfillSearchProfileFoundations(process.env, { db });
  const preferenceBackfill = await backfillSearchProfilePreferences(process.env, { db });
  const classificationBackfill = await backfillCanonicalJobClassification(process.env, { db });
  process.stdout.write(`${JSON.stringify({
    ...migration,
    search_profile_backfill:backfill,
    search_profile_preferences_backfill:preferenceBackfill,
    shared_classification_backfill:classificationBackfill,
  })}\n`);
} finally {
  await closeMigrationPool();
}
