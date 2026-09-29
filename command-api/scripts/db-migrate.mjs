import { migrate } from '../src/db/migrations.js';
import { closePool } from '../src/db/pool.js';

try {
  const result = await migrate();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closePool();
}
