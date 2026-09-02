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
 * in Thai words on the spot and can correct it in the same breath. It must NOT
 * be used that way on a CSV column: nobody watched Excel rewrite that column,
 * nobody reads the file again afterwards, and a birthday moved two months by a
 * default is invisible forever. That case belongs to `lib/birthDate.js`, which
 * settles the order from the FILE and refuses a file that settles nothing.
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
 * "19 กันยายน 2515" — an ISO date read back in the era HR reads in.
 *
 * `lib/api.js` has `thaiDate` for the same job and this is not a second copy of
 * it for the browser to load: this module is imported by API routes running on
 * the server, where `lib/api.js` — which reaches for `fetch` and a token — has
 * no business being. The two agree by test, not by hope.
 */
export function thaiText(iso) {
  const m = ISO_SHAPE.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${THAI_MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[1]) + ERA_OFFSET}`;
}

/**
 * ONE typed or posted date, in either era and either shape, as `YYYY-MM-DD`
 * ค.ศ. — the Smart Date Handler proper.
 *
 * @param {string} raw          what the person typed or the caller sent
 * @param {object} [opts]
 * @param {string} [opts.label] what to call the field in an error — "วันเกิด"
 * @returns {{ date: string|null, converted: boolean, error: string|null }}
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
 */
export function smartDate(raw, { label = 'วันที่' } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return { date: null, converted: false, error: null };

  const bad = (error) => ({ date: null, converted: false, error });
  const notReal = (era) => bad(era.converted
    ? `${label} “${s}” (ค.ศ. ${era.year}) ไม่มีอยู่จริงในปฏิทิน`
    : `${label} “${s}” ไม่มีอยู่จริงในปฏิทิน`);

  const iso = ISO_SHAPE.exec(s);
  if (iso) {
    const era = readEra(iso[1]);
    const [month, day] = [Number(iso[2]), Number(iso[3])];
    if (!isRealDate(era.year, month, day)) return notReal(era);
    return { date: isoOf(era.year, month, day), converted: era.converted, error: null };
  }

  const dmy = DMY_SHAPE.exec(s);
  if (!dmy) {
    return bad(`${label} “${s}” ไม่ใช่รูปแบบที่รองรับ — ใช้ DD/MM/YYYY หรือ YYYY-MM-DD (พ.ศ. หรือ ค.ศ. ก็ได้)`);
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
      + `ถ้าหมายถึง ${thaiText(isoOf(era.year, day, month))} ให้พิมพ์เป็น ${pad(month)}/${pad(day)}/${dmy[3]}`,
    );
  }

  if (!isRealDate(era.year, month, day)) return notReal(era);
  return { date: isoOf(era.year, month, day), converted: era.converted, error: null };
}
