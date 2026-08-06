import { route, body, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';

/** Manual replay — useful after a bulk holiday import or a data fix. */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  const filter = {};
  if (payload?.period) filter.period = payload.period;
  if (payload?.status) filter.status = { $in: String(payload.status).split(',') };
  return json(await recomputeEntries(filter, user));
});
