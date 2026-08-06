import OtEntry from '@/src/models/OtEntry.js';
import Setting from '@/src/models/Setting.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate('department');
  if (!entry) return fail('ไม่พบรายการ', 404);

  const reason = String(payload?.reason || '').trim();
  if (!reason) return fail('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400);

  const policy = await Setting.effectivePolicy();
  const from = entry.status;

  if (user.role === 'manager') {
    if (entry.status !== 'pending_mgr') return fail('รายการนี้ไม่ได้อยู่ในขั้นรอหัวหน้า', 409);
    if (String(entry.department._id) !== String(user.department?._id)) {
      return fail('ดำเนินการได้เฉพาะรายการในแผนกของตน', 403);
    }
    entry.managerDecision = { by: user._id, at: new Date(), note: reason };
    entry.status = 'rejected';
    entry.rejectionReason = reason;
    entry.log(user, 'reject_mgr', reason, from);
  } else {
    // [OPEN 7] Can HR reject what the manager already approved, and where does
    // it land? Both halves are policy flags.
    if (!policy.hrMayReject) {
      return fail('ตามนโยบายปัจจุบัน HR ไม่สามารถปฏิเสธรายการที่หัวหน้าอนุมัติแล้ว', 403);
    }
    if (entry.status !== 'pending_hr') return fail('รายการนี้ไม่ได้อยู่ในขั้นรอ HR', 409);

    entry.hrDecision = { by: user._id, at: new Date(), note: reason };
    if (policy.hrRejectReturnsTo === 'manager') {
      entry.status = 'pending_mgr';
    } else {
      entry.status = 'rejected';
      entry.rejectionReason = reason;
    }
    entry.log(user, 'reject_hr', reason, from);
  }

  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
