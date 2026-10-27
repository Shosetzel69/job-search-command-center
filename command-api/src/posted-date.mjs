// #535 F-1a: posting date parsing; no locale-dependent Date.parse.
const RX = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,6}))?)?(Z|([+-])([0-9]{2}):([0-9]{2})))?$/;

export function parsePostedDate(value, anchor = new Date()) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()) || value.getTime() > new Date(anchor).getTime()) return null;
    return value.toISOString();
  }
  if (typeof value !== 'string') return null;
  const m = RX.exec(value);
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, fraction, zone, sign, zh, zm] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds);
  if (y < 1 || mo < 1 || mo > 12) return null;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d < 1 || d > days[mo - 1]) return null;
  const h = Number(hs || 0), mi = Number(mis || 0), sec = Number(ss || 0);
  if (h > 23 || mi > 59 || sec > 59 || (zone && (Number(zh || 0) > 23 || Number(zm || 0) > 59))) return null;
  // setUTCFullYear avoids the Date.UTC 00–99 -> 1900–1999 remapping.
  const base = new Date(0);
  base.setUTCFullYear(y, mo - 1, d);
  base.setUTCHours(h, mi, sec, Number((fraction || '').padEnd(3, '0').slice(0, 3)) || 0);
  const offset = zone && zone !== 'Z' ? (sign === '+' ? 1 : -1) * (Number(zh) * 60 + Number(zm)) * 60000 : 0;
  const ms = base.getTime() - offset;
  const anchorMs = new Date(anchor).getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(anchorMs) || ms > anchorMs) return null;
  const result = new Date(ms);
  return result.getUTCFullYear() < 1 ? null : result.toISOString();
}

export function canonicalPostedDate(row, anchor = new Date()) {
  // SQL computes the same selected date; the API must not independently invent a fallback.
  const fromSql = row.effective_posted_at;
  if (Object.prototype.hasOwnProperty.call(row, 'effective_posted_at')) {
    return parsePostedDate(fromSql, anchor);
  }
  const posting = row.posting_payload || {}, job = row.payload || {};
  for (const value of [row.posted_at, posting.date_posted, posting.posted_at, job.date_posted, job.posted_at]) {
    const result = parsePostedDate(value, anchor);
    if (result) return result;
  }
  return null;
}

export function postedAgeHours(date, anchor = new Date()) {
  if (!date) return null;
  const ms = new Date(date).getTime();
  const now = new Date(anchor).getTime();
  return Number.isFinite(ms) && ms <= now ? Math.floor((now - ms) / 3600000) : null;
}
