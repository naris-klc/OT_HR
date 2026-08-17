import ApprovalDelegation from '@/src/models/ApprovalDelegation.js';
import Employee from '@/src/models/Employee.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { delegationPermission, publicDelegation } from '@/lib/delegation.js';
import { today } from '@/lib/delegationQuery.js';

// `approvesCompany` because `publicDelegation` reports it: a card that says
// "แผนกวิศวกรรม" about a queue narrowed to one payroll is telling the reader
// something wider than what was handed over.
const PERSON = 'code name role department approvesCompany';

/**
 * The delegations this person may see.
 *
 * A manager sees the two sides of their own situation — who is covering them,
 * and whose queue they are holding. ฝ่ายบุคคล and Admin may ask for all of
 * them, because they are the ones who set one up for a manager who cannot.
 */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const q = query(req);
  const on = today();

  const filter = ['hr', 'admin'].includes(user.role) && q.all
    ? {}
    : { $or: [{ from: user._id }, { to: user._id }] };

  const rows = await ApprovalDelegation.find(filter)
    .populate('from', PERSON)
    .populate('to', PERSON)
    .sort({ fromDate: -1 })
    .lean();

  const all = rows.map((row) => publicDelegation(row, on));
  return json({
    delegations: all,
    /** Split out because the two answer different questions on the same screen. */
    holding: all.filter((d) => d.state === 'active' && d.to?.id === String(user._id)),
    coveredBy: all.filter((d) => d.state === 'active' && d.from?.id === String(user._id)),
    today: on,
  });
});

export const POST = route(async (req) => {
  const actor = await requireAuth(req);
  const payload = await body(req);

  // Left unstated, the queue being covered is the caller's own. A manager
  // setting up their own stand-in should not have to name themselves, and
  // ฝ่ายบุคคล doing it for somebody says whose.
  const fromId = payload.from || actor._id;
  const [from, to] = await Promise.all([
    Employee.findById(fromId).select(PERSON).lean(),
    payload.to ? Employee.findById(payload.to).select(PERSON).lean() : null,
  ]);

  const window = {
    fromDate: String(payload.fromDate || '').slice(0, 10),
    toDate: String(payload.toDate || '').slice(0, 10),
  };

  /**
   * Every delegation touching either person, handed to the pure rule whole.
   *
   * Narrowed by person and not by date: the overlap test belongs to the rule,
   * where it is written once and tested, and a query that pre-filtered by date
   * would be a second copy of it in a place no test can reach. Revoked rows
   * come along for the same reason — what a revoked row means is the rule's
   * decision, not the query's.
   */
  const touching = from && to
    ? await ApprovalDelegation.find({
      $or: [
        { from: from._id }, { to: from._id },
        { from: to._id }, { to: to._id },
      ],
    }).select('from to fromDate toDate revokedAt').lean()
    : [];

  const may = delegationPermission({ actor, from, to, window, existing: touching });
  if (!may.ok) return fail(may.error, may.status);

  const created = await ApprovalDelegation.create({
    from: from._id,
    to: to._id,
    ...window,
    reason: String(payload.reason || '').trim() || undefined,
    createdBy: actor._id,
    createdByName: actor.name,
  });

  const row = await ApprovalDelegation.findById(created._id)
    .populate('from', PERSON).populate('to', PERSON).lean();
  return json({ delegation: publicDelegation(row, today()) }, 201);
});
