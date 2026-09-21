import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AUTOMATION_CONFIG,
  assertAutomationConfig,
  assertRunAdmission,
  defaultRunAdmission,
  defaultSchedulerState,
  latestEligibleSlot,
  nextEstimatedSlots,
  schedulerDecision,
  slotsForLocalDate,
} from '../../shared/scheduler.mjs';

const enabled = (patch = {}) => ({ ...DEFAULT_AUTOMATION_CONFIG, enabled:true, ...patch });

test('default automation is OFF with approved defaults', () => {
  assert.deepEqual(DEFAULT_AUTOMATION_CONFIG, {
    schema_version:'1.0',
    enabled:false,
    interval_hours:8,
    anchor_time:'08:00',
    timezone:'Europe/Bucharest',
  });
  assert.deepEqual(
    schedulerDecision(DEFAULT_AUTOMATION_CONFIG, defaultSchedulerState(), new Date('2026-09-21T10:00:00Z')),
    { action:'off', slot:null },
  );
});

test('only 8h 12h 24h and valid HH:MM are accepted', () => {
  assert.doesNotThrow(() => assertAutomationConfig(enabled({ interval_hours:8, anchor_time:'08:37' })));
  for (const interval_hours of [1,2,4,6,10]) {
    assert.throws(() => assertAutomationConfig(enabled({ interval_hours })), /8, 12 or 24/);
  }
  for (const anchor_time of ['8:37','24:00','08:60','xx:yy']) {
    assert.throws(() => assertAutomationConfig(enabled({ anchor_time })), /anchor_time/);
  }
});

test('8h arbitrary anchor remains wall-clock anchored', () => {
  assert.deepEqual(
    slotsForLocalDate(enabled({ interval_hours:8, anchor_time:'08:37' }), '2026-09-21'),
    ['2026-09-21T00:37','2026-09-21T08:37','2026-09-21T16:37'],
  );
});

test('12h and 24h slots are deterministic', () => {
  assert.deepEqual(
    slotsForLocalDate(enabled({ interval_hours:12, anchor_time:'07:30' }), '2026-09-21'),
    ['2026-09-21T07:30','2026-09-21T19:30'],
  );
  assert.deepEqual(
    slotsForLocalDate(enabled({ interval_hours:24, anchor_time:'08:37' }), '2026-09-21'),
    ['2026-09-21T08:37'],
  );
});

test('next estimated slots return next three local wall-clock slots', () => {
  const config = enabled({ interval_hours:8, anchor_time:'08:00' });
  assert.deepEqual(
    nextEstimatedSlots(config, new Date('2026-09-21T07:30:00Z'), 3),
    ['2026-09-21T16:00','2026-09-22T00:00','2026-09-22T08:00'],
  );
});

test('missed slots collapse to latest eligible slot only', () => {
  const config = enabled({ interval_hours:8, anchor_time:'08:00' });
  const state = { ...defaultSchedulerState(), last_processed_slot:'2026-09-20T08:00' };
  assert.deepEqual(
    schedulerDecision(config, state, new Date('2026-09-21T15:10:00Z')),
    { action:'due', slot:'2026-09-21T16:00' },
  );
});

test('spring-forward nonexistent local slot becomes eligible after clock jump', () => {
  const config = enabled({ interval_hours:24, anchor_time:'03:30' });
  assert.equal(
    latestEligibleSlot(config, new Date('2026-03-29T01:00:00Z')),
    '2026-03-29T03:30',
  );
});

test('repeated fall-back wall slot is processed at most once by local slot identity', () => {
  const config = enabled({ interval_hours:24, anchor_time:'03:30' });
  const first = new Date('2026-10-25T00:35:00Z');
  const second = new Date('2026-10-25T01:35:00Z');
  assert.deepEqual(
    schedulerDecision(config, defaultSchedulerState(), first),
    { action:'due', slot:'2026-10-25T03:30' },
  );
  const processed = {
    ...defaultSchedulerState(),
    last_processed_slot:'2026-10-25T03:30',
    last_outcome:'dispatched',
    last_dispatched_at:first.toISOString(),
  };
  assert.deepEqual(
    schedulerDecision(config, processed, second),
    { action:'not_due', slot:'2026-10-25T03:30' },
  );
});

test('run admission contract validates origin and expiry ordering', () => {
  assert.deepEqual(assertRunAdmission(defaultRunAdmission()), defaultRunAdmission());
  assert.doesNotThrow(() => assertRunAdmission({
    schema_version:'1.0',
    claim:{
      id:'c1',
      origin:'scheduled',
      claimed_at:'2026-09-21T10:00:00Z',
      expires_at:'2026-09-21T10:05:00Z',
    },
  }));
  assert.throws(() => assertRunAdmission({
    schema_version:'1.0',
    claim:{
      id:'c1',
      origin:'wrong',
      claimed_at:'2026-09-21T10:00:00Z',
      expires_at:'2026-09-21T10:05:00Z',
    },
  }), /origin/);
  assert.throws(() => assertRunAdmission({
    schema_version:'1.0',
    claim:{
      id:'c1',
      origin:'scheduled',
      claimed_at:'2026-09-21T10:05:00Z',
      expires_at:'2026-09-21T10:00:00Z',
    },
  }), /after/);
});
