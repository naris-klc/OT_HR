/**
 * What day it is where the company is — as a wall-clock 'YYYY-MM-DD' string.
 *
 * THE ONE PLACE A DATE IS PRODUCED RATHER THAN READ. Every other date in this
 * system arrives as a string somebody typed or a file supplied — `workDate`,
 * `Holiday.date`, `Employee.birthDate`, `PolicyVersion.effectiveFrom` — and is
 * compared as one. `new Date()` is the seam where a server's timezone can get
 * in, and it gets in the same way every time: after 17:00 UTC the server is
 * already on tomorrow while the office is not, so a delegation window that
 * closed today reads as closed yesterday and a policy that takes effect
 * tomorrow starts tonight.
 *
 * It lived in lib/delegationQuery.js until PolicyVersion needed it too, and a
 * model may not import a module that imports models. That file still re-exports
 * it, so nothing that already imports `today` from there has to change.
 *
 * `en-CA` formats as YYYY-MM-DD, which is what every comparison expects.
 */
export const TIMEZONE = process.env.OT_TIMEZONE || 'Asia/Bangkok';

/**
 * ONE FORMATTER, BUILT ONCE — it used to be constructed inside the call.
 *
 * That was free while this answered "what day is it" a handful of times per
 * request. Since 2026-09-09 it is also called PER ROW in a render: the
 * ย้อนหลัง … วัน tag on คิวรออนุมัติ turns each request's filing stamp into
 * the office's date (`filingLead` in lib/entries.js), and that queue draws
 * every pending ใบ in the company — 230 of them on this database today, redrawn
 * on every keystroke in the ค้นหา box. Measured at 10.8 ms per render of 250
 * rows with the formatter built each time, and 0.6 ms with this one; building an
 * `Intl.DateTimeFormat` is most of the cost of using one.
 *
 * Safe to hoist because `TIMEZONE` is read from the environment at import and
 * `format()` keeps no state between calls — the same formatter cannot answer
 * two callers differently.
 */
const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function today(now = new Date()) {
  return FORMAT.format(now);
}
