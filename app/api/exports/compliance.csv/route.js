import { route, query, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { toCsv } from '@/src/lib/csv.js';
import { COMPLIANCE_HEADERS, complianceCells } from '@/lib/complianceExport.js';
import { kindsFrom, loadCompliance, windowFrom } from '@/lib/complianceQuery.js';

/**
 * รายงานการใช้สิทธิ์พิเศษ (CSV) — the compliance file.
 *
 * Three files, one rule. `lib/complianceExport.js` decides which six events
 * count as the exercise of a privileged exception and why those six;
 * `lib/complianceQuery.js` does the reads; this turns the result into a
 * spreadsheet. The screen (`app/api/logs/compliance`) calls the same loader, so
 * a downloaded file and the screen it came from cannot report different
 * quarters — which would defeat the whole point of having the file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ผู้ดูแลระบบ ONLY, and for the reason บันทึกระบบ is: this names who reset whose
 * password and who signed what in place of a หัวหน้า. ฝ่ายบุคคล appear IN it —
 * every password they issue is a row — and the ฝ่ายบุคคล login is shared by the
 * whole department, so a copy they could take of the list of their own
 * exceptional acts is not evidence about a person.
 *
 * NOTHING TO NARROW BY PERSON, deliberately, unlike the traffic export next
 * door. The point of this file is that it is COMPLETE for a period: an auditor
 * asking "what did PM-0620 do" is asking a question the file answers by being
 * read, and a `?actor=` returning a subset is a subset somebody later remembers
 * as the whole.
 *
 * Like every other request, taking this copy is itself a row in `otAccessLogs`.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');

  const q = query(req);
  const rows = await loadCompliance(windowFrom(q), kindsFrom(q.kinds));
  const body = toCsv(COMPLIANCE_HEADERS, rows.map(complianceCells));

  /**
   * The dates in the name, in digits, for the reason the บันทึกระบบ export puts
   * them there: `csvResponse` builds an ASCII fallback for the header, and a
   * stamp of Thai words comes out of that as underscores and identifies
   * nothing.
   */
  const stamp = `${q.from || 'start'}_${q.to || 'latest'}`;
  return csvResponse(`การใช้สิทธิ์พิเศษ_${stamp}.csv`, body);
});
