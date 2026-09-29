import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseConfig, expectedDatabase } from '../src/db/config.js';
import { databaseReadiness } from '../src/db/readiness.js';
import { withTransaction } from '../src/db/pool.js';
import { loadMigrations, migrate, migrationChecksum } from '../src/db/migrations.js';

test('database binding is environment-static and fail-closed', () => {
  assert.equal(expectedDatabase('dev'), 'jobsearch_dev');
  assert.equal(expectedDatabase('test'), 'jobsearch_test');
  assert.equal(expectedDatabase('prod'), 'jobsearch_prod');
  assert.throws(() => expectedDatabase('stage'), /APP_ENV must be dev, test or prod/);
  const env = { APP_ENV:'dev', NILE_DATABASE_URL:'postgresql://user:secret@db.example/jobsearch_dev?sslmode=require' };
  const config = databaseConfig(env);
  assert.equal(config.expectedDatabase, 'jobsearch_dev');
  assert.equal(config.poolMax, 2);
  assert.throws(() => databaseConfig({ ...env, NILE_DATABASE_URL:'postgresql://user:secret@db.example/jobsearch_prod' }), /Database binding mismatch/);
  assert.throws(() => databaseConfig({ APP_ENV:'dev' }), /NILE_DATABASE_URL is required/);
});

test('database readiness returns non-secret identity only', async () => {
  const env = { APP_ENV:'dev', NILE_DATABASE_URL:'postgresql://user:secret@db.example/jobsearch_dev' };
  const db = { query:async () => ({ rows:[{ database_name:'jobsearch_dev', server_version:'15.19' }] }) };
  const result = await databaseReadiness(env, { db });
  assert.deepEqual(result, { status:'ok', environment:'dev', database:'jobsearch_dev', server_version:'15.19' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('database readiness rejects a cross-environment connection result', async () => {
  const env = { APP_ENV:'dev', NILE_DATABASE_URL:'postgresql://user:secret@db.example/jobsearch_dev' };
  const db = { query:async () => ({ rows:[{ database_name:'jobsearch_prod', server_version:'15.19' }] }) };
  await assert.rejects(databaseReadiness(env, { db }), /does not match environment binding/);
});

test('transaction helper commits success and rolls back failure', async () => {
  const calls = [];
  const client = {
    query:async (sql, params=[]) => { calls.push([sql, params]); return { rows:[] }; },
    release:() => calls.push(['RELEASE', []]),
  };
  const db = { connect:async () => client };
  await withTransaction(async tx => { await tx.query('SELECT $1', [1]); }, { db, env:{} });
  assert.deepEqual(calls.map(x => x[0]), ['BEGIN','SELECT $1','COMMIT','RELEASE']);

  calls.length = 0;
  await assert.rejects(withTransaction(async () => { throw new Error('boom'); }, { db, env:{} }), /boom/);
  assert.deepEqual(calls.map(x => x[0]), ['BEGIN','ROLLBACK','RELEASE']);
});

test('migration loader is ordered and checksum-stable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jscc-db-migrations-'));
  await writeFile(join(dir, '002_second.sql'), 'SELECT 2;\n');
  await writeFile(join(dir, '001_first.sql'), 'SELECT 1;\n');
  const migrations = await loadMigrations(dir);
  assert.deepEqual(migrations.map(x => x.version), ['001','002']);
  assert.equal(migrations[0].checksum, migrationChecksum('SELECT 1;\n'));
});

test('migration runner applies once and then is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jscc-db-migrate-'));
  const sql = 'CREATE TABLE schema_migrations(version text primary key, name text, checksum text);\n';
  await writeFile(join(dir, '001_schema_migrations.sql'), sql);
  const applied = new Map();
  let tableExists = false;
  const queries = [];
  const client = {
    query:async (text, params=[]) => {
      queries.push([text, params]);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows:[] };
      if (text.includes('CREATE TABLE schema_migrations')) { tableExists = true; return { rows:[] }; }
      if (text.startsWith('INSERT INTO schema_migrations')) { applied.set(params[0], params[2]); return { rows:[] }; }
      return { rows:[] };
    },
    release:() => {},
  };
  const db = {
    connect:async () => client,
    query:async text => {
      if (text.includes("to_regclass('public.schema_migrations')")) return { rows:[{ table_name:tableExists ? 'schema_migrations' : null }] };
      if (text.startsWith('SELECT version, checksum')) return { rows:[...applied].map(([version,checksum]) => ({version,checksum})) };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const first = await migrate({ env:{}, db, dir });
  assert.deepEqual(first.applied, ['001_schema_migrations.sql']);
  const second = await migrate({ env:{}, db, dir });
  assert.deepEqual(second.applied, []);
  assert.equal(applied.size, 1);
});

test('migration runner rejects checksum drift', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jscc-db-drift-'));
  const sql = 'SELECT 1;\n';
  await writeFile(join(dir, '001_foundation.sql'), sql);
  const db = {
    query:async text => {
      if (text.includes("to_regclass('public.schema_migrations')")) return { rows:[{ table_name:'schema_migrations' }] };
      if (text.startsWith('SELECT version, checksum')) return { rows:[{ version:'001', checksum:'different' }] };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  await assert.rejects(migrate({ env:{}, db, dir }), /checksum mismatch/);
});

test('public Command API code does not receive raw DB credentials or direct SQL', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const path of ['../src/index.js','../src/nomenclature-api.js','../src/runtime-gcp.js']) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /NILE_DATABASE_URL/);
    assert.doesNotMatch(text, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  }
});
