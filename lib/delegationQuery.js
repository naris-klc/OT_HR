/**
 * The database side of ผู้รับช่วงอนุมัติแทน — the reads, and the clock.
 *
 * Kept apart from lib/delegation.js for the reason lib/policySave.js is kept
 * apart from lib/policy rules: the rules there are pure and are
 * tested without mongoose or a connection, and a test file that reaches for a
 * model drags mongoose into a suite that never opens one and costs a third of a
 * second on its own. Everything in this file needs a database or a clock;
 * nothing in that one does.
 */
import ApprovalDelegation from '@/src/models/ApprovalDelegation.js';
import Employee from '@/src/models/Employee.js';
import { isSigner, seesEveryRole, visibleRolesFor } from '@/lib/roles.js';
import { companyOf } from '@/src/config/companies.js';
import {
  DELEGATE_ROLES, delegatedClaims, delegatedDepartments, receivedOn, scopeWidening,
} from './delegation.js';
import { claimFilter, ownClaims, scopeFor } from './entries.js';

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
 *
 * IMPORTED AND THEN EXPORTED, never `export { today } from './today.js'`.
 *
 * The one-line form re-exports without binding the name in this module, so the
 * `date = today()` defaults below become a ReferenceError the moment anybody
 * calls them without a date — which `coveredDepartments(user)` in
 * app/api/entries does on every single list request. `next dev` rewrites the
 * short form into an import and the bug never appears; `next build` does not,
 * and the entries list answers 500 for every role in a production build while
 * every test passes and the development server is fine.
 */
import { TIMEZONE, today } from './today.js';

export { TIMEZONE, today };

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
    // `approvesCompany` is part of the authority being borrowed — see
    // `delegatedClaims`. Without it every claim a stand-in holds would read as
    // ทุกบริษัท, which is the widest possible answer arrived at by omission.
  }).populate('from', 'code name role department approvesCompany').lean();
  return receivedOn(rows, user, date);
}

/**
 * The departments a stand-in currently covers — the ids, for the screens that
 * ask which TEAMS rather than which rows.
 *
 * Empty for nearly every caller, and empty is the fast path: no delegation, no
 * extra departments, and the scope is exactly what it has always been.
 */
export async function coveredDepartments(user, date = today()) {
  return delegatedDepartments(await heldBy(user, date), user, date);
}

/**
 * WHO EACH PAYROLL PAYS, as sets of employee ids — the one thing a
 * company-scoped claim cannot express as a clause on an entry.
 *
 * Resolved in JavaScript through `companyOf` and NOT as `{ company: key }` in
 * the query, for the reason lib/accounting.js partitions the same way: a row
 * whose `company` was never filled in is still on a payroll — the code prefix
 * says which — and a mongo filter cannot see that. Filtering in the database
 * would drop those people out of their own หัวหน้า's queue with nothing saying
 * so, which is the same class of silent narrowing this whole field exists to
 * make visible.
 *
 * Returns null when no claim is scoped, which is the state of every roster until
 * somebody narrows a หัวหน้า — so the ordinary request costs no extra query at
 * all. Deactivated people are INCLUDED: their pending requests do not vanish
 * when their account is switched off, and a queue that hid them would hide work
 * somebody still has to finish.
 *
 * One read of a roster this size (§9: 5–6 people per department) per request
 * that needs it. A roster of thousands would want an index on `company` and the
 * partition moved into the query, and would then have to answer the unset-field
 * problem above some other way.
 */
export async function companyRosters(claims = []) {
  const wanted = [...new Set(claims.filter((c) => c?.company).map((c) => c.company))];
  if (!wanted.length) return null;

  const people = await Employee.find().select('code company').lean();
  const byCompany = new Map(wanted.map((key) => [key, []]));
  for (const person of people) {
    const list = byCompany.get(companyOf(person));
    if (list) list.push(person._id);
  }
  return byCompany;
}

/**
 * EVERYTHING THE ENTRY ROUTES NEED TO KNOW ABOUT WHOSE ROWS THESE ARE, from one
 * read of the delegations.
 *
 * Four routes used to call `heldBy` → `scopeWidening` → `scopeFor` in the same
 * order and assemble the same three answers by hand. They are one call now
 * because a company-scoped claim added a fourth step — the roster sets — and
 * four steps repeated four times is four places for the queue and the approve
 * button to start disagreeing.
 *
 * `scope` is what this person may see, `delegated` is the covered teams ONLY
 * (the ฝ่ายบุคคล stand-in queue, whose own scope is everything and cannot be
 * widened), `covered` is those teams as ids for the chips and the count, and
 * `own` is this person's own reach with nothing borrowed added to it.
 *
 * `own` exists for one caller — the trail — which has never widened by
 * delegation. That was free to be written as `scopeFor(user)` while the answer
 * needed nothing from the database; a company-scoped claim needs the roster
 * sets, so the un-widened question has to be asked here too rather than being
 * assembled from a bare call that would now throw.
 */
/**
 * THE VISIBILITY LADDER AS A MONGO CLAUSE — which people's requests this reader
 * may see at all, on top of whichever แผนก scope already applies.
 *
 * `visibleRolesFor` is the rule and it is pure; this is the read it needs. An
 * entry stores a reference to its owner and nothing about their บทบาท —
 * deliberately, see `entryCompany` — so the roles have to be looked up where
 * they live, and the answer comes back as the ids.
 *
 * THEIR OWN ROW IS ALWAYS IN IT. The ladder is about other people: nobody below
 * ฝ่ายบุคคล reads their own บทบาท's requests, and without this a หัวหน้างาน's
 * own pending request would vanish from the แผนก list it sits in. Ownership is
 * identity, not บทบาท.
 *
 * `null` means NO NARROWING — ฝ่ายบุคคล and ผู้ดูแลระบบ read every บทบาท, and
 * a clause listing every employee in the company would be the same answer at
 * the cost of a query and a very long `$in`.
 *
 * Returned as a clause for `$and` rather than as `q.employee`, because the
 * list route also accepts `?employee=` and a second write to the same key
 * would silently REPLACE this one — which is a reader asking for a row above
 * them and being handed it.
 */
export async function visibleEmployeeClause(user) {
  if (seesEveryRole(user?.role)) return null;
  if (!isSigner(user?.role)) return { employee: user?._id };

  const roles = visibleRolesFor(user.role);
  const people = roles.length
    ? await Employee.find({ role: { $in: roles } }).select('_id').lean()
    : [];
  return { employee: { $in: [...people.map((p) => p._id), user._id] } };
}

export async function resolveScope(user, date = today()) {
  const held = await heldBy(user, date);
  const claims = delegatedClaims(held, user, date);
  const widened = scopeWidening(user, claims);
  const rosters = await companyRosters([...ownClaims(user), ...claims]);
  return {
    scope: scopeFor(user, widened, rosters),
    own: scopeFor(user, [], rosters),
    delegated: claimFilter(claims, rosters),
    covered: claims.map((c) => c.department),
  };
}
