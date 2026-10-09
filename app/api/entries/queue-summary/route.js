import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { resolveScope } from '@/lib/delegationQuery.js';
import { signerPool, routeUnsignableToHr } from '@/lib/unsignableRepair.js';
import { DECIDE_POPULATE, approvalDepartments } from '@/lib/entries.js';
import { ROLES, isSigner, mayApproveRole } from '@/lib/roles.js';

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const {
    scope, delegated: coveredScope, covered, personal,
  } = await resolveScope(user);

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
    // ผู้อนุมัติรายคน: the people named for this reader are signable whatever
    // their บทบาท, and people named for somebody else are not, whatever their
    // แผนก — the same two edits `withPersonal` makes to the scope.
    const elsewhere = new Set(personal.named.map(String));
    const own = personal.own.map(String);
    const ids = [
      ...people.map((p) => String(p._id)).filter((id) => !elsewhere.has(id)),
      ...own,
    ].filter((id) => id !== String(user._id));
    signable = { employee: { $in: ids } };
  }

  /**
   * The badge counts what its reader can SIGN, which is the narrower of the two
   * ladders and therefore already inside what they may SEE — `mayApproveRole`
   * is one rung, `visibleRolesFor` is every rung below. So no second clause is
   * needed here, and adding one would be two rules where the queue screen has
   * one. See `visibleEmployeeClause` for the reading half.
   */

  let [
    pendingMgr, pendingHr, delegated,
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
     * ── คำขอถอนใบที่อนุมัติแล้ว WAS THE SECOND PILE, UNTIL 2026-09-18 ────────
     *
     * Two counts stood here: every open request in scope, and how many of them
     * `pendingHr` was already counting — both, rather than one pre-subtracted
     * number, so the client could take the overlap off whichever pile its own
     * badge was built on.
     *
     * **There is no pile.** ถอนใบ is the employee's own press and the row is
     * `cancelled` before the response returns, so nothing accumulates and there
     * is nothing for a badge to send anybody to look at. The subtraction in
     * `queueBadge` (components/App.jsx) went with them, and so did the
     * คำขอถอนใบ tab those rows were listed on.
     *
     * It was the THIRD pile for a few hours on 2026-09-03. วันเกิดรอตรวจ was
     * the second and was counted here by running the queue loader itself — an
     * unanswered birthday being the absence of two documents rather than
     * anything a `countDocuments` could find. Both the queue and the loader
     * were withdrawn later that day, and nothing replaced that count either.
     */
  ]);

  /**
   * ── ใบที่ไม่มีใครเซ็นได้ WAS COUNTED HERE UNTIL 2026-09-18 ────────────────
   *
   * `unsignedPending` drove the ผู้ดูแลระบบ-only tab ไม่มีหัวหน้าเซ็น, which
   * appeared when it was above zero and vanished when the fault was repaired.
   *
   * **The fault repairs itself now.** A ใบ waiting at a first step nobody can
   * sign is moved up to the ฝ่ายบุคคล step the next time either this summary or
   * the queue itself is read (`routeUnsignableToHr`), so there is no standing
   * population to count and no tab to send anybody to — the row is in รออนุมัติ
   * OT wearing the green ป้าย, which is where HR asked for it to be.
   *
   * ── AND THE REPAIR RUNS HERE, NOT ONLY ON THE QUEUE ──────────────────────
   *
   * Because the badge and the screen have to agree: a row still sitting at
   * `pending_mgr` is outside `pendingHr` and outside `signable` alike, so the
   * number beside ฝ่ายบุคคล's tab would say 47 while the queue they open shows
   * 48 rows they can press. This poll is also the thing that notices on the day
   * a หัวหน้า is deactivated, without anybody opening anything.
   *
   * ฝ่ายบุคคล AND ผู้ดูแลระบบ, where the old count was ผู้ดูแลระบบ only: the
   * rows land on ฝ่ายบุคคล's desk now, so their badge is the one that would be
   * wrong. It costs one populated read of the `pending_mgr` pile plus a roster
   * read, and only while such a pile exists.
   */
  if (['hr', 'admin'].includes(user.role)) {
    try {
      const [waiting, signers] = await Promise.all([
        OtEntry.find({ status: 'pending_mgr' }).populate(DECIDE_POPULATE).lean(),
        signerPool(),
      ]);
      const moved = await routeUnsignableToHr(waiting, signers);
      if (moved.size) pendingHr += moved.size;
    } catch {
      // A repair that cannot run must not take the badge down with it: the
      // numbers beside it are ordinary counts and are still right.
    }
  }

  return json({
    pendingMgr,
    pendingHr,
    pendingMgrDelegated: delegated,
    /**
     * How many teams are being covered — which is what decides whether the
     * screen exists, not the count above it. A covered queue that happens to be
     * empty today is still a queue somebody is answerable for, and a tab that
     * appeared and vanished with the last row would be a tab nobody trusts.
     */
    delegatedTeams: covered.length,
  });
});
