export const SCHEDULER_SCHEMA_VERSION = '1.0';
export const SCHEDULER_TIMEZONE = 'Europe/Bucharest';
export const ALLOWED_INTERVAL_HOURS = Object.freeze([8, 12, 24]);
export const RUN_ORIGINS = Object.freeze(['manual-ui', 'scheduled', 'system']);
export const SCHEDULER_OUTCOMES = Object.freeze(['dispatched', 'skipped_active', 'dispatch_failed']);

export const DEFAULT_AUTOMATION_CONFIG = Object.freeze({
  schema_version: SCHEDULER_SCHEMA_VERSION,
  enabled: false,
  interval_hours: 8,
  anchor_time: '08:00',
  timezone: SCHEDULER_TIMEZONE,
});

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireNullableString(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be null or a non-empty string`);
  return value;
}

function requireIsoTimestamp(value, label) {
  const text = requireNullableString(value, label);
  if (text == null) return null;
  if (Number.isNaN(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp`);
  return text;
}

export function parseAnchorTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    throw new TypeError('anchor_time must use HH:MM');
  }
  const [hour, minute] = value.split(':').map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new TypeError('anchor_time must be a valid local time');
  }
  return { hour, minute, minuteOfDay: hour * 60 + minute };
}

export function assertAutomationConfig(input) {
  const value = requireObject(input, 'automation config');
  if (value.schema_version !== SCHEDULER_SCHEMA_VERSION) throw new TypeError('Unsupported automation config schema');
  if (typeof value.enabled !== 'boolean') throw new TypeError('enabled must be boolean');
  if (!ALLOWED_INTERVAL_HOURS.includes(value.interval_hours)) throw new TypeError('interval_hours must be 8, 12 or 24');
  parseAnchorTime(value.anchor_time);
  if (value.timezone !== SCHEDULER_TIMEZONE) throw new TypeError(`timezone must be ${SCHEDULER_TIMEZONE}`);
  return {
    schema_version: SCHEDULER_SCHEMA_VERSION,
    enabled: value.enabled,
    interval_hours: value.interval_hours,
    anchor_time: value.anchor_time,
    timezone: value.timezone,
  };
}

export function defaultSchedulerState() {
  return {
    schema_version: SCHEDULER_SCHEMA_VERSION,
    last_processed_slot: null,
    last_outcome: null,
    last_dispatched_at: null,
    last_skipped_at: null,
    last_skip_reason: null,
  };
}

export function assertSchedulerState(input) {
  const value = requireObject(input, 'scheduler state');
  if (value.schema_version !== SCHEDULER_SCHEMA_VERSION) throw new TypeError('Unsupported scheduler state schema');
  const slot = requireNullableString(value.last_processed_slot, 'last_processed_slot');
  if (slot != null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slot)) throw new TypeError('last_processed_slot must use YYYY-MM-DDTHH:MM');
  const outcome = requireNullableString(value.last_outcome, 'last_outcome');
  if (outcome != null && !SCHEDULER_OUTCOMES.includes(outcome)) throw new TypeError(`Unsupported scheduler outcome: ${outcome}`);
  return {
    schema_version: SCHEDULER_SCHEMA_VERSION,
    last_processed_slot: slot,
    last_outcome: outcome,
    last_dispatched_at: requireIsoTimestamp(value.last_dispatched_at, 'last_dispatched_at'),
    last_skipped_at: requireIsoTimestamp(value.last_skipped_at, 'last_skipped_at'),
    last_skip_reason: requireNullableString(value.last_skip_reason, 'last_skip_reason'),
  };
}

export function defaultRunAdmission() {
  return { schema_version: SCHEDULER_SCHEMA_VERSION, claim: null };
}

export function assertRunAdmission(input) {
  const value = requireObject(input, 'run admission');
  if (value.schema_version !== SCHEDULER_SCHEMA_VERSION) throw new TypeError('Unsupported run admission schema');
  if (value.claim == null) return defaultRunAdmission();
  const claim = requireObject(value.claim, 'run admission claim');
  const id = requireNullableString(claim.id, 'claim.id');
  if (!id) throw new TypeError('claim.id is required');
  if (!RUN_ORIGINS.includes(claim.origin)) throw new TypeError('claim.origin is invalid');
  const claimedAt = requireIsoTimestamp(claim.claimed_at, 'claim.claimed_at');
  const expiresAt = requireIsoTimestamp(claim.expires_at, 'claim.expires_at');
  if (!claimedAt || !expiresAt) throw new TypeError('claim timestamps are required');
  if (Date.parse(expiresAt) <= Date.parse(claimedAt)) throw new TypeError('claim.expires_at must be after claim.claimed_at');
  return {
    schema_version: SCHEDULER_SCHEMA_VERSION,
    claim: { id, origin: claim.origin, claimed_at: claimedAt, expires_at: expiresAt },
  };
}

function localParts(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('now must be a valid Date');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function dateId({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function timeId(minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function addLocalDays(localDate, days) {
  const [year, month, day] = localDate.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function slotsForLocalDate(configInput, localDate) {
  const config = assertAutomationConfig(configInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new TypeError('localDate must use YYYY-MM-DD');
  const { minuteOfDay: anchor } = parseAnchorTime(config.anchor_time);
  const step = config.interval_hours * 60;
  const count = 24 / config.interval_hours;
  const minutes = [];
  for (let index = 0; index < count; index += 1) minutes.push((anchor + index * step) % 1440);
  return [...new Set(minutes)]
    .sort((a, b) => a - b)
    .map(minute => `${localDate}T${timeId(minute)}`);
}

export function localNowId(now, timeZone = SCHEDULER_TIMEZONE) {
  const parts = localParts(now, timeZone);
  return `${dateId(parts)}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function latestEligibleSlot(configInput, now = new Date()) {
  const config = assertAutomationConfig(configInput);
  if (!config.enabled) return null;
  const currentId = localNowId(now, config.timezone);
  const currentDate = currentId.slice(0, 10);
  const candidates = [
    ...slotsForLocalDate(config, addLocalDays(currentDate, -1)),
    ...slotsForLocalDate(config, currentDate),
  ].filter(slot => slot <= currentId).sort();
  return candidates.at(-1) || null;
}

export function nextEstimatedSlots(configInput, now = new Date(), count = 3, lastProcessedSlot = null) {
  const config = assertAutomationConfig(configInput);
  if (!config.enabled) return [];
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new TypeError('count must be an integer from 1 to 10');
  if (lastProcessedSlot != null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(lastProcessedSlot)) {
    throw new TypeError('lastProcessedSlot must use YYYY-MM-DDTHH:MM');
  }
  const currentId = localNowId(now, config.timezone);
  const currentDate = currentId.slice(0, 10);
  const floor = lastProcessedSlot && lastProcessedSlot > currentId ? lastProcessedSlot : currentId;
  const candidates = [];
  for (let day = 0; day < 8 && candidates.length < count; day += 1) {
    for (const slot of slotsForLocalDate(config, addLocalDays(currentDate, day))) {
      if (slot > floor) candidates.push(slot);
      if (candidates.length >= count) break;
    }
  }
  return candidates;
}

export function schedulerDecision(configInput, stateInput, now = new Date()) {
  const config = assertAutomationConfig(configInput);
  const state = assertSchedulerState(stateInput);
  if (!config.enabled) return { action: 'off', slot: null };
  const slot = latestEligibleSlot(config, now);
  if (!slot) return { action: 'not_due', slot: null };
  if (state.last_processed_slot && state.last_processed_slot >= slot) return { action: 'not_due', slot };
  return { action: 'due', slot };
}
