import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE, DECIDE_POPULATE } from '@/lib/entries.js';
import { approvalPermission, approvalRecord, historyExtra } from '@/lib/delegation.js';
import { heldBy, today } from '@/lib/delegationQuery.js';
import { refusePeriodLock } from '@/lib/periodLockQuery.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(DECIDE_POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

  /**
   * A closed month cannot be signed either.
   *
   * This is the case `closeRefusal` exists to prevent rather than to handle: a
   * period is not allowed to close while anything in it is still pending, so a
   * request meeting this refusal means the month was closed and then something
   * arrived in it — which today can only happen if an administrator reopened
   * the month, somebody filed, and it was closed again over the top.
   */
  const locked = await refusePeriodLock(entry.period, 'อนุมัติ');
  if (locked) return fail(locked.error, locked.status);

  const note = payload?.note;
  const from = entry.status;

  /**
   * Who may sign this, at which step, and whose authority they are using.
   *
   * The ladder of role-and-status checks both this route and `reject` used to
   * carry a copy of now lives in lib/delegation.js, where it can be read and
   * tested on its own — and where the three answers it has to give (may they,
   * which step, on whose behalf) come out together rather than being inferred
   * from which branch happened to run.
   */
  const on = today();
  const may = approvalPermission({
    user,
    entry,
    delegations: await heldBy(user, on),
    today: on,
    verb: 'อนุมัติ',
  });
  if (!may.ok) return fail(may.error, may.status);

  if (may.stage === 'mgr') {
    entry.managerDecision = approvalRecord(user, may, { note });
    entry.status = 'pending_hr';
    entry.log(user, 'approve_mgr', note, from, null, historyExtra(may));
  } else {
    entry.hrDecision = approvalRecord(user, may, { note });
    entry.status = 'approved';
    entry.log(user, 'approve_hr', note, from, null, historyExtra(may));
  }

  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
