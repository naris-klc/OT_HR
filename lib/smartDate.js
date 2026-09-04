/**
 * ปี พ.ศ. หรือ ค.ศ. — the one place in this app that decides.
 *
 * WHY THIS FILE EXISTS AT ALL. The rule is four lines long and was therefore
 * written three times: once in `lib/holidays.js`, once again in
 * `legacy/routes/holidays.js`, and a third time inside `lib/birthDate.js` —
 * whose own comment says out loud that it is using "the same 2400 the holiday
 * calendar's normaliseDate() uses", which is a copy admitting to being one.
 * Three copies of a threshold is three chances for a birthday in the 2450s to
 * be read one way by the roster and another by the calendar, and nothing on
 * any screen would say the two disagreed. So the threshold, the offset and the
 * calendar arithmetic live here and are imported; a reader who wants to know
 * where the era is decided has one file to open.
 *
 * THE RULE, and it is the whole of it:
 *
 *   ปี > 2400  →  พ.ศ.  →  ลบ 543   (2515 → 1972)
 *   ปี ≤ 2400  →  ค.ศ.  →  ใช้ตามนั้น (1998 → 1998)
 *
 * 2400 rather than something tighter around the years people are actually born
 * in, because the number's job is to be UNAMBIGUOUS rather than tight: there
 * is no ค.ศ. year between 2401 and 2500 that any date in this system could
 * hold, and a wider floor is one fewer edge for the two readers to disagree
 * about. It is checked by a test, not by memory — see test/smartDate.test.js.
 *
 * ── WHAT IS AND IS NOT DECIDABLE HERE ──────────────────────────────────────
 *
 * The ERA is decidable, per value, with nothing to guess: 2515 has one reading
 * and 1972 has one reading, and no context anywhere could change either.
 *
 * The วัน/เดือน ORDER is not, in general. `05/03/1998` is 5 March to a Thai
 * machine and 3 May to an American one, and both are real dates. This module
 * settles it for ONE TYPED VALUE by taking DD/MM/YYYY, the Thai standard —
 * which is honest, because a person typing into a box is shown the result back
 * as `เก็บเป็น ค.ศ. 1998-03-05` on the spot, where the month cannot be the
 * other number, and can correct it in the same breath. It must NOT
 * be used that way on a CSV column: nobody watched Excel rewrite that column,
 * nobody reads the file again afterwards, and a birthday moved two months by a
 * default is invisible forever. That case belongs to `lib/birthDate.js`, which
 * settles the order from the FILE and refuses a file that settles nothing.
 *
 * IT ALSO PRINTS in DD/MM/YYYY since 2026-09-04 — `thaiText` — which is the
 * whole app's one date form and not a decision this module makes on its own;
 * the note over `thaiDate` in lib/api.js is where it is made. The single
 * exception is `thaiWords`, and its own note says why it cannot be numerals.
 *
 * Pure: no I/O, no clock. Imported by the roster import, the roster form's two
 * เพิ่ม/แก้ไข endpoints and the holiday calendar.
 */

/**
 * Past this, a year is พ.ศ. Kept as a name rather than a literal so the two
 * halves of the rule cannot drift: a reader who changes one changes both.
 */
export const BUDDHIST_ERA_FLOOR = 2400;

/** พ.ศ. − ค.ศ. The Thai era is 543 years ahead, always, with no exceptions. */
export const ERA_OFFSET = 543;

/**
 * Both separators, both shapes.
 *
 * A four-digit leading group can only be a year, so it can only be the ISO
 * shape; one or two digits leading cannot be a year at all. The two patterns
 * therefore cannot both match one string, whichever separator it uses, and
 * `2515-09-19`, `2515/09/19`, `19/09/2515` and `19-09-2515` are one date
 * written four ways.
 */
export const ISO_SHAPE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;
export const DMY_SHAPE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/**
 * A year as ค.ศ., and whether that took a conversion.
 *
 * PER VALUE, never per file or per form. A roster typed half from an old
 * personnel sheet and half from a new one carries both eras in one column, and
 * each cell still says which it is without reference to its neighbours.
 *
 * `converted` is carried rather than discarded because a machine that moves a
 * date 543 years and says nothing is indistinguishable from a machine that got
 * it wrong. Every caller shows it: the CSV preview counts it, the roster form
 * says it under the box, the import confirmation repeats it.
 */
export function readEra(raw) {
  const year = Number(raw);
  return year > BUDDHIST_ERA_FLOOR
    ? { year: year - ERA_OFFSET, converted: true }
    : { year, converted: false };
}

export const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** ค.ศ. leap years — every fourth, minus every hundredth, plus every four-hundredth. */
export function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Is this a day that exists?
 *
 * ALWAYS ASKED OF THE ค.ศ. YEAR, which is why the era is settled first
 * everywhere in this file. 2539 divides by four and 1996 is a leap year, so
 * `29/02/2539` is a real birthday; 2541 also divides by four and 1998 is not,
 * so `29/02/2541` is not — and a checker that counted leap years in พ.ศ. would
 * get both of them the wrong way round.
 */
export function isRealDate(year, month, day) {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Thai month names, for saying a parsed date back to the person who typed it. */
export const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * "19/09/2515" — an ISO date read back in the shape and the era HR reads in.
 *
 * `lib/api.js` has `thaiDate` for the same job and this is not a second copy of
 * it for the browser to load: this module is imported by API routes running on
 * the server, where `lib/api.js` — which reaches for `fetch` and a token — has
 * no business being. The two agree by test, not by hope.
 *
 * IT SPELLED THE MONTH OUT until 2026-09-04 — "19 กันยายน 2515" — and stopped
 * for the reason written over `thaiDate`: one date form for the whole app, and
 * DD/MM/YYYY is it. The spelled-out form did not disappear, it narrowed to the
 * one job only it can do; that is `thaiWords` below.
 */
export function thaiText(iso) {
  const m = ISO_SHAPE.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${pad(m[3])}/${pad(m[2])}/${Number(m[1]) + ERA_OFFSET}`;
}

/**
 * "19 กันยายน 2515" — the month SPELLED OUT, for the one question numerals
 * cannot answer.
 *
 * NOT A LEFTOVER, AND NOT AN ALTERNATIVE TO `thaiText`. Nothing on any screen
 * may reach for this to make a date look nicer; it exists because there is a
 * sentence in this file whose entire job is to tell `05/03` and `03/05` apart,
 * and a sentence that answered "which of these two dates did you mean?" with a
 * third numeral would be restating the question. The same exception, for the
 * same reason, is why `readableDate` in lib/birthDate.js still spells its months
 * out. (A third case, the two ตัวอย่าง on ตั้งค่าระบบ → รูปแบบวันที่ใน CSV,
 * went with that card on 2026-09-04.)
 *
 * พ.ศ., like everything else the reader is shown. `readableDate` is the ค.ศ.
 * counterpart and is deliberately not this function — it prints the year that
 * is in the FILE, so HR can match it against the column in front of them.
 */
export function thaiWords(iso) {
  const m = ISO_SHAPE.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${THAI_MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[1]) + ERA_OFFSET}`;
}

/**
 * "14/08/2569 16:03:22" — a stored moment, printed in a NAMED timezone.
 *
 * `thaiStamp` in lib/api.js is the same string for the browser, which reads a
 * moment in whatever zone the reader's machine is in. This one is for the two
 * files that leave the machine — บันทึกระบบ and รายงานการใช้สิทธิ์พิเศษ, both
 * CSV — where "the reader's zone" is not a thing that exists: the file is
 * evidence about an evening in Bangkok, opened next week on a laptop that could
 * be anywhere, so the zone is named by the caller and printed as asked.
 *
 * `hourCycle: 'h23'` and not `hour12: false`, which is the older spelling of
 * roughly the same wish and gives `24:15` for a quarter past midnight on some
 * runtimes. Midnight is when the last OT of an evening is stamped, so this is
 * the hour that matters most here.
 *
 * The era is added AFTER the format, never inside it: asking Intl for a Thai
 * calendar would also bring Thai month names and a Thai numbering this app does
 * not use, and the +543 belongs to the one file that owns the offset anyway.
 */
export function thaiStampText(value, { timeZone, seconds = true } = {}) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const part = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const day = `${part.day}/${part.month}/${Number(part.year) + ERA_OFFSET}`;
  const clock = `${part.hour}:${part.minute}`;
  return seconds ? `${day} ${clock}:${part.second}` : `${day} ${clock}`;
}

/**
 * ONE typed or posted date, in either era and either shape, as `YYYY-MM-DD`
 * ค.ศ. — the Smart Date Handler proper.
 *
 * @param {string} raw          what the person typed or the caller sent
 * @param {object} [opts]
 * @param {string} [opts.label] what to call the field in an error — "วันเกิด"
 * @returns {{
 *   date: string|null, converted: boolean, error: string|null,
 *   reason: 'shape'|'not_real'|'month_day_year'|null, meant: string|null,
 * }}
 *
 * `date` is always ค.ศ. and always `YYYY-MM-DD`, which is what every store in
 * this app holds and what `Employee.birthDate`'s schema match insists on.
 * `converted: true` means the caller's value was พ.ศ. and 543 was taken off it.
 *
 * An empty value is not an error — `{ date: null, error: null }`. วันเกิด is
 * optional on the roster and "" means "clear it"; a parser that refused a blank
 * would make the form unable to empty a field it is allowed to empty.
 *
 * A value with the month and day the American way round — `03/25/1998` — is
 * REFUSED and not silently swapped, and the error names the swap so the person
 * can make it themselves. Swapping for them would be the guess this module's
 * header refuses on a CSV column, made in the one place where a human being is
 * standing right there and can answer.
 *
 * ── `reason` AND `meant`, AND WHY A CODE RATHER THAN THE SENTENCE ───────────
 *
 * Added 2026-09-04 for `lib/birthDate.js`, which reads a FILE through this
 * function and cannot use the sentences written for somebody typing. "ให้พิมพ์
 * เป็น 25/03/1998" is the right repair at a keyboard and the wrong one over a
 * column of two hundred cells that Excel wrote, where the repair is to the
 * file. So the WHY travels as a code and each caller says its own sentence;
 * `error` is unchanged and is still the right thing to show a typist.
 *
 * `meant` is the date the value would be under the other reading, ค.ศ. and
 * ISO — present only for `month_day_year`, which is the only refusal where
 * there is another reading to name. It is NOT an offer to use it.
 */
export function smartDate(raw, { label = 'วันที่' } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return { date: null, converted: false, error: null, reason: null, meant: null };

  const bad = (error, reason, meant = null) => ({
    date: null, converted: false, error, reason, meant,
  });
  const notReal = (era) => bad(era.converted
    ? `${label} “${s}” (ค.ศ. ${era.year}) ไม่มีอยู่จริงในปฏิทิน`
    : `${label} “${s}” ไม่มีอยู่จริงในปฏิทิน`, 'not_real');
  const ok = (date, converted) => ({ date, converted, error: null, reason: null, meant: null });

  const iso = ISO_SHAPE.exec(s);
  if (iso) {
    const era = readEra(iso[1]);
    const [month, day] = [Number(iso[2]), Number(iso[3])];
    if (!isRealDate(era.year, month, day)) return notReal(era);
    return ok(isoOf(era.year, month, day), era.converted);
  }

  const dmy = DMY_SHAPE.exec(s);
  if (!dmy) {
    return bad(
      `${label} “${s}” ไม่ใช่รูปแบบที่รองรับ — ใช้ DD/MM/YYYY หรือ YYYY-MM-DD (พ.ศ. หรือ ค.ศ. ก็ได้)`,
      'shape',
    );
  }

  const [day, month] = [Number(dmy[1]), Number(dmy[2])];
  const era = readEra(dmy[3]);

  /**
   * The one case worth its own sentence: a value that is only wrong because it
   * is the other way round. `03/25/1998` is what a machine set to English
   * writes, and "ไม่มีอยู่จริงในปฏิทิน" would send somebody looking for a
   * calendar mistake in a date whose numbers are all correct.
   */
  if (month > 12 && isRealDate(era.year, day, month)) {
    return bad(
      `${label} “${s}” เป็นรูปแบบ เดือน/วัน/ปี ซึ่งระบบไม่รับ — `
      + `ถ้าหมายถึง ${thaiWords(isoOf(era.year, day, month))} ให้พิมพ์เป็น ${pad(month)}/${pad(day)}/${dmy[3]}`,
      'month_day_year',
      isoOf(era.year, day, month),
    );
  }

  if (!isRealDate(era.year, month, day)) return notReal(era);
  return ok(isoOf(era.year, month, day), era.converted);
}
