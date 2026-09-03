/**
 * ประกาศวันหยุดบริษัท — which of the company's holidays belong to the month a
 * screen is showing, and which one is coming next.
 *
 * Pure: no mongoose, no Next, no clock, no imports. `node --test` pins every
 * rule below without a database or a server, the same way lib/accessLog.js and
 * lib/otMode.js are pinned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DATES ARE COMPARED AS STRINGS, and that is not a shortcut.
 *
 * `Holiday.date` is a 'YYYY-MM-DD' string precisely so that no timezone can
 * shift it (see src/models/Holiday.js), and in that format lexicographic order
 * IS chronological order. Parsing them into `Date` objects here would put the
 * one seam this system keeps closed — a clock — into a module whose whole job
 * is to sort and filter. The caller supplies today's date as a string too; on
 * the client that comes from `today()` in lib/today.js, which is the company's
 * wall clock rather than the browser's idea of UTC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT IN HERE: SATURDAY AND SUNDAY.
 *
 * They are holidays by rule, not by calendar entry — `makeIsHoliday` in
 * src/lib/otEngine.js decides them from the weekday, and the collection this
 * module reads holds only the extra dates HR announces. A banner built from
 * these rows is therefore an announcement of the EXTRA days and must say so, or
 * a reader concludes that a Sunday not listed here is an ordinary working day.
 * The wording that carries that is in components/HolidayBanner.jsx.
 */

/** The only shape `Holiday.date` is allowed to have, restated where it is read. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A row this module is willing to speak about.
 *
 * A holiday with no date, or with a date in some other shape, is dropped rather
 * than repaired: every write path validates the format, so a row that fails
 * here arrived some other way, and a banner is the wrong place to find out.
 * Dropping it costs one line on a notice; guessing at it would put a wrong date
 * in front of fifty people.
 */
const usable = (h) => Boolean(h) && ISO_DATE.test(String(h.date || ''));

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * The holidays that fall in one 'YYYY-MM', in date order.
 *
 * Sorted here even though `GET /api/holidays` already sorts: this function is
 * also the one the tests drive, and a helper that is correct only because its
 * caller happened to be is a helper that breaks the day somebody feeds it a
 * cache, a merge, or two years concatenated.
 */
export function holidaysInMonth(holidays, period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return [];
  return (holidays || []).filter((h) => usable(h) && h.date.slice(0, 7) === period).sort(byDate);
}

/**
 * The first holiday on or after `from`, or null when the list runs out.
 *
 * ON OR AFTER, not strictly after: asked on a day that is itself a company
 * holiday, "วันหยุดถัดไป" should answer with today. The alternative reads as a
 * denial — a banner naming next month while somebody is sitting at home is
 * worse than one that states the obvious.
 *
 * Returns null rather than throwing on a missing or malformed `from`, because
 * the caller is a banner: the month's own list is the part that matters and it
 * does not depend on this.
 */
export function nextHoliday(holidays, from) {
  if (!ISO_DATE.test(String(from || ''))) return null;
  return (holidays || []).filter((h) => usable(h) && h.date >= from).sort(byDate)[0] || null;
}

/**
 * Every holiday of the year the banner has loaded, in date order — what the
 * ปฏิทินวันหยุดประจำปี dialog lists.
 *
 * A pass-through with a sort and a filter, and it exists so that the dialog and
 * the banner cannot disagree about which rows are usable. Two components each
 * filtering "the ones with a real date" is how one of them ends up showing a
 * row the other refuses to.
 */
export function holidayCalendar(holidays) {
  return (holidays || []).filter(usable).sort(byDate);
}

/**
 * The same rows, grouped into the months they fall in — what the
 * ปฏิทินวันหยุดประจำปี dialog lists.
 *
 * `[{ period: 'YYYY-MM', days: [...] }]`, months in order and days in order
 * inside each. Built on `holidayCalendar` rather than beside it, so the dialog
 * cannot end up grouping a row the banner refused to draw.
 *
 * ORDER COMES FROM THE SORT, NOT FROM A SECOND ONE. The list is already in date
 * order and a Map keeps its insertion order, so the months come out
 * chronological without this function knowing what a month is. Sorting the keys
 * afterwards would be a second opinion about ordering, and the day two of them
 * disagree is the day a January lands under a December.
 *
 * MONTHS WITH NO HOLIDAY ARE NOT IN THE RESULT, which is a decision and not an
 * oversight. A year has twelve months and this list has about fifteen days in
 * it; drawn as twelve headings, most of them saying "ไม่มีวันหยุด", the dialog
 * becomes a page of empty boxes with the answer scattered through it. The
 * per-month statement that IS worth making is the banner's own — it says
 * "เดือนนี้ไม่มีวันหยุดบริษัทที่ประกาศไว้" about the one month somebody is
 * actually filing in, where the absence changes what they do.
 */
export function holidayCalendarByMonth(holidays) {
  const months = new Map();
  for (const h of holidayCalendar(holidays)) {
    const period = h.date.slice(0, 7);
    if (!months.has(period)) months.set(period, []);
    months.get(period).push(h);
  }
  return [...months].map(([period, days]) => ({ period, days }));
}
