import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { withTransaction } from '../src/db/pool.js';
import { PERSONAL_TABLES, PERSONAL_TABLE_REGISTRY_VERSION } from '../src/db/personal-table-registry.js';
import { PERSONAL_TABLES as gatewayTables, verifyTenantPersonalResidue } from '../src/db/tenant-gateway.js';
import { TENANT_AWARE_TABLES, runtimePrivilegeReadiness } from '../src/db/privilege-readiness.js';

test('#466 F03: failed rollback discards client before another tenant can acquire it', async () => {
  const original = new Error('operation failed');
  const released = [];
  let acquisitions = 0;
  let oldTenant = null;
  const first = {
    async query(sql) {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      if (sql === 'tenant A') oldTenant = 'A';
      return { rows:[] };
    },
    release(destroy) { released.push(destroy); },
  };
  const second = {
    async query(sql) {
      if (sql === 'tenant B') return { rows:[{ tenant:'B' }] };
      return { rows:[] };
    },
    release(destroy) { released.push(destroy); },
  };
  const db = { async connect() {
    acquisitions++;
    return acquisitions === 1 || released[0] !== true ? first : second;
  } };
  await assert.rejects(withTransaction(async tx => {
    await tx.query('tenant A');
    throw original;
  }, { db }), error => error === original);
  assert.equal(oldTenant, 'A');
  assert.equal(released[0], true);
  const result = await withTransaction(tx => tx.query('tenant B'), { db });
  assert.deepEqual(result.rows, [{ tenant:'B' }]);
  assert.deepEqual(released, [true, undefined]);
});

test('#466 F04: registry matches tenant tables declared by migrations', async () => {
  const dir = new URL('../migrations/', import.meta.url);
  const tables = new Set();
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.sql')) continue;
    const sql = await readFile(new URL(name, dir), 'utf8');
    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)\s*\(([\s\S]*?);/gi)) {
      if (/\btenant_id\s+uuid\b/i.test(match[2])) tables.add(match[1]);
    }
  }
  assert.ok(Number.isInteger(PERSONAL_TABLE_REGISTRY_VERSION));
  assert.equal(gatewayTables, PERSONAL_TABLES);
  assert.equal(TENANT_AWARE_TABLES, PERSONAL_TABLES);
  assert.ok(Object.isFrozen(PERSONAL_TABLES));
  assert.deepEqual([...PERSONAL_TABLES].sort(), [...tables].sort());
});

test('#466 F04: deletion residue rejects snapshot residue and incomplete results', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const zero = Object.fromEntries(['tenants', ...PERSONAL_TABLES].map(table => [table, 0]));
  const run = rows => verifyTenantPersonalResidue(id, { db:{ async query(sql, params) {
    assert.deepEqual(params, [id]);
    for (const table of PERSONAL_TABLES) assert.ok(sql.includes('FROM ' + table + ' WHERE tenant_id=$1'));
    return { rows };
  } } });
  assert.equal((await run([zero])).status, 'ok');
  await assert.rejects(run([{ ...zero, profile_job_count_snapshots:1 }]), /personal residue/);
  await assert.rejects(run([]), /personal residue/);
  const incomplete = { ...zero };
  delete incomplete.profile_job_count_snapshots;
  await assert.rejects(run([incomplete]), /personal residue/);
});

test('#466 F04: missing snapshot table fails readiness even in shared-role exception', async () => {
  const db = { async query(sql, params) {
    if (!params) return { rows:[{ role_name:'runtime', rolsuper:false, rolcreaterole:false, schema_create:true, database_create:true }] };
    assert.deepEqual(params[0], PERSONAL_TABLES);
    return { rows:PERSONAL_TABLES.filter(table => table !== 'profile_job_count_snapshots').map(table_name => ({
      table_name, tenant_id_ready:true, owned_by_runtime:true, member_of_owner:true
    })) };
  } };
  const result = await runtimePrivilegeReadiness({ APP_ENV:'dev', JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE:'true' }, { db });
  assert.equal(result.status, 'unsafe');
  assert.equal(result.tenant_tables.find(row => row.table === 'profile_job_count_snapshots').present, false);
});
