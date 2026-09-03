import OtEntry from '@/src/models/OtEntry.js';
import { SIGNER_ROLES } from '@/lib/roles.js';
import Setting from '@/src/models/Setting.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE, DECIDE_POPULATE } from '@/lib/entries.js';
import { approvalPermission, approvalRecord, historyExtra } from '@/lib/delegation.js';
import { heldBy, today } from '@/lib/delegationQuery.js';
import { needsOverCeilingReason, overCeilingRefusal } from '@/lib/caps.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), ...SIGNER_ROLES, 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(DECIDE_POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

  const reason = String(payload?.reason || '').trim();
  if (!reason) return fail('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400);

  const policy = await Setting.effectivePolicy();
  const from = entry.status;

  // The same rule approving goes through — refusing is the other half of the
  // same decision and is made by exactly the same people at exactly the same
  // moments. Only the word in the refusal message differs.
  const on = today();
  const may = approvalPermission({
    user,
    entry,
    delegations: await heldBy(user, on),
    today: on,
    verb: 'ดำเนินการ',
    // Already required of everybody, and refused above if it is empty — so the
    // administrator override's own reason requirement is satisfied by the rule
    // this route has always had, and passing it keeps the two paths identical.
    note: reason,
  });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * The same rule `approve` applies, and it can never fire here.
   *
   * ไม่อนุมัติ has refused an empty reason since it existed — twenty lines
   * above, before any of this runs — so `reason` is non-empty by the time the
   * ceiling rule sees it and this returns ok every time. It is here anyway,
   * because "the check is unnecessary in this route" is a fact about today's
   * code that nothing would notice going stale: relax the reason requirement
   * on refusals for any reason at all and the over-ceiling case must keep it.
   * Costing one call to say so is cheaper than finding out later.
   */
  const over = overCeilingRefusal(entry, reason);
  if (!over.ok) return fail(over.error, over.status);

  // Whichever way the decision went, the sheet gets the sentence — see the
  // longer note in the approve route. A refusal's reason is already required
  // and already in `rejectionReason`; this is the copy สรุป OT ส่งบัญชี reads,
  // and it exists on refused rows because HR asked to see why a person's month
  // is short as well as why it is long.
  if (needsOverCeilingReason(entry)) entry.overCeilingReason = reason;

  if (may.stage === 'mgr') {
    entry.managerDecision = approvalRecord(user, may, { note: reason });
    entry.status = 'rejected';
    entry.rejectionReason = reason;
    entry.log(user, 'reject_mgr', reason, from, null, historyExtra(may));
  } else {
    // [OPEN 7] Can HR reject what the manager already approved, and where does
    // it land? Both halves are policy flags.
    if (!policy.hrMayReject) {
      return fail('ตามนโยบายปัจจุบัน HR ไม่สามารถปฏิเสธรายการที่หัวหน้าอนุมัติแล้ว', 403);
    }

    entry.hrDecision = approvalRecord(user, may, { note: reason });
    if (policy.hrRejectReturnsTo === 'manager') {
      entry.status = 'pending_mgr';
    } else {
      entry.status = 'rejected';
      entry.rejectionReason = reason;
    }
    entry.log(user, 'reject_hr', reason, from, null, historyExtra(may));
  }

  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
