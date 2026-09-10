import OtEntry from '@/src/models/OtEntry.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { resolveScope } from '@/lib/delegationQuery.js';

/** A request that re-files a request that re-files… stops somewhere. */
const MAX_DEPTH = 20;

/**
 * The whole story behind one request, oldest filing first.
 *
 * A refusal ends a request; the employee files a new one. Each document keeps
 * its own history, which is correct — they are different requests and the
 * hours on the refused one must never be counted again. But the manager
 * looking at the newest one is being asked to decide something they have
 * already seen once, and the reason they gave last time is sitting in a
 * document this screen never loads.
 *
 * This walks `refiledFrom` up the chain and hands back one link per request,
 * each with its own history intact. Nothing is merged or copied server-side:
 * the events stay attached to the request they happened to, and the client
 * decides how to lay them out. Copying a parent's log into its child would
 * make the same event exist twice, and then only one of the copies would be
 * corrected the next time somebody fixed something.
 */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  // Their own reach, not widened by anything they are standing in for — which
  // is what this endpoint has always done.
  const { own: scope } = await resolveScope(user);

  const head = await OtEntry.findOne({ _id: params.id, ...scope })
    .populate({ path: 'employee', select: 'code name' })
    .lean();
  if (!head) return fail('ไม่พบรายการ', 404);

  const chain = [head];
  const seen = new Set([String(head._id)]);

  let truncated = false;
  let cursor = head.refiledFrom;
  while (cursor) {
    if (chain.length >= MAX_DEPTH) { truncated = true; break; }
    const key = String(cursor);
    // A cycle cannot be written through the API, but a cycle read in a loop
    // hangs the request rather than returning a short answer.
    if (seen.has(key)) break;
    seen.add(key);

    // Scoped like the head: a manager who has moved departments must not read
    // an ancestry they would be refused if they asked for it directly.
    const parent = await OtEntry.findOne({ _id: cursor, ...scope })
      .select('workDate startTime endTime noBreakTaken description '
        + 'status rejectionReason buckets totals history createdAt refiledFrom')
      .lean();
    if (!parent) break; // out of scope or deleted — the trail simply stops here

    chain.push(parent);
    cursor = parent.refiledFrom;
  }

  // Oldest first: the trail reads forwards in time, the way it happened.
  chain.reverse();

  return json({
    /** True only when the walk stopped at the cap rather than at the origin. */
    truncated,
    requests: chain.map((e, i) => ({
      _id: e._id,
      seq: i + 1,
      isCurrent: String(e._id) === String(head._id),
      workDate: e.workDate,
      startTime: e.startTime,
      endTime: e.endTime,
      noBreakTaken: Boolean(e.noBreakTaken),
      description: e.description,
      status: e.status,
      rejectionReason: e.rejectionReason || null,
      // Shaped the way an entry is, so editsOf() can pair each snapshot with
      // the values it produced without a second code path.
      totals: { otHours: e.totals?.otHours ?? 0 },
      history: e.history || [],
    })),
  });
});
