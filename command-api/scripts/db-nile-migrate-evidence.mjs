import pg from 'pg';
import { migrate } from '../src/db/migrations.js';

const { Pool } = pg;
const connectionString = String(process.env.NILE_TEST_DATABASE_URL || '').trim();
if (!connectionString) throw new Error('NILE_TEST_DATABASE_URL is required');

const db = new Pool({
  connectionString,
  max:2,
  connectionTimeoutMillis:10000,
  idleTimeoutMillis:30000,
});

try {
  const result = await migrate({ db });
  process.stdout.write(`${JSON.stringify({ status:'ok', ...result })}\n`);
} finally {
  await db.end();
}
