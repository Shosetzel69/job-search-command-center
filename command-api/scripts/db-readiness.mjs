import { databaseReadiness } from '../src/db/readiness.js';
import { closePool } from '../src/db/pool.js';

try {
  const result = await databaseReadiness();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closePool();
}
