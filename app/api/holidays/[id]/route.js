import Holiday from '@/src/models/Holiday.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { previousDay } from '@/lib/holidays.js';

export const DELETE = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');

  const holiday = await Holiday.findByIdAndDelete(params.id);
  if (!holiday) return fail('ไม่พบวันหยุด', 404);

  const recomputed = await recomputeEntries(
    { workDate: { $in: [holiday.date, previousDay(holiday.date)] } },
    user,
  );
  return json({ ok: true, recomputed });
});
