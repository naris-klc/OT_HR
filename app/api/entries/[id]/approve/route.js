import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE, DECIDE_POPULATE } from '@/lib/entries.js';
import { approvalPermission, approvalRecord, historyExtra } from '@/lib/delegation.js';
import { heldBy, today } from '@/lib/delegationQuery.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(DECIDE_POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

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
    /**
     * The note reaches the RULE, not just the record.
     *
     * ผู้ดูแลระบบ signing the หัวหน้า step of a department that has no หัวหน้า
     * is refused without a reason, and that refusal belongs beside the rule
     * that grants the exception rather than in a guard here — a route that
     * remembers to check is a route the next one beside it will forget to copy.
     * ไม่อนุมัติ needs no such wiring: it has always demanded a reason from
     * everybody. See `OVERRIDE_NOTE_REQUIRED`.
     */
    note,
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
