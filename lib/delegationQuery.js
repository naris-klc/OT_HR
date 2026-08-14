/**
 * The database side of ผู้รับช่วงอนุมัติแทน — the reads, and the clock.
 *
 * Kept apart from lib/delegation.js for the reason lib/policyConfirmSave.js is
 * kept apart from lib/policyConfirmations.js: the rules there are pure and are
 * tested without mongoose or a connection, and a test file that reaches for a
 * model drags mongoose into a suite that never opens one and costs a third of a
 * second on its own. Everything in this file needs a database or a clock;
 * nothing in that one does.
 */
import ApprovalDelegation from '@/src/models/ApprovalDelegation.js';
import { DELEGATE_ROLES, delegatedDepartments, receivedOn } from './delegation.js';

/**
 * The company's calendar date, not the server's.
 *
 * `new Date().toISOString().slice(0, 10)` is UTC, and this office is UTC+7: for
 * the seven hours after midnight it would name yesterday. A delegation running
 * 5–12 August would then start late on the morning of the 5th and stay live
 * through the small hours of the 13th — a stand-in signing on a day nobody gave
 * them, which is the one failure this feature exists to prevent. Every other
 * date in this system is a wall-clock string for the same reason (see
 * `Holiday.date`, `Employee.birthDate`, `OtEntry.workDate`); this is the one
 * place one has to be produced rather than read.
 *
 * `en-CA` formats as YYYY-MM-DD, which is what every comparison here expects.
 */
/**
 * Both moved to lib/today.js when PolicyVersion came to need the same clock —
 * a model cannot import this file, which imports models. Re-exported here so
 * that every caller which already reaches for `today` from the delegation
 * module keeps working, and so the note above still sits where the rule it
 * describes is used.
 */
export { TIMEZONE, today } from './today.js';

/**
 * The delegations this person is holding today, with the granting manager
 * populated enough for `isDepartmentManager` to read.
 *
 * Narrowed in the query by date and by `to`, so a roster of any size costs one
 * indexed lookup; `receivedOn` then applies the same window rule a second time
 * over the results. That is not redundancy for its own sake — the query cannot
 * express `revokedAt: null` and the date window in a way that stays readable,
 * and the pure rule is the one that is tested.
 */
export async function heldBy(user, date = today()) {
  if (!user?._id) return [];
  // Nobody outside DELEGATE_ROLES can hold one, so the lookup is skipped for
  // them entirely — this runs on every approve and every reject.
  if (!DELEGATE_ROLES.includes(user.role)) return [];
  const rows = await ApprovalDelegation.find({
    to: user._id,
    fromDate: { $lte: date },
    toDate: { $gte: date },
    revokedAt: null,
  }).populate('from', 'code name role department').lean();
  return receivedOn(rows, user, date);
}

/**
 * The departments a stand-in currently covers — what `scopeFor` widens by.
 *
 * Empty for nearly every caller, and empty is the fast path: no delegation, no
 * extra departments, and the scope is exactly what it has always been.
 */
export async function coveredDepartments(user, date = today()) {
  return delegatedDepartments(await heldBy(user, date), user, date);
}
