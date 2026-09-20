import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completionNotice,
  duplicateRunResolution,
  isActiveRunStatus,
  isTerminalRunStatus,
  pollingDelayMs,
  terminalForBaseline,
} from '../src/run-polling.mjs';

test('recognizes active and terminal run states', () => {
  assert.equal(isActiveRunStatus('queued'), true);
  assert.equal(isActiveRunStatus('in_progress'), true);
  assert.equal(isTerminalRunStatus('completed'), true);
  assert.equal(isTerminalRunStatus('completed_with_errors'), true);
  assert.equal(isTerminalRunStatus('failed'), true);
  assert.equal(isTerminalRunStatus('in_progress'), false);
});

test('does not treat a new active run as terminal', () => {
  const baseline = { runId: 'old', completedAt: '2026-09-08T17:00:00Z' };
  assert.equal(terminalForBaseline({ run_id: 'new', completed_at: null, status: 'queued' }, baseline), false);
  assert.equal(terminalForBaseline({ run_id: 'new', completed_at: null, status: 'in_progress' }, baseline), false);
  assert.equal(terminalForBaseline({ run_id: 'new', completed_at: '2026-09-08T17:08:00Z', status: 'completed_with_errors' }, baseline), true);
});

test('a simulated run longer than five minutes remains non-terminal until backend completion', () => {
  const baseline = { runId: 'old', completedAt: '2026-09-08T17:00:00Z' };
  const samples = Array.from({ length: 65 }, (_, index) => ({
    run_id: 'new',
    completed_at: null,
    status: index === 0 ? 'queued' : 'in_progress',
  }));
  for (const sample of samples) assert.equal(terminalForBaseline(sample, baseline), false);
  assert.equal(terminalForBaseline({ run_id: 'new', completed_at: '2026-09-08T17:08:00Z', status: 'completed' }, baseline), true);
});

test('poll delay backs off without becoming aggressive', () => {
  assert.equal(pollingDelayMs(0), 5000);
  assert.equal(pollingDelayMs(23), 5000);
  assert.equal(pollingDelayMs(24), 10000);
  assert.equal(pollingDelayMs(60), 15000);
});

test('completed_with_errors has a distinct notice', () => {
  const notice = completionNotice({ status: 'completed_with_errors', jobs_published: 117, sources_processed: 117 });
  assert.equal(notice.type, 'info');
  assert.match(notice.message, /erori partiale/);
});

test('genuine 409 tracks only a confirmed active run', () => {
  assert.deepEqual(duplicateRunResolution({ status:'queued' }), { trackExistingRun:true, state:'active' });
  assert.deepEqual(duplicateRunResolution({ status:'in_progress' }), { trackExistingRun:true, state:'active' });
  assert.deepEqual(duplicateRunResolution({ status:'completed' }), { trackExistingRun:false, state:'idle' });
  assert.deepEqual(duplicateRunResolution({ status:'completed_with_errors' }), { trackExistingRun:false, state:'idle' });
  assert.deepEqual(duplicateRunResolution(null), { trackExistingRun:false, state:'idle' });
});
