import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';

export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate('department');
  if (!entry) return fail('ไม่พบรายการ', 404);

  const note = payload?.note;
  const from = entry.status;

  if (user.role === 'manager') {
    if (entry.status !== 'pending_mgr') return fail('รายการนี้ไม่ได้อยู่ในขั้นรอหัวหน้า', 409);
    if (String(entry.department._id) !== String(user.department?._id)) {
      return fail('อนุมัติได้เฉพาะรายการในแผนกของตน', 403);
    }
    entry.managerDecision = { by: user._id, at: new Date(), note };
    entry.status = 'pending_hr';
    entry.log(user, 'approve_mgr', note, from);
  } else {
    // §6: two steps are required. HR confirming a request the manager has not
    // seen would collapse the flow to one, so it is refused.
    if (entry.status !== 'pending_hr') {
      return fail('ต้องผ่านการอนุมัติจากหัวหน้าก่อน', 409);
    }
    entry.hrDecision = { by: user._id, at: new Date(), note };
    entry.status = 'approved';
    entry.log(user, 'approve_hr', note, from);
  }

  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
