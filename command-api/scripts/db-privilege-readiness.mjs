import { runtimePrivilegeReadiness } from '../src/db/privilege-readiness.js';
import { closePool } from '../src/db/pool.js';

try {
  const result = await runtimePrivilegeReadiness();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'ok') process.exitCode = 2;
} finally {
  await closePool();
}
