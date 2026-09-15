/**
 * ขอถอนใบที่อนุมัติแล้ว — the way back out of a request somebody has signed.
 *
 * The line `cancelPermission` draws is the first signature: before it the
 * request is the employee's to withdraw, after it the entry carries a decision
 * made against particular hours and the employee is out. That line is right and
 * this file does not move it. What it replaces is the sentence on the other
 * side of it — `'หัวหน้าอนุมัติแล้ว ยกเลิกเองไม่ได้ — ติดต่อฝ่ายบุคคล'` — which
 * sent the rest of the story outside the system.
 *
 * What happened out there was ฝ่ายบุคคล editing or cancelling the row on the
 * employee's say-so, and what the trail recorded was ฝ่ายบุคคลแก้ไขข้อมูล. Who
 * asked, when they asked, why, and whether the manager who signed ever heard
 * about it are all real facts about that entry, and none of them was written
 * down anywhere. A withdrawal that leaves no record of the request is a signed
 * figure coming off the books on the authority of a phone call.
 *
 * ── The three properties this is built on ───────────────────────────────────
 *
 *   NO NEW STATUS. A granted withdrawal ends at `cancelled`, which is what
 *   every rollup query, every cap calculation and every report already means by
 *   "these hours do not count". The request itself is a subdocument. Adding a
 *   sixth status would mean auditing every status filter in the codebase to add
 *   a value that changes none of their answers — the same reasoning `refileState`
 *   gives for not being a status either.
 *
 *   AND SINCE 2026-09-14, A REQUEST CAN OUTLIVE THE PEOPLE WHO COULD ANSWER
 *   IT. `cancelCutoffDay` closes the ตัดสิน press to signers once the entry's
 *   own งวด has passed a day of the following month, measured at TODAY and not
 *   at `requestedAt` — the user was asked and answered "ทั้งหมด" twice. So the
 *   sentence above, that a withdrawal ends at `cancelled`, is still true of
 *   every withdrawal that ENDS; what is new is that one can sit `requested`
 *   with nobody but ฝ่ายบุคคล able to move it. §13 of
 *   docs/plan-cancel-cutoff-day.md is where that cost is written down.
 *
 *   ASKING AND DECIDING ARE TWO ACTS, BY TWO PEOPLE. The employee asks; somebody
 *   whose signature is on the entry answers. Collapsing them — letting HR record
 *   a withdrawal in one press "on behalf of" the employee — rebuilds the exact
 *   hole this closes, because then the record of the request is again only
 *   somebody's memory of a conversation.
 *
 *   A REASON IS REQUIRED. `cancelPermission` deliberately does not ask for one:
 *   removing a request nobody has looked at establishes nothing, and requiring a
 *   reason there would buy a field full of "ผิด". Here the opposite holds, for
 *   the reason `editPermission` requires one from ฝ่ายบุคคล — this asks somebody
 *   to take back something they established, and the person deciding cannot
 *   decide without knowing why.
 */
import {
  awaitingFirstSignature,
  cancelCutoffLead,
  cancelCutoffRefusal,
  idOf,
  isPastCancelCutoff,
  viewerId,
} from './entries.js';
import { departmentClaim } from './delegation.js';
import { entryCompany } from './entries.js';

/** Live statuses a withdrawal can be asked about. Rejected and cancelled are closed. */
const OPEN_STATUSES = ['pending_hr', 'approved'];

/** What `withdrawal.state` may be. Absent means never asked. */
export const WITHDRAWAL_STATES = Object.freeze(['requested', 'granted', 'refused']);

const MAX_REASON = 200;

/**
 * Is there a request waiting for an answer on this entry?
 *
 * Only `requested` is open. A refused one is history — it stays on the entry so
 * the trail can show it was asked and answered, and it does not block asking
 * again. Circumstances change, and a refusal here is not the once-only door
 * `resubmittedTo` guards; if somebody asks twice for the same bad reason, the
 * record of both is the answer to that, not a lock.
 */
export function hasOpenWithdrawal(entry) {
  return entry?.withdrawal?.state === 'requested';
}

/**
 * May this person ask for this entry to be withdrawn?
 *
 * Exactly complementary to `cancelPermission`: that one covers everything
 * before the first signature, this one everything after it. Written as
 * `!awaitingFirstSignature` and not as a status list so the two cannot drift
 * apart and leave an entry that neither path will touch — a request a หัวหน้า
 * filed on somebody's behalf starts at `pending_hr` having been approved by
 * nobody, and it belongs to the first rule, not this one.
 *
 * Returns `{ ok: true }` or `{ ok: false, error, status }`.
 */
export function withdrawRequestPermission(user, entry, reason, opts = {}) {
  const eligible = withdrawEligibility(user, entry, opts);
  if (!eligible.ok) return eligible;

  const text = String(reason || '').trim();
  if (!text) return { ok: false, status: 400, error: 'กรุณาระบุเหตุผลที่ขอถอนใบ' };
  if (text.length > MAX_REASON) {
    return { ok: false, status: 400, error: `เหตุผลยาวเกิน ${MAX_REASON} ตัวอักษร` };
  }

  return { ok: true, reason: text };
}

/**
 * The same rule minus the reason — "may this person ask at all", which is the
 * question the SCREEN has.
 *
 * Split out because the screen has to decide whether to offer the button before
 * anybody has typed a reason, and the alternative was calling the full rule
 * with a placeholder string. That works right up until the reason check moves,
 * and then the button appears on rows the server refuses — the failure the note
 * on `isOwnFiling` describes, where the person presses, reads a 403, and has no
 * idea what they are meant to do instead.
 */
export function withdrawEligibility(user, entry, { policy, on } = {}) {
  if (idOf(entry?.employee) !== viewerId(user)) {
    return { ok: false, status: 403, error: 'ขอถอนได้เฉพาะรายการของตนเอง' };
  }

  /**
   * THE MONTH WALL, before the redirect below and for the same reason
   * `cancelPermission` puts it before its own: that redirect names ยกเลิก, and
   * ยกเลิก is a button this rule has just taken away. A refusal that sends
   * somebody to a dead button is worse than no refusal — §6.2 of
   * docs/plan-cancel-cutoff-day.md.
   *
   * Not passing `policy` means no cutoff, which is what makes this rule
   * answerable twice: EmployeeView asks it WITHOUT the policy to find out
   * whether a button would have existed at all, then asks the cutoff separately
   * to find out whether to draw the sentence instead. §8.3.
   */
  const past = cancelCutoffRefusal(user, entry, policy, on);
  if (past) return { ok: false, status: past.status, error: past.error };

  /**
   * Before the first signature there is nothing to ask permission for — the
   * employee cancels it themselves. Said as a redirect rather than a refusal,
   * because the person reading it wants the same outcome and there is a button
   * on the same screen that gives it to them.
   */
  if (awaitingFirstSignature(entry)) {
    return {
      ok: false,
      status: 409,
      error: 'รายการนี้ยังไม่มีผู้อนุมัติ — กด “ยกเลิก” เพื่อถอนได้ทันที ไม่ต้องขอ',
    };
  }

  if (!OPEN_STATUSES.includes(entry?.status)) {
    return { ok: false, status: 409, error: 'รายการนี้ปิดแล้ว ขอถอนไม่ได้' };
  }

  if (hasOpenWithdrawal(entry)) {
    return { ok: false, status: 409, error: 'มีคำขอถอนใบนี้รออยู่แล้ว' };
  }

  return { ok: true };
}

/**
 * May this person answer it, and using whose authority?
 *
 * Whoever's signature is on the entry, which is the whole of the rule:
 *
 *   ฝ่ายบุคคล and Admin, always. On an `approved` entry theirs is the last
 *   signature, and they are who the old error message told people to contact —
 *   this makes that sentence true inside the system instead of outside it.
 *
 *   The department's หัวหน้า, or a ผู้รับช่วง holding their queue. Their
 *   signature is on it and they are the person who would otherwise not hear
 *   that the hours they approved had gone. Resolved through `departmentClaim`,
 *   the same function the approval queue uses, so a stand-in reaches exactly
 *   the teams they cover and the record says on whose behalf.
 *
 * NOT the person who asked. Guarded explicitly rather than left to the fact
 * that หัวหน้า cannot file OT for themselves (`maySubmitOt`) — that is a
 * different rule in a different file, and a rule that depends on another rule
 * breaks the day somebody edits the other one.
 *
 * Returns `{ ok: true, onBehalfOf, delegationId }` or `{ ok: false, … }`.
 * `verb` shapes the refusal only: อนุมัติการถอน and ปฏิเสธการถอน share every
 * rule and differ in one word, exactly as `approvalPermission` says of its own
 * pair.
 */
export function withdrawDecisionPermission({
  user, entry, delegations = [], today, verb = 'ตัดสิน', policy, note,
}) {
  if (!hasOpenWithdrawal(entry)) {
    return { ok: false, status: 409, error: 'ไม่มีคำขอถอนที่รออยู่สำหรับรายการนี้' };
  }

  if (idOf(entry?.withdrawal?.requestedBy) === viewerId(user)) {
    return { ok: false, status: 403, error: 'ผู้ขอถอนไม่สามารถอนุมัติคำขอของตนเองได้' };
  }

  /**
   * THE MONTH WALL — after the open-request check, before the department one.
   *
   * MEASURED AT TODAY, NOT AT `requestedAt`. A request filed in time and left
   * sitting until the cutoff has passed can no longer be answered by the
   * หัวหน้า who was going to answer it; ฝ่ายบุคคล is the only way out. That is
   * the "ทั้งหมด" the user asked for, said twice, and its cost is written into
   * §13 of the plan rather than softened here: the คิวคำขอถอน will accumulate
   * rows only HR can clear, and `periodItems` will keep counting them as
   * outstanding for a month that is long finished.
   *
   * Somebody outside the department still gets the 403 they got before —
   * that is why this sits above the `departmentClaim` call and not below it.
   */
  const past = cancelCutoffRefusal(user, entry, policy, today);
  if (past) {
    // The lead half of the sentence, then this rule's own tail. Built from
    // `cancelCutoffLead` rather than cut out of `past.error`, so the day
    // somebody rewords one of them the other does not quietly turn to nonsense.
    return {
      ok: false,
      status: past.status,
      error: `${cancelCutoffLead(entry, policy)} — ${verb}คำขอถอนได้เฉพาะฝ่ายบุคคล`,
    };
  }

  if (['hr', 'admin'].includes(user?.role)) {
    /**
     * ฝ่ายบุคคล GO THROUGH, AND SAY WHY WHEN THE PERIOD HAS CLOSED.
     *
     * The user asked for this on 2026-09-14 after being shown that deciding a
     * withdrawal is one of the presses this app does NOT require a reason for.
     * Editing already does (`editPermission` → 400), asking already does
     * (`withdrawRequestPermission` → 400); deciding records nothing, so nothing
     * would have said why HR answered a request belonging to a period the
     * signer could no longer answer.
     *
     * ONLY PAST THE CUTOFF. An open period is decided exactly as it was before
     * this key existed — no new gate, which is the difference between a warning
     * and a tax.
     *
     * HERE AND NOT ONLY IN THE DIALOG, because a rule that lives on the screen
     * is a rule `curl` walks past. Same shape as `editPermission`'s own reason
     * check, deliberately.
     */
    if (isPastCancelCutoff(entry, policy, today) && !String(note || '').trim()) {
      return { ok: false, status: 400, error: 'กรุณาระบุเหตุผลที่ตัดสินคำขอถอนของงวดที่พ้นกำหนดแล้ว' };
    }
    return { ok: true, onBehalfOf: null, delegationId: null };
  }

  // HR answered above, so anybody still here is a หัวหน้า or a ผู้รับช่วง and
  // the company scope applies — the same claim the approve queue resolves, from
  // the same function, so the two can never disagree about whose row this is.
  const claim = departmentClaim(user, entry?.department, delegations, today, entryCompany(entry));
  if (claim) return { ok: true, ...claim };

  return { ok: false, status: 403, error: `${verb}คำขอถอนได้เฉพาะรายการในแผนกของตน` };
}

/**
 * The subdocument a fresh request produces.
 *
 * `requestedByName` is copied beside the pointer for the reason every other
 * name in this schema is: a trail has to stay readable after somebody leaves,
 * and a name captured at the moment of asking is the only version a later
 * roster change cannot erase.
 */
export function withdrawalRequest(user, reason, { at = new Date() } = {}) {
  return {
    state: 'requested',
    requestedBy: user?._id,
    requestedByName: user?.name,
    requestedAt: at,
    reason,
  };
}

/**
 * …and what deciding one adds to it.
 *
 * The request half is never overwritten. A granted withdrawal that kept only
 * "ฝ่ายบุคคลอนุมัติการถอน" would have lost the reason it was asked for, which
 * is the single most useful line on the whole record when the month is
 * questioned later.
 *
 * `decidedBy` is the person who pressed the button, always — `onBehalfOf` says
 * whose authority they used, matching `approvalRecord`. The two are never
 * collapsed: a trail holding only the first cannot answer why that person was
 * allowed to release a signed figure.
 */
export function withdrawalDecision(existing, user, { granted, note, resolved, at = new Date() } = {}) {
  const behalf = resolved?.onBehalfOf;
  return {
    ...existing,
    state: granted ? 'granted' : 'refused',
    decidedBy: user?._id,
    decidedByName: user?.name,
    decidedAt: at,
    decisionNote: String(note || '').trim() || undefined,
    onBehalfOf: behalf ? (behalf._id ?? behalf) : undefined,
    onBehalfOfName: behalf?.name || undefined,
    delegationId: resolved?.delegationId || undefined,
  };
}

/**
 * Whether the screens may offer the button is `withdrawRequestPermission` and
 * `withdrawDecisionPermission` themselves — the same functions the routes
 * enforce with, called on the row in hand.
 *
 * There is deliberately no `publicWithdrawal()` shaping this block for the
 * browser. `managerDecision` and `hrDecision` go out on the entry exactly as
 * stored and every screen reads them straight off the wire; a filter for this
 * one field would be a second convention for no gain, and the day somebody
 * added a field to the subdocument they would have to remember to add it in two
 * places or watch it silently not arrive.
 */
