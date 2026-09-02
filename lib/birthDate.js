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
 * THE ERA IS NOT PART OF THAT DOUBT, and since 2026-09-02 it is not refused
 * either. A year past 2400 is พ.ศ. — there is no other reading of 2515, and
 * subtracting 543 is the only thing it can mean. HR keeps birthdays in พ.ศ.
 * everywhere else in their own paperwork, so a roster typed out of a personnel
 * file arrives that way; refusing it made them retype a column by hand, which
 * is its own source of wrong dates. The conversion is counted and said out loud
 * on the preview rather than done quietly — see `converted` below.
 *
 * That is a different question from the one above and must not be confused with
 * it: an era is decided by the YEAR alone, per cell, with nothing to guess,
 * while วัน/เดือน order is decided by the FILE and cannot be guessed at all.
 *
 * Pure: no I/O, no dates from the clock. The import route and the preview on
 * the พนักงาน screen both read a file through here, so what HR is shown before
 * confirming is produced by the same code that decides what is stored.
 */

import { pick } from '../src/lib/csv.js';
import {
  ISO_SHAPE as ISO,
  DMY_SHAPE as SLASH,
  THAI_MONTH_NAMES as THAI_MONTHS,
  readEra as readYear,
  isRealDate,
  isoOf,
} from './smartDate.js';

/** The header spellings a roster file may use for the column. */
export const BIRTH_DATE_HEADERS = ['birthDate', 'วันเกิด', 'birth_date'];

export const ORDER_LABEL = {
  iso: 'YYYY-MM-DD (ปี-เดือน-วัน)',
  dmy: 'DD/MM/YYYY (วัน/เดือน/ปี)',
};

/**
 * THE SHAPES, THE ERA AND THE CALENDAR ALL COME FROM `lib/smartDate.js`.
 *
 * They were written out here until 2026-09-02, with a comment saying the 2400
 * was "the same 2400 the holiday calendar's normaliseDate() uses" — a copy
 * admitting to being one, and the third of three. What this module still owns
 * is the only question the shared reader cannot answer: which number in
 * `05/03/1998` is the day, which is a fact about the FILE and is settled below
 * from the file's own evidence.
 *
 * Imported under the old local names so every reference below reads as it did.
 */

/** "5 มีนาคม 1998" — the sentence HR reads to check an interpretation. */
export function readableDate(iso) {
  const m = ISO.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1])}`;
}

/**
 * A cell that is not a date in any calendar.
 *
 * Names the ค.ศ. year when one was converted, because "29/02/2541 ไม่มีอยู่จริง"
 * is a puzzle if you are counting leap years in พ.ศ. — 2541 divides by four and
 * 1998 does not, and the row was checked as 1998.
 */
const notReal = (raw, era) => (era.converted
  ? `วันเกิด "${raw}" (ค.ศ. ${era.year}) ไม่มีอยู่จริงในปฏิทิน`
  : `วันเกิด "${raw}" ไม่มีอยู่จริงในปฏิทิน`);

/**
 * One cell, read as far as it can be read without knowing the file's order.
 *
 * `evidence` is what the cell proves about the file: 'dmy' when the first
 * number cannot be a month, 'mdy' when the second cannot be. Only a cell that
 * resolves to a real date carries evidence — 31/04/1998 is wrong under every
 * reading, and a wrong cell must not get to decide how the right ones are read.
 *
 * `converted` says the year arrived as พ.ศ. and was moved back 543 years. The
 * calendar check below runs on the CONVERTED year, which is the whole reason
 * the era is settled first: 29 February exists in 2539 only because it exists
 * in 1996.
 */
function readCell(raw) {
  const s = String(raw ?? '').trim();

  const iso = ISO.exec(s);
  if (iso) {
    const era = readYear(iso[1]);
    const [month, day] = [Number(iso[2]), Number(iso[3])];
    if (!isRealDate(era.year, month, day)) return { error: notReal(s, era) };
    return { date: isoOf(era.year, month, day), converted: era.converted };
  }

  const slash = SLASH.exec(s);
  if (!slash) {
    return { error: `วันเกิด "${s}" ไม่ใช่รูปแบบที่รองรับ — ใช้ YYYY-MM-DD หรือ DD/MM/YYYY (ค.ศ. หรือ พ.ศ.)` };
  }

  const [first, second] = [Number(slash[1]), Number(slash[2])];
  const era = readYear(slash[3]);
  const { year, converted } = era;

  const dayFirst = first > 12;
  const monthFirst = second > 12;
  // 0 is neither a day nor a month, and 25/13 is not a date in either order.
  if (first < 1 || second < 1 || (dayFirst && monthFirst)) return { error: notReal(s, era) };

  if (dayFirst) {
    return isRealDate(year, second, first)
      ? { date: isoOf(year, second, first), evidence: 'dmy', converted }
      : { error: notReal(s, era) };
  }
  if (monthFirst) {
    return isRealDate(year, first, second)
      ? {
        evidence: 'mdy',
        error: `วันเกิด "${s}" อ่านได้แบบ เดือน/วัน เท่านั้น ซึ่งไม่ใช่รูปแบบที่รองรับ`,
      }
      : { error: notReal(s, era) };
  }
  return { ambiguous: { first, second, year }, converted };
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
 *   cells: Array<{
 *     line: number, raw: string, date: string|null, error: string|null, converted: boolean,
 *   }>,
 *   converted: Array<{ line: number, raw: string, date: string }>,
 *   rowErrors: Array<{ line: number, error: string }>,
 *   byLine: Map<number, { date: string|null, error: string|null }>,
 * }}
 *
 * `converted` is the rows whose year arrived as พ.ศ. and was moved to ค.ศ. —
 * the count the preview shows HR. Carried as a list rather than a number so the
 * screen can name lines if it ever needs to, and empty on a ค.ศ. file.
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
    converted: [],
    rowErrors: [],
    byLine: new Map(),
  });

  // Two rows that cannot both be right. One of them was typed by hand into a
  // column Excel had already rewritten, and no reading of the file explains both.
  if (dayFirstProof.length && monthFirstProof.length) {
    return reject(
      `รูปแบบวันเกิดในไฟล์ไม่สอดคล้องกัน — ${cite(dayFirstProof[0])} อ่านได้แบบ วัน/เดือน `
      + `แต่ ${cite(monthFirstProof[0])} อ่านได้แบบ เดือน/วัน `
      + 'จึงไม่นำเข้าทั้งไฟล์ โปรดแก้คอลัมน์วันเกิดให้เป็น YYYY-MM-DD ทั้งคอลัมน์แล้วนำเข้าใหม่',
    );
  }

  // Excel on an English-locale machine writes the column month-first. Rejected
  // by name rather than as "เดือน 25 ไม่ถูกต้อง", because the useful thing to
  // tell HR is which machine wrote the file.
  if (monthFirstProof.length) {
    return reject(
      `ไฟล์นี้เขียนวันเกิดแบบ MM/DD/YYYY (เดือน/วัน/ปี) — ${cite(monthFirstProof[0])} `
      + 'เป็นเดือนไม่ได้ ระบบรับเฉพาะ YYYY-MM-DD หรือ DD/MM/YYYY '
      + 'จึงไม่นำเข้าทั้งไฟล์ โปรดแก้คอลัมน์วันเกิดให้เป็น YYYY-MM-DD แล้วนำเข้าใหม่',
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
      + 'โปรดแก้คอลัมน์วันเกิดให้เป็น YYYY-MM-DD แล้วนำเข้าใหม่',
    );
  }

  // Ambiguous cells only survive to here alongside proof, so proof names the
  // order for them too. `null` is a file with nothing to interpret.
  const order = dayFirstProof.length ? 'dmy' : (read.some((c) => c.date) ? 'iso' : null);

  const resolved = read.map((c) => {
    const converted = Boolean(c.converted);
    if (!c.ambiguous) {
      return {
        line: c.line, raw: c.raw, date: c.date || null, error: c.error || null, converted,
      };
    }
    const { first, second, year } = c.ambiguous;
    return isRealDate(year, second, first)
      ? { line: c.line, raw: c.raw, date: isoOf(year, second, first), error: null, converted }
      : {
        line: c.line,
        raw: c.raw,
        date: null,
        error: notReal(c.raw, { converted, year }),
        converted,
      };
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
    // Only the rows that both converted AND landed on a date: a cell whose year
    // was พ.ศ. and whose day does not exist is a row being skipped, and counting
    // it as converted would tell HR a birthday was saved that was not.
    converted: resolved
      .filter((c) => c.converted && c.date)
      .map((c) => ({ line: c.line, raw: c.raw, date: c.date })),
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
 *
 * A converted row carries `(พ.ศ. → ค.ศ.)` on its own line as well as being
 * counted in the summary above the list. The count says how many; the line says
 * which, and that is the one HR can check against the file in front of them.
 */
export function birthDatePreview(resolved, limit = 3) {
  return resolved.cells.slice(0, limit).map((c) => ({
    line: c.line,
    raw: c.raw,
    date: c.date,
    error: c.error,
    converted: c.converted,
    text: c.date
      ? `${c.raw} → ${readableDate(c.date)}${c.converted ? ' (พ.ศ. → ค.ศ.)' : ''}`
      : `${c.raw} → ${c.error}`,
  }));
}
