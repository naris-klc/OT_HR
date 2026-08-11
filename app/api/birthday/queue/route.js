import { route, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { loadBirthdayQueue } from '@/lib/birthdayQueueQuery.js';

/**
 * วันเกิดรอตรวจ — the queue, and NOT a report.
 *
 * NO `period` PARAMETER, deliberately, and this route exists chiefly to make
 * that structural. The list it replaces sat at the foot of ตรวจสอบรายเดือน and
 * followed that screen's month picker, so a birthday overlooked in August
 * vanished the moment somebody looked at September — the rows that had been
 * waiting longest were the ones hardest to see. A queue that can be scoped to a
 * month is a queue that can be emptied by changing a dropdown.
 *
 * The window it does have is a floor, not a filter: `queueWindow` in
 * lib/birthdayQueueQuery.js reaches back to the month the birthday rule was
 * first recorded as on (capped at BACKLOG_MONTHS), and returns which of the two
 * bounds applied so the screen can print it. A queue that silently drops its own
 * tail reads as "you are up to date".
 *
 * READ-ONLY. The two ways to answer a row are the POST routes beside this one.
 *
 * The month-scoped question — "is THIS month finished, for closing" — is a
 * different question with a different answer and keeps its own route,
 * `GET /api/reports/birthday-check/[period]`. Two routes, one scope each; a
 * single route with an optional parameter would make the two counts one branch
 * apart, and they are supposed to differ.
 */
export const GET = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  return json(await loadBirthdayQueue(user));
});
