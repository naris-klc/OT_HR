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

export function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
