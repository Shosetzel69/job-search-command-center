import { backfillSearchProfileFoundations } from '../src/db/search-profile-backfill.js';
import { closePool } from '../src/db/pool.js';

try {
  const result = await backfillSearchProfileFoundations();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closePool();
}
