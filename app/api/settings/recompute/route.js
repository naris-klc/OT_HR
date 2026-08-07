import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';

/**
 * Manual replay — useful after a bulk holiday import or a data fix.
 *
 * Approved entries are not replayed unless `includeApproved` is asked for and a
 * `note` says why, the same rule the settings page follows. Passing
 * `status=approved` alone therefore reports them as skipped rather than
 * quietly restating signed-off hours; the response names every one it left,
 * so a caller expecting a number can see where it went.
 */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  const filter = {};
  if (payload?.period) filter.period = payload.period;
  if (payload?.status) filter.status = { $in: String(payload.status).split(',') };

  const includeApproved = Boolean(payload?.includeApproved);
  const note = payload?.note;
  if (includeApproved && !String(note || '').trim()) {
    return fail('การคำนวณใหม่ที่รวมรายการที่อนุมัติแล้ว กรุณาระบุเหตุผล', 400);
  }

  return json(await recomputeEntries(filter, user, { includeApproved, note }));
});
