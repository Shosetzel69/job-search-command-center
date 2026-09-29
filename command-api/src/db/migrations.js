import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction, getPool } from './pool.js';

const DEFAULT_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const FILE_RE = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/;

export function migrationChecksum(sql) { return createHash('sha256').update(sql, 'utf8').digest('hex'); }

export async function loadMigrations(dir = DEFAULT_DIR) {
  const names = (await readdir(dir)).filter(name => FILE_RE.test(name)).sort();
  if (!names.length) throw new Error('No database migrations found');
  const seen = new Set();
  const migrations = [];
  for (const name of names) {
    const [,version] = name.match(FILE_RE);
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version}`);
    seen.add(version);
    const sql = await readFile(resolve(dir, name), 'utf8');
    migrations.push({ version, name, sql, checksum:migrationChecksum(sql) });
  }
  return migrations;
}

async function appliedMigrations(db) {
  const exists = await db.query(`SELECT to_regclass('public.schema_migrations') AS table_name`);
  if (!exists.rows?.[0]?.table_name) return new Map();
  const result = await db.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  return new Map(result.rows.map(row => [String(row.version), String(row.checksum)]));
}

export async function migrate({ env = process.env, db = getPool(env), dir = DEFAULT_DIR } = {}) {
  const migrations = await loadMigrations(dir);
  const applied = await appliedMigrations(db);
  const executed = [];
  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing !== migration.checksum) throw new Error(`Migration checksum mismatch for ${migration.name}`);
      continue;
    }
    await withTransaction(async tx => {
      await tx.query(migration.sql);
      await tx.query(
        'INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
    }, { env, db });
    executed.push(migration.name);
  }
  return { applied:executed, current:migrations.at(-1).version };
}
