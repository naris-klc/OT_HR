import Holiday from '@/src/models/Holiday.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';

export const DELETE = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');

  const holiday = await Holiday.findByIdAndDelete(params.id);
  if (!holiday) return fail('ไม่พบวันหยุด', 404);

  const recomputed = await recomputeEntries(
    // The day itself — see the note in ../route.js. Nothing spills backwards
    // into the evening before since ข้ามคืน was removed on 2026-09-10.
    { workDate: holiday.date },
    user,
  );
  return json({ ok: true, recomputed });
});
