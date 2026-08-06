import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';

/** §7: HR and Admin can override a cap. */
export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id);
  if (!entry) return fail('ไม่พบรายการ', 404);

  entry.capOverride = {
    by: user._id,
    at: new Date(),
    reason: String(payload?.reason || '').trim() || 'อนุมัติเกินเพดานโดย HR',
  };
  entry.capExceeded = false;
  entry.log(user, 'edit', `cap override: ${entry.capOverride.reason}`, entry.status);
  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
