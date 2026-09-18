/**
 * ถอนใบที่อนุมัติแล้ว — the way back out of a request somebody has signed.
 *
 * The line `cancelPermission` draws is the first signature: before it the
 * request is the employee's to cancel outright, after it this file takes over.
 * That line is right and this file does not move it. What it replaces is the
 * sentence on the other side of it — `'หัวหน้าอนุมัติแล้ว ยกเลิกเองไม่ได้ —
 * ติดต่อฝ่ายบุคคล'` — which sent the rest of the story outside the system.
 *
 * What happened out there was ฝ่ายบุคคล editing or cancelling the row on the
 * employee's say-so, and what the trail recorded was ฝ่ายบุคคลแก้ไขข้อมูล. Who
 * asked, when they asked and why are all real facts about that entry, and none
 * of them was written down anywhere. A withdrawal that leaves no record is a
 * signed figure coming off the books on the authority of a phone call.
 *
 * ── IT WAS A REQUEST SOMEBODY ELSE ANSWERED, UNTIL 2026-09-18 ───────────────
 *
 * This file used to rest on a fourth property: ASKING AND DECIDING ARE TWO
 * ACTS, BY TWO PEOPLE. The employee asked, a signer answered, and the entry did
 * not move until they did. It bought one thing — that a figure two people
 * signed could not come off the books on one person's word — and it cost a
 * queue.
 *
 * The user withdrew it: **การถอนไม่ใช่การแก้ตัวเลข** It removes the employee's
 * own hours, nobody gains by it, and it is the wish of the person the entry
 * belongs to. The property was guarding something that did not need guarding,
 * and the bill arrived on 2026-09-14 when `cancelCutoffDay` started measuring
 * the ตัดสิน press at TODAY: a request filed in time and left sitting past the
 * cutoff could no longer be answered by the หัวหน้า who was going to answer it,
 * so it sat `requested` with only ฝ่ายบุคคล able to move it, and `periodItems`
 * called that month unfinished for as long as it sat. Three such rows were in
 * the database when this was written.
 *
 * **What guards the entry now is the cutoff, not a second person.** Everything
 * `withdrawEligibility` refuses, it refuses for the reasons it always did; what
 * changed is only what happens after it says yes. The whole of that argument is
 * docs/plan-withdraw-without-approval.md.
 *
 * ── The three properties this is built on ───────────────────────────────────
 *
 *   NO NEW STATUS. A withdrawal ends at `cancelled`, which is what every rollup
 *   query, every cap calculation and every report already means by "these hours
 *   do not count". The record of who withdrew it and why is a subdocument.
 *   Adding a sixth status would mean auditing every status filter in the
 *   codebase to add a value that changes none of their answers — the same
 *   reasoning `refileState` gives for not being a status either.
 *
 *   THE MONTH WALL IS THE WHOLE OF THE PROTECTION. Past `cancelCutoffDay` the
 *   employee may not edit, cancel or withdraw, and ฝ่ายบุคคล with a reason is
 *   the only way the row moves — `cancelPermission`'s `hr_cancel` branch. That
 *   is also this app's answer to "ฝ่ายบุคคล has already printed the paper": it
 *   cannot know what was printed — there is no `printedAt`, printing is Ctrl+P
 *   in a browser, and F-HR-027 opens for the employee too — so the user chose
 *   the cutoff as the approximation. **Turn the cutoff off and there is nothing
 *   left underneath it**, where before there was still a second answer. §9 of
 *   the plan.
 *
 *   A REASON IS REQUIRED. `cancelPermission` deliberately does not ask for one:
 *   removing a request nobody has looked at establishes nothing, and requiring
 *   a reason there would buy a field full of "ผิด". Here the opposite holds,
 *   for the reason `editPermission` requires one from ฝ่ายบุคคล — this takes
 *   back something two people established, and the หัวหน้า who signed it will
 *   read that line and nothing else.
 */
import {
  awaitingFirstSignature,
  cancelCutoffRefusal,
  idOf,
  viewerId,
} from './entries.js';

/** Live statuses a withdrawal can be asked about. Rejected and cancelled are closed. */
const OPEN_STATUSES = ['pending_hr', 'approved'];

/**
 * What `withdrawal.state` may be.
 *
 * `requested` AND `refused` CANNOT BE PRODUCED ANY MORE, and are kept anyway
 * because rows carrying them exist: `refused` is a real answer a real person
 * gave, and `requested` is what every row looks like until
 * `npm run migrate:withdraw-granted` has been pointed at that database.
 * Dropping either makes those documents fail validation the next time anything
 * saves them — which is any edit, any recompute, any cancel. Different from
 * `void`, taken out on 2026-09-15 after counting 0 rows out of 328.
 */
export const WITHDRAWAL_STATES = Object.freeze(['requested', 'granted', 'refused']);

const MAX_REASON = 200;

/**
 * May this person withdraw this entry, and is their reason usable?
 *
 * Exactly complementary to `cancelPermission`: that one covers everything
 * before the first signature, this one everything after it.
 *
 * Returns `{ ok: true, reason }` or `{ ok: false, error, status }`.
 */
export function withdrawPermission(user, entry, reason, opts = {}) {
  const eligible = withdrawEligibility(user, entry, opts);
  if (!eligible.ok) return eligible;

  const text = String(reason || '').trim();
  if (!text) return { ok: false, status: 400, error: 'กรุณาระบุเหตุผลที่ถอนใบ' };
  if (text.length > MAX_REASON) {
    return { ok: false, status: 400, error: `เหตุผลยาวเกิน ${MAX_REASON} ตัวอักษร` };
  }

  return { ok: true, reason: text };
}

/**
 * The same rule minus the reason — "may this person withdraw at all", which is
 * the question the SCREEN has.
 *
 * Split out because the screen has to decide whether to offer the button before
 * anybody has typed a reason, and the alternative was calling the full rule
 * with a placeholder string. That works right up until the reason check moves,
 * and then the button appears on rows the server refuses — the failure the note
 * on `isOwnFiling` describes, where the person presses, reads a 403, and has no
 * idea what they are meant to do instead.
 *
 * Written as `!awaitingFirstSignature` and not as a status list so the two
 * cannot drift apart and leave an entry that neither path will touch — a
 * request a หัวหน้า filed on somebody's behalf starts at `pending_hr` having
 * been approved by nobody, and it belongs to the first rule, not this one.
 */
export function withdrawEligibility(user, entry, { policy, on } = {}) {
  if (idOf(entry?.employee) !== viewerId(user)) {
    return { ok: false, status: 403, error: 'ถอนได้เฉพาะรายการของตนเอง' };
  }

  /**
   * THE MONTH WALL, before the redirect below and for the same reason
   * `cancelPermission` puts it before its own: that redirect names ยกเลิก, and
   * ยกเลิก is a button this rule has just taken away. A refusal that sends
   * somebody to a dead button is worse than no refusal — §6.2 of
   * docs/plan-cancel-cutoff-day.md.
   *
   * SINCE 2026-09-18 IT IS ALSO THE ONLY THING BETWEEN A SIGNED FIGURE AND ITS
   * REMOVAL. Nothing answers this a second time; whatever passes here is
   * `cancelled` by the end of the request.
   *
   * Not passing `policy` means no cutoff, which is what makes this rule
   * answerable twice: EmployeeView asks it WITHOUT the policy to find out
   * whether a button would have existed at all, then asks the cutoff separately
   * to find out whether to draw the chip instead. §8.3.
   */
  const past = cancelCutoffRefusal(user, entry, policy, on);
  if (past) return { ok: false, status: past.status, error: past.error };

  /**
   * Before the first signature there is nothing to take back — the employee
   * cancels it outright. Said as a redirect rather than a refusal, because the
   * person reading it wants the same outcome and there is a button on the same
   * screen that gives it to them.
   */
  if (awaitingFirstSignature(entry)) {
    return {
      ok: false,
      status: 409,
      error: 'รายการนี้ยังไม่มีผู้อนุมัติ — กด “ยกเลิก” เพื่อถอนได้ทันที',
    };
  }

  if (!OPEN_STATUSES.includes(entry?.status)) {
    return { ok: false, status: 409, error: 'รายการนี้ปิดแล้ว ถอนไม่ได้' };
  }

  return { ok: true };
}

/**
 * The subdocument a withdrawal produces.
 *
 * `state: 'granted'` IMMEDIATELY, and `decidedBy` / `decidedAt` /
 * `decisionNote` deliberately left empty — **nobody decided**. Writing the
 * withdrawing employee's own name into the ผู้ตัดสิน fields would forge a step
 * that did not happen, and every screen printing those fields would then say a
 * person approved their own removal. The fields stay on the schema because rows
 * from before 2026-09-18 have them filled in truthfully.
 *
 * The field names still say `requested…` and that is on purpose: they hold the
 * same three facts they always held — who, when, why — and renaming them would
 * rewrite them on disk for every old row to gain nothing a comment cannot say.
 *
 * `requestedByName` is copied beside the pointer for the reason every other
 * name in this schema is: a trail has to stay readable after somebody leaves,
 * and a name captured at the moment of the press is the only version a later
 * roster change cannot erase.
 */
export function withdrawalRecord(user, reason, { at = new Date() } = {}) {
  return {
    state: 'granted',
    requestedBy: user?._id,
    requestedByName: user?.name,
    requestedAt: at,
    reason,
  };
}

/**
 * Whether the screens may offer the button is `withdrawEligibility` itself —
 * the same function the route enforces with, called on the row in hand.
 *
 * There is deliberately no `publicWithdrawal()` shaping this block for the
 * browser. `managerDecision` and `hrDecision` go out on the entry exactly as
 * stored and every screen reads them straight off the wire; a filter for this
 * one field would be a second convention for no gain, and the day somebody
 * added a field to the subdocument they would have to remember to add it in two
 * places or watch it silently not arrive.
 */
