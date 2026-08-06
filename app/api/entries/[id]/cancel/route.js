import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';

/** §6: own request, while still pending_mgr. */
export const POST = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id);
  if (!entry) return fail('ไม่พบรายการ', 404);
  if (String(entry.employee) !== String(user._id)) {
    return fail('ยกเลิกได้เฉพาะรายการของตนเอง', 403);
  }
  if (entry.status !== 'pending_mgr') {
    return fail('ยกเลิกได้เฉพาะรายการที่ยังรอหัวหน้า', 409);
  }

  const from = entry.status;
  entry.status = 'cancelled';
  entry.log(user, 'cancel', payload?.note, from);
  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
