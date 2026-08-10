import ApprovalDelegation from '@/src/models/ApprovalDelegation.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { idOf } from '@/lib/entries.js';
import { publicDelegation } from '@/lib/delegation.js';
import { today } from '@/lib/delegationQuery.js';

const PERSON = 'code name role department';

/**
 * ยกเลิกการมอบหมาย — end a window early, because the manager came back.
 *
 * A DELETE that deletes nothing. `revokedAt` is stamped and the row stays,
 * because entries approved under this delegation point back at it through
 * `history.delegationId`, and an audit trail whose evidence can be removed is
 * an audit trail that proves nothing. Everything already approved keeps the
 * status it was given — an approval is an event that happened, not a permission
 * re-evaluated on every read, and nothing anywhere recomputes one.
 *
 * This is not the on/off switch a delegation deliberately does not have. It
 * only ever closes a window early; there is no path that reopens one, and a new
 * window means a new record with its own dates and its own author.
 */
export const DELETE = route(async (req, { params }) => {
  const user = await requireAuth(req);

  const row = await ApprovalDelegation.findById(params.id);
  if (!row) return fail('ไม่พบการมอบหมาย', 404);

  // The same people who may create one: the manager whose queue it is, or
  // ฝ่ายบุคคล. Not the stand-in — handing the queue back is the granter's
  // decision, and a stand-in who wants out asks them.
  const isGranter = idOf(row.from) === idOf(user);
  if (!isGranter && !['hr', 'admin'].includes(user.role)) {
    return fail('ยกเลิกได้เฉพาะหัวหน้างานเจ้าของคิว หรือฝ่ายบุคคล', 403);
  }
  if (row.revokedAt) return fail('การมอบหมายนี้ถูกยกเลิกไปแล้ว', 409);

  row.revokedAt = new Date();
  row.revokedBy = user._id;
  row.revokedByName = user.name;
  await row.save();

  const saved = await ApprovalDelegation.findById(row._id)
    .populate('from', PERSON).populate('to', PERSON).lean();
  return json({ delegation: publicDelegation(saved, today()) });
});
