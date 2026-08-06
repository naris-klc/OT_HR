/** Date helpers shared by the /api/holidays routes. Unchanged from the Express router. */

/** Accepts YYYY-MM-DD, DD/MM/YYYY and D/M/YYYY, including Buddhist-era years. */
export function normaliseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return null;
  const [, d, mo, y] = m;
  // A year past 2400 is พ.ศ. — Excel exports from a Thai locale do this.
  const year = Number(y) > 2400 ? Number(y) - 543 : Number(y);
  return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * An overnight session started the day BEFORE a new holiday now spills into
 * holiday buckets, so it has to be replayed too.
 */
export function previousDay(date) {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  ) - 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
