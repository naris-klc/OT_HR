import { route, query, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { EVENT_LABEL } from '@/lib/complianceExport.js';
import { kindsFrom, loadCompliance, windowFrom } from '@/lib/complianceQuery.js';

/**
 * รายงานการใช้สิทธิ์พิเศษ — the same six events the CSV holds, for the screen.
 *
 * Under `/api/logs/` rather than `/api/reports/`, because the audience decides
 * where a route lives: everything under `logs` is ผู้ดูแลระบบ-only and is read
 * as evidence, and everything under `reports` is a month's figures for HR and
 * managers. This is the first kind.
 *
 * ONE LOADER, SHARED WITH THE CSV — `lib/complianceQuery.js`. The screen and the
 * file must never report different quarters; an auditor comparing a download
 * against the page it came from and finding two row counts has lost the reason
 * to trust either.
 *
 * UNCAPPED, unlike the traffic log beside it, and that is a property of the
 * data rather than an oversight: this list is the exceptions, there are six
 * kinds of them, and a quarter that produced more than a screenful is itself
 * the finding. A "ดูเพิ่ม" button here would let the interesting rows sit below
 * a fold — the exact failure `MAX_ROWS` in the loader is the only guard
 * against, and it sits far above any real period.
 *
 * `counts` is computed here rather than on the client so the badge and the list
 * are one read. Two numbers from two requests is how a count comes to disagree
 * with the rows under it.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');

  const q = query(req);
  const rows = await loadCompliance(windowFrom(q), kindsFrom(q.kinds));

  const counts = {};
  for (const kind of Object.keys(EVENT_LABEL)) counts[kind] = 0;
  for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1;

  return json({
    rows,
    counts,
    total: rows.length,
    /**
     * How many rows carry no เหตุผล.
     *
     * Surfaced as its own number because it is a FINDING and not a formatting
     * problem: four of the six kinds cannot be performed without a reason —
     * the rules refuse them — so a non-zero count here means either records
     * written before those rules existed, or the two kinds that never required
     * one. Either way it is the first thing somebody auditing the audit should
     * be told, rather than something they notice by scanning a column.
     */
    withoutReason: rows.filter((r) => !r.reason).length,
    labels: EVENT_LABEL,
  });
});
