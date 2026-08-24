import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { resolveScope } from '@/lib/delegationQuery.js';
import { nobodyCanSign } from '@/lib/delegation.js';
import { DECIDE_POPULATE, entryCompany } from '@/lib/entries.js';
import { loadBirthdayQueue } from '@/lib/birthdayQueueQuery.js';

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const { scope, delegated: coveredScope, covered } = await resolveScope(user);
  const [pendingMgr, pendingHr, delegated, birthday] = await Promise.all([
    OtEntry.countDocuments({ ...scope, status: 'pending_mgr' }),
    OtEntry.countDocuments({ ...scope, status: 'pending_hr' }),
    /**
     * How much of that first number is somebody else's team.
     *
     * Counted rather than derived on the client, because the badge in the nav
     * is drawn from this and the rows are fetched separately — two numbers from
     * two lists is how a badge ends up disagreeing with the screen it opens.
     * Zero for everybody not standing in, which is nearly everybody, and the
     * query is skipped entirely for them.
     */
    coveredScope
      ? OtEntry.countDocuments({ ...coveredScope, status: 'pending_mgr' })
      : 0,
    /**
     * The second tab of the same screen.
     *
     * Not a `countDocuments` and it cannot be one: an unanswered birthday is the
     * absence of two different documents, decided against a roster, a calendar
     * and the live policy. So it runs the queue loader the tab itself runs —
     * `countOnly`, which skips the manager names and the answered list — because
     * a badge and the screen it opens must be one computation. Two would be one
     * refactor away from disagreeing, and the badge is the half nobody checks.
     *
     * Not fatal: a queue count that fails should cost a badge, not the two
     * numbers beside it.
     */
    loadBirthdayQueue(user, { countOnly: true })
      .then((q) => q.needsEntry.length)
      .catch(() => 0),
  ]);

  /**
   * ใบที่ไม่มีใครเซ็นได้ — the count behind รออนุมัติแทนหัวหน้า.
   *
   * ผู้ดูแลระบบ only, and skipped entirely for everybody else: it is the only
   * role that can act on such a row, and this costs a roster read plus a pass
   * over the pending list, which is not a price to pay on every poll for a
   * number nobody would be shown.
   *
   * Not a `countDocuments`, and it cannot be one for the reason วันเกิดรอตรวจ
   * above cannot: whether a row is stuck depends on the roster and on the
   * owner's payroll, not on anything stored on the entry. So it runs the same
   * predicate the LIST runs — a badge and the screen it opens have to be one
   * computation, and this one has the additional property that a wrong badge
   * would send an administrator looking for a request that is not stuck.
   *
   * Not fatal, like the birthday count beside it: a badge is worth less than
   * the two numbers it sits next to.
   */
  let unsigned = 0;
  if (user.role === 'admin') {
    try {
      const [waiting, managers] = await Promise.all([
        OtEntry.find({ status: 'pending_mgr' }).populate(DECIDE_POPULATE).lean(),
        Employee.find({ role: 'manager', active: true })
          .select('code name role department company approvesCompany approvesDepartments').lean(),
      ]);
      unsigned = waiting.filter((e) => nobodyCanSign(e, managers, entryCompany(e))).length;
    } catch { unsigned = 0; }
  }

  return json({
    pendingMgr,
    pendingHr,
    pendingMgrDelegated: delegated,
    /**
     * How many requests are waiting on a หัวหน้า that no หัวหน้า can sign.
     *
     * Zero for every role but ผู้ดูแลระบบ — see above. Unlike `delegatedTeams`
     * below, the tab this drives DOES vanish at zero, and deliberately: a
     * covered queue is a standing responsibility, and this is a fault. A fault
     * that has been repaired should stop being on screen.
     */
    unsignedPending: unsigned,
    /**
     * วันเกิดรอตรวจ — outstanding across ALL months, unlike everything else on
     * this route, which is the point of the queue. The nav adds it to the tab's
     * own number so the badge counts the whole screen; the screen shows the two
     * apart, because they are two different jobs.
     */
    birthdayPending: birthday,
    /**
     * How many teams are being covered — which is what decides whether the
     * screen exists, not the count above it. A covered queue that happens to be
     * empty today is still a queue somebody is answerable for, and a tab that
     * appeared and vanished with the last row would be a tab nobody trusts.
     */
    delegatedTeams: covered.length,
  });
});
