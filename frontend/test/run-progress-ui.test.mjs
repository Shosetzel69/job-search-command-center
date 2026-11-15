import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('ADMIN UI renders real run progress from the canonical model', () => {
  assert.match(main, /RunProgressPanel/);
  assert.match(main, /Progres actualizare surse/);
  assert.match(main, /GOOD \{progress\.good\}/);
  assert.match(main, /FAIL \{progress\.failed\}/);
  assert.match(main, /\{progress\.processed\} din \{progress\.total\} surse planificate procesate/);
});

test('ADMIN refresh polls even before the active run pointer becomes visible', () => {
  const start = main.indexOf("else if(auth.role==='ADMIN'&&['STARTED_RUN','JOINED_EXISTING_RUN'].includes(result.outcome))");
  const end = main.indexOf("    }catch(error)", start);
  const block = main.slice(start, end);
  assert.match(block, /const target=result\.run_id/);
  assert.match(block, /setRunStatus\(initialTrackedRun\(target\)\)/);
  assert.match(block, /statusForTrackedRun\(currentStatus,target\)/);
  assert.match(block, /await pollRun\(previousRunId,previousCompletedAt,target\|\|null\)/);
  assert.doesNotMatch(block, /if\(isActiveRunStatus\(currentStatus\?\.status\)\)await pollRun/);
});
