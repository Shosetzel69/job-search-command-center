import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostedDate, canonicalPostedDate, postedAgeHours } from '../src/posted-date.mjs';

const ANCHOR = new Date('2026-10-13T10:00:00.000Z');

test('G-1 strict ISO calendar and timezone grammar', () => {
  const accepted = [
    ['2026-10-13', '2026-10-13T00:00:00.000Z'],
    ['2026-10-13T09:00Z', '2026-10-13T09:00:00.000Z'],
    ['2026-10-13T11:00:00+01:00', '2026-10-13T10:00:00.000Z'],
    ['2026-10-13T09:00:00.123456Z', '2026-10-13T09:00:00.123Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
  ];
  for (const [value, expected] of accepted) assert.equal(parsePostedDate(value, ANCHOR), expected, value);
  const rejected = [
    '2026-02-30','2025-02-29','2026-13-01','2026-00-01','2026-10-13T24:00Z',
    '2026-10-13T00:60Z','2026-10-13T00:00:60Z','2026-10-13T00:00',
    '2026-10-13 08:00:00Z','Oct 13 2026','2026-10-13T09:00:00+24:00',
    '2026-10-13T09:00:00.1234567Z',' 2026-10-13','٢٠٢٦-10-13',
    '2026-10-13T10:00:00.001Z', 1791885600, {}, [], null,
  ];
  for (const value of rejected) assert.equal(parsePostedDate(value, ANCHOR), null, String(value));
});

test('G-2 first valid of all five candidates and bad primary fallback', () => {
  const row = {
    posted_at:null,
    posting_payload:{date_posted:'invalid', posted_at:'2026-10-11'},
    payload:{date_posted:'2026-10-10', posted_at:'2026-10-09'},
  };
  assert.equal(canonicalPostedDate(row, ANCHOR), '2026-10-11T00:00:00.000Z');
  row.posting_payload.posted_at = 'future 2026-10-14';
  assert.equal(canonicalPostedDate(row, ANCHOR), '2026-10-10T00:00:00.000Z');
  row.posted_at = new Date('2026-10-12T00:00:00.000Z');
  assert.equal(canonicalPostedDate(row, ANCHOR), '2026-10-12T00:00:00.000Z');
});

test('RV-5 unknown age stays null and is not new24h', () => {
  assert.equal(canonicalPostedDate({ effective_posted_at:null, payload:{date_posted:'2026-10-12'} }, ANCHOR), null);
  assert.equal(postedAgeHours(null, ANCHOR), null);
  assert.equal(postedAgeHours('2026-10-12T11:00:00Z', ANCHOR), 23);
  assert.equal(postedAgeHours('2026-10-12T09:00:00Z', ANCHOR), 25);
});

test('G-3 truncate microseconds and zero tolerance after normalization', () => {
  assert.equal(parsePostedDate('2026-10-13T10:00:00.0004Z', ANCHOR), ANCHOR.toISOString());
  assert.equal(parsePostedDate('2026-10-13T10:00:00.001Z', ANCHOR), null);
  assert.equal(parsePostedDate('2026-10-13T09:59:59.9996Z', ANCHOR), '2026-10-13T09:59:59.999Z');
});

test('C2 low-year 0001/0099 calendar is not remapped to 1900s', () => {
  const far = new Date('2026-10-13T10:00:00Z');
  assert.equal(parsePostedDate('0099-01-01', far), '0099-01-01T00:00:00.000Z');
  assert.equal(parsePostedDate('0100-01-01', far), '0100-01-01T00:00:00.000Z');
  assert.equal(parsePostedDate('0001-01-01T00:00:00+01:00', far), null);
});
