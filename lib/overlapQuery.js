/**
 * Reading the neighbours, so that lib/overlap.js never has to.
 *
 * The same split lib/periodLockQuery.js makes beside lib/periodLock.js: the
 * rule stays pure and exhaustively testable, and the one module that talks to
 * Mongo stays small enough to read in a sitting.
 */

import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import { addDays } from '@/src/lib/otEngine.js';
import { CAP_STATUSES } from './caps.js';
import { findOverlaps, overlapMessage } from './overlap.js';

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

/**
 * "Do these times clash with anything, and if so, say no" — one call, in every
 * path that writes a session.
 *
 * Returns null when the write may go ahead, or a `{ status, error, overlaps }`
 * ready for `fail()`. The shape and the contract are `refusePeriodLock`'s,
 * deliberately: the two are read one after the other at the top of the same
 * routes, and a reader should not have to hold two conventions.
 *
 * 400 rather than 409. The ceiling and รูปแบบโอที answer 409 because the
 * request itself is right and the state of the department refuses it; this one
 * is a mistake in the times that were typed, which is what 400 is for, and the
 * fix is in the form the person is already looking at.
 *
 * `overlaps` rides along beside the sentence so a screen can highlight the rows
 * rather than only print the message — the same reason `fail(..., { cap })`
 * carries the ceiling it refused on.
 */
export async function refuseOverlap(session, { employee, excludeId = null }) {
  const near = await neighbouringEntries(session, { employee, excludeId });
  const clashes = findOverlaps(session, near, { excludeId });
  if (!clashes.length) return null;

  return {
    status: 400,
    error: overlapMessage(clashes, { statusLabel: (s) => STATUS_LABEL_TH[s] || s }),
    overlaps: clashes.map((c) => ({
      id: String(c.entry._id),
      workDate: c.entry.workDate,
      startTime: c.entry.startTime,
      endTime: c.entry.endTime,
      endsNextDay: Boolean(c.entry.endsNextDay),
      status: c.entry.status,
      minutes: c.minutes,
    })),
  };
}
