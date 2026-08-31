/**
 * Reading the neighbours, so that lib/overlap.js never has to.
 *
 * The same split lib/periodStatusQuery.js makes beside lib/periodStatus.js: the
 * rule stays pure and exhaustively testable, and the one module that talks to
 * Mongo stays small enough to read in a sitting.
 */

import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import { addDays } from '@/src/lib/otEngine.js';
import { CAP_STATUSES } from './caps.js';
import {
  findOverlaps, findSameDate, overlapMessage, sameDateMessage,
} from './overlap.js';

/**
 * Enough of a stored entry to place its window and to name it in the refusal.
 *
 * Deliberately not `segments`: a clash is a question about the window the
 * employee typed, not about how the engine cut it up, and the two can disagree
 * — a session whose OT rounded away to nothing still occupied the clock.
 */
export const OVERLAP_SELECT = 'employee workDate startTime endTime endsNextDay status';

/**
 * ONE DAY EITHER SIDE, and the bound is provable rather than generous.
 *
 * `computeSession` refuses a session longer than 24 hours, so a stored entry
 * can reach at most one midnight past its own `workDate`, and the session being
 * filed can reach at most one midnight past its own. An entry that overlaps
 * ours therefore has a `workDate` no earlier than the day before ours and no
 * later than the day after it. Nothing outside that range can touch us, and
 * everything inside it is three days of one person's requests — a handful of
 * documents on the `{ employee, period, status }` index the monthly figures
 * have always used.
 *
 * Not narrowed by `period`: the window either side of the 1st and the 31st
 * crosses a month, and a query keyed on the month would go blind on exactly
 * the two days a shift is most likely to be filed against the wrong date.
 */
export async function neighbouringEntries(session, { employee, excludeId = null }) {
  const q = {
    employee,
    // Only the requests that are still alive. A refused or withdrawn one holds
    // no claim on the clock, exactly as it holds none on a ceiling — the list
    // is `CAP_STATUSES` rather than a second copy of it, so a status added to
    // the workflow later cannot count against a ceiling and be free here.
    status: { $in: [...CAP_STATUSES] },
    workDate: { $gte: addDays(session.workDate, -1), $lte: addDays(session.workDate, 1) },
  };
  if (excludeId) q._id = { $ne: excludeId };
  return OtEntry.find(q).select(OVERLAP_SELECT).lean();
}

/** Enough of a clashing row for a screen to draw it as a row. */
const brief = (entry, extra = {}) => ({
  id: String(entry._id),
  workDate: entry.workDate,
  startTime: entry.startTime,
  endTime: entry.endTime,
  endsNextDay: Boolean(entry.endsNextDay),
  status: entry.status,
  ...extra,
});

/**
 * "Is this person's day already spoken for, and if so, say no" — one call, in
 * every path that writes a session.
 *
 * BOTH RULES, IN THE ORDER THEY ARE WORTH HEARING, off ONE read. หนึ่งวัน
 * หนึ่งใบ first: it is the rule the paper imposes, the commoner mistake by far,
 * and the only one whose fix needs no arithmetic — open the entry that is
 * already on that date and change it. เวลาทับซ้อน second, for the pair the
 * date comparison cannot see: a session filed against yesterday that runs past
 * midnight into the hours being typed now.
 *
 * Never both at once. A same-date pair is nearly always an overlapping pair as
 * well, and answering with two sentences about one mistake is how somebody
 * concludes there are two things wrong with what they typed.
 *
 * Returns null when the write may go ahead, or a `{ status, error, conflict }`
 * ready for `fail()`. The shape and the contract were `refusePeriodLock`'s —
 * the two sat one after the other at the top of the same routes until ปิดงวด
 * was withdrawn on 2026-08-31 (lib/periodStatus.js). This is the last helper of
 * that shape, and the convention is worth keeping: a route-level check that
 * needs a database read returns a refusal or null, and the route returns it.
 *
 * 400 rather than 409. The ceiling and รูปแบบโอที answer 409 because the
 * request itself is right and the state of the department refuses it; this one
 * is a mistake in what was typed, which is what 400 is for, and the fix is in
 * the form the person is already looking at.
 *
 * `conflict` rides along beside the sentence so a screen can draw the rows
 * rather than only print the message — the same reason `fail(..., { cap })`
 * carries the ceiling it refused on. Its `kind` is what the screen reads to
 * decide which of the two things happened; the sentence itself is never
 * assembled twice.
 */
export async function refuseDayConflict(session, { employee, excludeId = null }) {
  const near = await neighbouringEntries(session, { employee, excludeId });

  const sameDay = findSameDate(session, near, { excludeId });
  if (sameDay.length) {
    return {
      status: 400,
      error: sameDateMessage(sameDay[0]),
      conflict: { kind: 'sameDate', entries: sameDay.map((e) => brief(e)) },
    };
  }

  const clashes = findOverlaps(session, near, { excludeId });
  if (!clashes.length) return null;

  return {
    status: 400,
    error: overlapMessage(clashes, { statusLabel: (s) => STATUS_LABEL_TH[s] || s }),
    conflict: {
      kind: 'overlap',
      entries: clashes.map((c) => brief(c.entry, { minutes: c.minutes })),
    },
  };
}
