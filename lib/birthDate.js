/**
 * Reading the วันเกิด column of a roster CSV — STRICTLY วัน/เดือน/ปี.
 *
 * THE RULE, and since 2026-09-04 it is the whole of it:
 *
 *   `12/05/1989`  →  12 May 1989.  Always. Every row. No conditions.
 *   `12-05-1989`  →  the same date; both separators, one or two digits.
 *   `2540-01-05`  →  year first when the leading group is four digits.
 *   ปี > 2400     →  พ.ศ., minus 543.   ปี ≤ 2400  →  ค.ศ., used as it stands.
 *
 * Anything that is not a real date under that reading is a ROW ERROR: that row
 * is skipped and named, and the rest of the file imports.
 *
 * ── WHAT THIS FILE USED TO BE, AND WHY THAT WENT ────────────────────────────
 *
 * HR types 1998-03-05. Excel shows it as 05/03/1998, and saving the file writes
 * that back — so what arrives here is a column Excel has already rewritten, in
 * whatever order the machine's locale prefers rather than the order anyone
 * chose. 05/03/1998 is 5 March on a Thai machine and 3 May on an American one.
 *
 * For a month this module treated that as a question about the FILE and went to
 * considerable lengths not to answer it: it collected evidence (a row with a 15
 * in it can only be วัน/เดือน), refused a file that settled nothing, then grew
 * a per-file question on the import screen and a company-wide default in
 * ตั้งค่าระบบ to answer it with. All of that is gone. It was withdrawn on
 * request on 2026-09-04, in one line — "ให้ Strict เป็น วัน-เดือน-ปี ถาวร" —
 * and what replaced it is the four lines at the top of this comment.
 *
 * ── WHAT IT COSTS, WRITTEN DOWN BECAUSE NOTHING ON A SCREEN WILL SAY IT ─────
 *
 * A roster that really was written month-first now imports. Roughly two rows in
 * three of it — every row whose day is 12 or under — is stored with the day and
 * the month swapped, silently, and no screen, report or comparison in this
 * system can ever contradict it, because a birthday is only ever compared
 * against itself. The remaining third, the rows with a day over 12, fail their
 * own row and are listed as skipped.
 *
 * That failure mode is not a reason to re-litigate the decision; it is the
 * reason the two things below are not decoration and must not be removed to
 * tidy the screen:
 *
 *   `readableDate` PRINTS THE MONTH AS A WORD. `05/03/1998 → 5 มีนาคม 1998` on
 *   the preview, before the upload, is now the ONLY moment a human being can
 *   catch a month-first file. It was a nicety while the machine refused such
 *   files; it is the whole check now.
 *
 *   A ROW THAT CANNOT BE วัน/เดือน SAYS SO BY NAME. `05/25/1998` does not fail
 *   as "ไม่มีอยู่จริงในปฏิทิน" — that would send somebody hunting a calendar
 *   mistake in a date whose numbers are all correct. It says the file looks
 *   month-first and names the date it would be, so one skipped row is a signal
 *   about the whole column rather than a puzzle about one person.
 *
 * ── WHERE THE READING ITSELF LIVES ──────────────────────────────────────────
 *
 * `lib/smartDate.js`, and not here. That module already read exactly this way
 * for every typed and posted date in the app — the roster form, both employee
 * endpoints, the holiday calendar — and the point of this round is that a date
 * read off a file and a date typed into a box can no longer be read
 * differently. What is left in this file is the FILE-level work: which cells
 * the column has, what shape the file turned out to be, what to say about a row
 * that failed, and the sample HR checks before pressing ยืนยันนำเข้า.
 *
 * Pure: no I/O, no dates from the clock. The import route and the preview on
 * the พนักงาน screen both read a file through here, so what HR is shown before
 * confirming is produced by the same code that decides what is stored.
 */

import { pick } from '../src/lib/csv.js';
import { ISO_SHAPE, smartDate, THAI_MONTH_NAMES } from './smartDate.js';

/** The header spellings a roster file may use for the column. */
export const BIRTH_DATE_HEADERS = ['birthDate', 'วันเกิด', 'birth_date'];

/**
 * What shape the file turned out to be, for the one sentence the preview says
 * about the column as a whole.
 *
 * IT IS A DESCRIPTION NOW, NEVER A DECISION. These used to be the answers to
 * "which way round is this file?", and one of them — `mdy` — was a reading the
 * importer could be talked into. There is no question and there is no `mdy`: a
 * file is read วัน/เดือน/ปี, and this says which of the two accepted shapes its
 * cells were written in.
 */
export const ORDER_LABEL = {
  iso: 'YYYY-MM-DD (ปี-เดือน-วัน)',
  dmy: 'DD/MM/YYYY (วัน/เดือน/ปี)',
  mixed: 'DD/MM/YYYY และ YYYY-MM-DD ปนกันในไฟล์เดียว',
};

/**
 * "5 มีนาคม 1998" — the sentence HR reads to check an interpretation.
 *
 * THE MONTH IS A WORD ON PURPOSE, and this is one of the places in the app
 * allowed to spell one out (see the note over `thaiDate` in lib/api.js). The
 * numerals are what HR is already looking at in the file and are exactly what
 * does NOT distinguish 5 March from 3 May; the month name is the thing they can
 * check against the person they hired. Since the importer stopped refusing
 * month-first files, this line is the only check left standing.
 *
 * ค.ศ., deliberately — the year that is in the FILE, so it matches the column
 * in front of them. `thaiWords` in lib/smartDate.js is the พ.ศ. counterpart and
 * is a different job.
 */
export function readableDate(iso) {
  const m = ISO_SHAPE.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${THAI_MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[1])}`;
}

/**
 * One cell, read the one way there is to read it.
 *
 * The refusal that gets its own sentence is the month-first one, because it is
 * the only one that is about the FILE rather than about the row: `31/04/1998`
 * is one person's birthday typed wrong, `05/25/1998` is a column somebody's
 * Excel rewrote, and the repair for the second is not to that line.
 */
function readCell(raw) {
  const s = String(raw ?? '').trim();
  const read = smartDate(s, { label: 'วันเกิด' });
  const isoShape = ISO_SHAPE.test(s);

  if (read.reason === 'month_day_year') {
    return {
      error: `วันเกิด "${s}" ไม่มีเดือนที่ ${Number(s.split(/[/-]/)[1])} — `
        + 'ระบบอ่านทุกแถวเป็น วัน/เดือน/ปี แถวนี้จึงถูกข้าม · '
        + `ถ้าไฟล์นี้เขียนแบบ เดือน/วัน/ปี (คือ ${readableDate(read.meant)}) `
        + 'ต้องแก้ทั้งคอลัมน์ในไฟล์ก่อน แล้วนำเข้าใหม่',
      isoShape,
    };
  }
  if (read.error) return { error: read.error, isoShape };
  return { date: read.date, converted: read.converted, isoShape };
}

/**
 * Resolve every วันเกิด cell in one file together.
 *
 * @param {Array<{ line: number, raw: string }>} cells — non-empty cells, in file order
 * @returns {{
 *   order: 'iso'|'dmy'|'mixed'|null,
 *   cells: Array<{ line, raw, date, error, converted }>,
 *   converted: Array<{ line, raw, date }>,
 *   rowErrors: Array<{ line, error }>,
 *   byLine: Map<number, { date: string|null, error: string|null }>,
 * }}
 *
 * NO OPTIONS, AND NO WAY TO PASS ONE. `declaredOrder` and `fallbackOrder` were
 * the two doors an answer came through and both are bricked up: there is
 * nothing left for an answer to settle. Taking the parameters away rather than
 * ignoring them is the point — an option accepted and quietly dropped would
 * leave the import screen and ตั้งค่าระบบ still offering a choice that changed
 * nothing, which is the worst of the three states this could be in.
 *
 * THERE IS NO FILE-LEVEL REFUSAL LEFT, so there is no `ok` and no `fileError`.
 * Every failure this module can produce is now about ONE ROW, and a row that
 * fails is skipped with its reason named while the rest of the file imports —
 * which is what a bad `29/02/2541` always did, and is now what `05/25/1998`
 * does too.
 *
 * `converted` is the rows whose year arrived as พ.ศ. and was moved to ค.ศ. —
 * the count the preview shows HR. A conversion that says nothing is a birthday
 * moved 543 years by a machine with nobody told.
 */
export function resolveBirthDates(cells) {
  const read = cells.map((c) => {
    const raw = String(c.raw).trim();
    const { date = null, error = null, converted = false, isoShape } = readCell(raw);
    return { line: c.line, raw, date, error, converted, isoShape };
  });

  const dated = read.filter((c) => c.date);
  const anyIso = dated.some((c) => c.isoShape);
  const anySlash = dated.some((c) => !c.isoShape);
  const order = anyIso && anySlash ? 'mixed' : (anyIso ? 'iso' : (anySlash ? 'dmy' : null));

  const resolved = read.map(({ isoShape, ...rest }) => rest);

  return {
    order,
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
 * SHOWN BEFORE THE UPLOAD, NOT AFTER, and it is now the only check there is.
 * Once a roster is imported the wrong reading is indistinguishable from the
 * right one — see the header — so the only moment anyone can catch a
 * month-first file is while it is still just a file, on this list.
 *
 * THE ROWS THAT FAILED COME FIRST, because they are the ones worth the reader's
 * three seconds: under a strict reading a failed row is usually evidence about
 * the whole column rather than about one person, and a sample of the first
 * three cells of a two-hundred-row file would show none of them.
 *
 * A converted row carries `(พ.ศ. → ค.ศ.)` on its own line as well as being
 * counted in the summary above the list. The count says how many; the line says
 * which, and that is the one HR can check against the file in front of them.
 */
export function birthDatePreview(resolved, limit = 3) {
  const failed = resolved.cells.filter((c) => c.error);
  const clean = resolved.cells.filter((c) => !c.error);
  return [...failed, ...clean].slice(0, limit).map((c) => ({
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
