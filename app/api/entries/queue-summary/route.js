import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { resolveScope } from '@/lib/delegationQuery.js';
import { nobodyCanSign } from '@/lib/delegation.js';
import { DECIDE_POPULATE, approvalDepartments, entryCompany } from '@/lib/entries.js';
import { ROLES, SIGNER_ROLES, isSigner, mayApproveRole } from '@/lib/roles.js';

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const { scope, delegated: coveredScope, covered } = await resolveScope(user);

  /**
   * THE BADGE COUNTS WHAT THIS READER CAN SIGN, NOT WHAT IS IN THEIR แผนก.
   *
   * `scope` is departments and payroll — it says which rows they may SEE, and
   * since 2026-09-03 that is a wider set than the rows they may sign. แผนกผลิต2
   * holds four หัวหน้างาน and every one of them files their own OT now; without
   * this clause each of their badges counts the other three's requests, and the
   * number over รายการรออนุมัติ is a number of things they cannot do.
   *
   * The same complaint the queue's own header answered on 2026-08-28 — one
   * question answered two ways on one screen — so the badge and
   * `signableHere` are made to agree here rather than left to differ by a rule.
   *
   * A roster read, not a join: the entry stores a reference to its owner and
   * nothing about their บทบาท, deliberately (see `entryCompany`), so the roles
   * have to be read where they live. The roster is small and this is one
   * indexed query. ฝ่ายบุคคล and ผู้ดูแลระบบ skip it — they sign the second step
   * and their `pending_mgr` count is a count of what is waiting elsewhere.
   */
  let signable = null;
  if (isSigner(user.role)) {
    const roles = ROLES.filter((r) => mayApproveRole(user.role, r));
    const people = await Employee
      .find({ role: { $in: roles }, department: { $in: approvalDepartments(user) } })
      .select('_id').lean();
    signable = { employee: { $in: people.map((p) => p._id).filter((id) => String(id) !== String(user._id)) } };
  }

  /**
   * The badge counts what its reader can SIGN, which is the narrower of the two
   * ladders and therefore already inside what they may SEE — `mayApproveRole`
   * is one rung, `visibleRolesFor` is every rung below. So no second clause is
   * needed here, and adding one would be two rules where the queue screen has
   * one. See `visibleEmployeeClause` for the reading half.
   */

  const [
    pendingMgr, pendingHr, delegated, withdrawalOpen, withdrawalOpenPending,
  ] = await Promise.all([
    OtEntry.countDocuments({ ...scope, ...signable, status: 'pending_mgr' }),
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
     * ── คำขอถอนใบที่อนุมัติแล้ว — THE SECOND PILE ON THAT SCREEN ─────────────
     *
     * The card at the top of รออนุมัติ OT (and of รายการรออนุมัติ). It was on
     * the screen and in nobody's count until 2026-09-03: with no ใบ waiting, an
     * employee could ask for an approved entry to be withdrawn and the nav would
     * show no badge at all. Nothing anywhere said to go and look.
     *
     * It was the THIRD pile for a few hours on the same day. วันเกิดรอตรวจ was
     * the second and was counted here by running the queue loader itself — an
     * unanswered birthday being the absence of two documents rather than
     * anything a `countDocuments` could find. Both the queue and the loader were
     * withdrawn later that day; nothing replaced the count, because there is no
     * longer a pile to count.
     *
     * THE SAME FILTER THE CARD'S OWN LIST USES — `withdrawal=open` on
     * app/api/entries, which is `withdrawal.state: 'requested'` inside the
     * caller's ordinary scope. Written out again here rather than shared,
     * because it is two words; what must not drift is the SCOPE, and both read
     * `resolveScope`'s `scope`.
     */
    OtEntry.countDocuments({ ...scope, 'withdrawal.state': 'requested' }),
    /**
     * …AND HOW MANY OF THOSE `pendingHr` HAS ALREADY COUNTED.
     *
     * A request can be asked from the first signature onwards, so an open one
     * sits on an entry that is either `approved` or `pending_hr`
     * (`OPEN_STATUSES` in lib/withdrawal.js). The `pending_hr` ones are inside
     * the `pendingHr` figure above — the same entry, waiting for the same
     * person, on the same screen — so a badge that added the two piles whole
     * would count them twice, and would do it only sometimes, which is worse
     * than doing it always.
     *
     * Subtracted by the CLIENT rather than folded in here, because the answer
     * depends on which pile that reader's badge is built on: a หัวหน้า's is
     * `pendingMgr`, which no open request can ever be in, so for them there is
     * nothing to subtract. See `queueBadge` in components/App.jsx.
     */
    OtEntry.countDocuments({ ...scope, 'withdrawal.state': 'requested', status: 'pending_hr' }),
  ]);

  /**
   * ใบที่ไม่มีใครเซ็นได้ — the count behind รออนุมัติแทนหัวหน้า.
   *
   * ผู้ดูแลระบบ only, and skipped entirely for everybody else: it is the only
   * role that can act on such a row, and this costs a roster read plus a pass
   * over the pending list, which is not a price to pay on every poll for a
   * number nobody would be shown.
   *
   * Not a `countDocuments`, and it cannot be one: whether a row is stuck depends
   * on the roster and on the owner's payroll, not on anything stored on the
   * entry. So it runs the same predicate the LIST runs — a badge and the screen
   * it opens have to be one computation, and this one has the additional
   * property that a wrong badge would send an administrator looking for a
   * request that is not stuck.
   *
   * Not fatal: a badge is worth less than the numbers it sits next to.
   */
  let unsigned = 0;
  if (user.role === 'admin') {
    try {
      const [waiting, managers] = await Promise.all([
        OtEntry.find({ status: 'pending_mgr' }).populate(DECIDE_POPULATE).lean(),
        Employee.find({ role: { $in: SIGNER_ROLES }, active: true })
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
     * คำขอถอนใบ — every open one in scope, which is what the card at the top of
     * the screen lists, and how many of them `pendingHr` is already counting.
     *
     * Both, rather than one pre-subtracted number, so the caller can take the
     * overlap off the pile their own badge is built on — see the note beside
     * the queries and `queueBadge` in components/App.jsx.
     */
    withdrawalOpen,
    withdrawalOpenPendingHr: withdrawalOpenPending,
    /**
     * How many teams are being covered — which is what decides whether the
     * screen exists, not the count above it. A covered queue that happens to be
     * empty today is still a queue somebody is answerable for, and a tab that
     * appeared and vanished with the last row would be a tab nobody trusts.
     */
    delegatedTeams: covered.length,
  });
});
