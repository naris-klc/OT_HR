import OtEntry from '@/src/models/OtEntry.js';
import Setting from '@/src/models/Setting.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';
import { approvalPermission, approvalRecord, historyExtra } from '@/lib/delegation.js';
import { heldBy, today } from '@/lib/delegationQuery.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate('department');
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
  });
  if (!may.ok) return fail(may.error, may.status);

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
