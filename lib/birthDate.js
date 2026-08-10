/**
 * Reading the วันเกิด column of a roster CSV.
 *
 * HR types 1998-03-05. Excel shows it as 05/03/1998, and saving the file writes
 * that back — so what arrives here is a column Excel has already rewritten, in
 * whatever order the machine's locale prefers rather than the order anyone
 * chose. 05/03/1998 is 5 March on a Thai machine and 3 May on an American one.
 * Both are real dates, both import cleanly, and nothing downstream will ever
 * notice the wrong one: a birthday is only ever compared against itself.
 *
 * So the unit of interpretation here is the FILE, not the row. Excel rewrites
 * the whole column at once, which means one row that can only be read one way —
 * 15/05/1998, no month is 15 — settles the order for every ambiguous row beside
 * it. A file with no such row settles nothing, and this module refuses it whole
 * rather than import half a roster under a coin flip.
 *
 * Pure: no I/O, no dates from the clock. The import route and the preview on
 * the พนักงาน screen both read a file through here, so what HR is shown before
 * confirming is produced by the same code that decides what is stored.
 */

import { pick } from '../src/lib/csv.js';

/** ค.ศ., not พ.ศ. — the year in the file is the year shown back. */
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** The header spellings a roster file may use for the column. */
export const BIRTH_DATE_HEADERS = ['birthDate', 'วันเกิด', 'birth_date'];

export const ORDER_LABEL = {
  iso: 'YYYY-MM-DD (ปี-เดือน-วัน)',
  dmy: 'DD/MM/YYYY (วัน/เดือน/ปี)',
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/**
 * Past this, the year is พ.ศ. — 2541 rather than 1998. Rejected rather than
 * converted: a file mixing eras is a file somebody has edited by hand, and
 * silently subtracting 543 from it would file half a roster 543 years early.
 */
const BUDDHIST_ERA_FLOOR = 2500;

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** "5 มีนาคม 1998" — the sentence HR reads to check an interpretation. */
export function readableDate(iso) {
  const m = ISO.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1])}`;
}

const notReal = (raw) => `วันเกิด "${raw}" ไม่มีอยู่จริงในปฏิทิน`;

function eraError(raw, year) {
  if (year <= BUDDHIST_ERA_FLOOR) return null;
  return `วันเกิด "${raw}" ใช้ปี พ.ศ. — ต้องใช้ปี ค.ศ. (พ.ศ. ${year} = ค.ศ. ${year - 543})`;
}

/**
 * One cell, read as far as it can be read without knowing the file's order.
 *
 * `evidence` is what the cell proves about the file: 'dmy' when the first
 * number cannot be a month, 'mdy' when the second cannot be. Only a cell that
 * resolves to a real date carries evidence — 31/04/1998 is wrong under every
 * reading, and a wrong cell must not get to decide how the right ones are read.
 */
function readCell(raw) {
  const s = String(raw ?? '').trim();

  const iso = ISO.exec(s);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const era = eraError(s, year);
    if (era) return { error: era };
    if (!isRealDate(year, month, day)) return { error: notReal(s) };
    return { date: s };
  }

  const slash = SLASH.exec(s);
  if (!slash) {
    return { error: `วันเกิด "${s}" ไม่ใช่รูปแบบที่รองรับ — ใช้ YYYY-MM-DD หรือ DD/MM/YYYY (ค.ศ.)` };
  }

  const [first, second, year] = [Number(slash[1]), Number(slash[2]), Number(slash[3])];
  const era = eraError(s, year);
  if (era) return { error: era };

  const dayFirst = first > 12;
  const monthFirst = second > 12;
  // 0 is neither a day nor a month, and 25/13 is not a date in either order.
  if (first < 1 || second < 1 || (dayFirst && monthFirst)) return { error: notReal(s) };

  if (dayFirst) {
    return isRealDate(year, second, first)
      ? { date: isoOf(year, second, first), evidence: 'dmy' }
      : { error: notReal(s) };
  }
  if (monthFirst) {
    return isRealDate(year, first, second)
      ? {
        evidence: 'mdy',
        error: `วันเกิด "${s}" อ่านได้แบบ เดือน/วัน เท่านั้น ซึ่งไม่ใช่รูปแบบที่รองรับ`,
      }
      : { error: notReal(s) };
  }
  return { ambiguous: { first, second, year } };
}

/**
 * Resolve every วันเกิด cell in one file together.
 *
 * @param {Array<{ line: number, raw: string }>} cells — non-empty cells, in file order
 * @returns {{
 *   ok: boolean,
 *   order: 'iso'|'dmy'|null,
 *   decidedBy: { line: number, raw: string } | null,
 *   fileError: string|null,
 *   ambiguous: Array<{ line: number, raw: string }>,
 *   cells: Array<{ line: number, raw: string, date: string|null, error: string|null }>,
 *   rowErrors: Array<{ line: number, error: string }>,
 *   byLine: Map<number, { date: string|null, error: string|null }>,
 * }}
 *
 * `ok: false` means the file is not importable at all — not one row of it. The
 * caller must not fall back to importing the rows it could read: the rows it
 * could read are exactly the rows whose dates were never in doubt, and leaving
 * the doubtful ones out silently is the same wrong answer arriving later.
 */
export function resolveBirthDates(cells) {
  const read = cells.map((c) => ({ line: c.line, raw: String(c.raw).trim(), ...readCell(c.raw) }));

  const dayFirstProof = read.filter((c) => c.evidence === 'dmy');
  const monthFirstProof = read.filter((c) => c.evidence === 'mdy');
  const ambiguous = read.filter((c) => c.ambiguous).map((c) => ({ line: c.line, raw: c.raw }));

  const cite = (c) => `บรรทัด ${c.line} ("${c.raw}")`;
  const reject = (fileError) => ({
    ok: false,
    order: null,
    decidedBy: null,
    fileError,
    ambiguous,
    cells: [],
    rowErrors: [],
    byLine: new Map(),
  });

  // Two rows that cannot both be right. One of them was typed by hand into a
  // column Excel had already rewritten, and no reading of the file explains both.
  if (dayFirstProof.length && monthFirstProof.length) {
    return reject(
      `รูปแบบวันเกิดในไฟล์ไม่สอดคล้องกัน — ${cite(dayFirstProof[0])} อ่านได้แบบ วัน/เดือน `
      + `แต่ ${cite(monthFirstProof[0])} อ่านได้แบบ เดือน/วัน `
      + 'จึงไม่นำเข้าทั้งไฟล์ โปรดแก้คอลัมน์วันเกิดให้เป็น YYYY-MM-DD (ค.ศ.) ทั้งคอลัมน์แล้วนำเข้าใหม่',
    );
  }

  // Excel on an English-locale machine writes the column month-first. Rejected
  // by name rather than as "เดือน 25 ไม่ถูกต้อง", because the useful thing to
  // tell HR is which machine wrote the file.
  if (monthFirstProof.length) {
    return reject(
      `ไฟล์นี้เขียนวันเกิดแบบ MM/DD/YYYY (เดือน/วัน/ปี) — ${cite(monthFirstProof[0])} `
      + 'เป็นเดือนไม่ได้ ระบบรับเฉพาะ YYYY-MM-DD หรือ DD/MM/YYYY '
      + 'จึงไม่นำเข้าทั้งไฟล์ โปรดแก้คอลัมน์วันเกิดให้เป็น YYYY-MM-DD (ค.ศ.) แล้วนำเข้าใหม่',
    );
  }

  // Nothing in the file says which number is the day, and every candidate reads
  // as a real date either way. This is the case the whole module exists for.
  if (ambiguous.length && !dayFirstProof.length) {
    const sample = ambiguous[0];
    const { first, second, year } = read.find((c) => c.line === sample.line).ambiguous;
    return reject(
      `ตีความวันเกิดในไฟล์นี้ไม่ได้ — ${cite(sample)} เป็นได้ทั้ง `
      + `${readableDate(isoOf(year, second, first))} และ ${readableDate(isoOf(year, first, second))} `
      + 'และไม่มีแถวใดในไฟล์ชี้ขาดได้ ระบบจึงไม่นำเข้าทั้งไฟล์แทนที่จะเดา — '
      + 'โปรดแก้คอลัมน์วันเกิดให้เป็น YYYY-MM-DD (ค.ศ.) แล้วนำเข้าใหม่',
    );
  }

  // Ambiguous cells only survive to here alongside proof, so proof names the
  // order for them too. `null` is a file with nothing to interpret.
  const order = dayFirstProof.length ? 'dmy' : (read.some((c) => c.date) ? 'iso' : null);

  const resolved = read.map((c) => {
    if (!c.ambiguous) return { line: c.line, raw: c.raw, date: c.date || null, error: c.error || null };
    const { first, second, year } = c.ambiguous;
    return isRealDate(year, second, first)
      ? { line: c.line, raw: c.raw, date: isoOf(year, second, first), error: null }
      : { line: c.line, raw: c.raw, date: null, error: notReal(c.raw) };
  });

  return {
    ok: true,
    order,
    decidedBy: dayFirstProof.length && ambiguous.length
      ? { line: dayFirstProof[0].line, raw: dayFirstProof[0].raw }
      : null,
    fileError: null,
    ambiguous: [],
    cells: resolved,
    rowErrors: resolved.filter((c) => c.error).map((c) => ({ line: c.line, error: c.error })),
    byLine: new Map(resolved.map((c) => [c.line, c])),
  };
}

/** The non-empty วันเกิด cells of parsed CSV rows, carrying their file line. */
export function birthDateCells(rows) {
  const cells = [];
  rows.forEach((row, i) => {
    const raw = pick(row, ...BIRTH_DATE_HEADERS);
    if (raw) cells.push({ line: i + 2, raw }); // header is line 1
  });
  return cells;
}

/** `resolveBirthDates` straight from parsed CSV rows. A file without the column resolves to nothing. */
export function resolveBirthDateColumn(rows) {
  return resolveBirthDates(birthDateCells(rows));
}

/**
 * The first few cells as HR will read them: `05/03/1998 → 5 มีนาคม 1998`.
 *
 * Shown before the upload, not after. Once a roster is imported the wrong
 * reading is indistinguishable from the right one, so the only moment anyone
 * can catch it is while the file is still just a file.
 */
export function birthDatePreview(resolved, limit = 3) {
  return resolved.cells.slice(0, limit).map((c) => ({
    line: c.line,
    raw: c.raw,
    date: c.date,
    error: c.error,
    text: c.date ? `${c.raw} → ${readableDate(c.date)}` : `${c.raw} → ${c.error}`,
  }));
}
