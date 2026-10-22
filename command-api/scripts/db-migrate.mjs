// DEV-01B guardrails-only image: do not initialize any imported DB modules.
// This entrypoint is disabled until a separately approved migration release.
process.stderr.write('JSCC541_DEV01B_MIGRATION_ENTRYPOINT_DISABLED\n');
process.exit(86);

const { migrate } = await import('../src/db/migrations.js');
const { backfillSearchProfileFoundations } = await import('../src/db/search-profile-backfill.js');
const { closeMigrationPool, getMigrationPool } = await import('../src/db/pool.js');
const { backfillCanonicalJobClassification, backfillSearchProfilePreferences } = await import('../src/db/atc-489-02-backfill.js');

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
