import OtEntry from '@/src/models/OtEntry.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { scopeFor } from '@/lib/entries.js';

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const scope = scopeFor(user);
  const [pendingMgr, pendingHr] = await Promise.all([
    OtEntry.countDocuments({ ...scope, status: 'pending_mgr' }),
    OtEntry.countDocuments({ ...scope, status: 'pending_hr' }),
  ]);
  return json({ pendingMgr, pendingHr });
});
