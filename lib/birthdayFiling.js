/**
 * บันทึก OT ให้ จากรายการวันเกิด — who may settle a birthday from the list, and
 * the one filing in this system that reaches `approved` with a single signature
 * on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SHORTCUT EXISTS AT ALL, AND WHY IT IS NOT A GENERAL ONE
 *
 * Every other OT request needs two people: the หัวหน้า who can say the work
 * happened, and ฝ่ายบุคคล who confirms it against the record. That is §6 and it
 * does not bend. A birthday holiday is the one case where the second person
 * already holds the first one's evidence: HR opens the fingerprint scanner's own
 * export, reads the in and out times for that person on that date, and types
 * them. There is no fact left for a หัวหน้า to add — the times a หัวหน้า would
 * repeat down the phone are the times HR is looking at.
 *
 * So the request is filed and approved in one act, and the audit trail says
 * exactly that: `submit_hr_verified`, one row, naming HR as both the person who
 * filled it in and the person who signed it, with the reason on it.
 * `managerDecision` is left EMPTY. Writing a manager's block to make the page
 * read ยื่นคำขอ → หัวหน้างานอนุมัติ → ฝ่ายบุคคลยืนยัน would be the same lie
 * `initialStatus` refuses to tell in lib/proxyFiling.js: two signatures on the
 * screen, one person behind them, and nothing afterwards able to tell the
 * difference. One honest signature beats two invented ones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIMIT, ENFORCED HERE AND NOT BY HIDING A BUTTON
 *
 * `birthdayDirectApproval` below is the whole rule and it is a function of
 * values, like `authorizeReplay` and `proxyPermission`. What makes it safe is
 * that the caller cannot assert its way past it: the route recomputes the
 * person's birthday holiday from THEIR stored birthDate and the live policy and
 * hands that in, so `direct: true` is reachable only for a date the birthday
 * rule itself produced. A payload naming an ordinary Tuesday gets `direct:
 * false` with a reason, whoever sent it and whatever it claims about itself.
 *
 * And the refusal is not "the button was not shown": there is no path from
 * POST /api/entries into this file at all. The general route writes
 * `pending_mgr` (or `pending_hr` under the proxy rule) and has no branch that
 * can produce `approved`. Two doors, one of them with this rule behind it.
 */
// `departmentClaim` is deliberately no longer imported: birthday rows are
// ฝ่ายบุคคล's alone, so no team or delegation reaches them. See
// `birthdayActionPermission` below for why that is a removal and not a gap.
import { idOf } from './entries.js';

/**
 * The action that says HR filed and approved in one act, having checked the
 * scan record.
 *
 * DELIBERATELY NOT IN `SYSTEM_FILED_ACTIONS` (lib/entries.js). That list means
 * "no form was filled in" — the withdrawn generator that wrote hours from a
 * calendar — and this is the opposite: a person read a clock record and typed
 * two times. Adding it there would put "ระบบสร้างใบวันเกิด ไม่มีใครกรอกแบบฟอร์ม"
 * on a row somebody personally vouched for, and would hand it the
 * `isUntouchedSystemFiling` exit that exists because nobody ever claimed those.
 */
export const HR_VERIFIED_ACTION = 'submit_hr_verified';

/**
 * The reason, in the words the history keeps.
 *
 * A constant rather than a literal in the route, for the reason `SKIP_NOTE` in
 * lib/proxyFiling.js is one: the screens explain an `approved` entry that no
 * หัวหน้า ever saw by naming this, and a sentence typed in two places is a
 * sentence that will one day read two ways.
 */
export const HR_VERIFIED_NOTE = 'ฝ่ายบุคคลตรวจสอบจากบันทึกเวลาเข้า-ออกงาน (สแกนนิ้ว) '
  + 'ของสวัสดิการวันเกิดแล้ว จึงเป็นทั้งผู้บันทึกและผู้อนุมัติรายการนี้ '
  + '— ไม่ได้ผ่านการอนุมัติจากหัวหน้างาน';

/**
 * Who the birthday holiday is FOR — which is not the same list as who may file
 * ordinary OT, and that is the whole of this change.
 *
 * §2 says หัวหน้างาน do not do OT, and `Employee.maySubmitOt()` still says so:
 * a manager cannot type an OT request, cannot be filed for by proxy, and has no
 * route into POST /api/entries. None of that moves.
 *
 * The birthday holiday is a different thing wearing the same clothes. It is not
 * work somebody chose to stay late for — it is a day off the company grants,
 * which turns into hours only because the person came in anyway. HR's rule for
 * it is "ทุกคนที่มาทำงาน" and it always was; the system read `role: 'employee'`
 * off the OT rule beside it and inherited a limit that was never about this.
 *
 * The roles held by PEOPLE. `hr` and `admin` are not on it because on this
 * installation they are not people: HR-001 and ADMIN are logins added for the
 * system alone, one per function, and everybody who actually works here —
 * ฝ่ายบุคคล included — already has their own PM- or THT- employee record and is
 * on this list through that.
 *
 * So a member of ฝ่ายบุคคล does get the day. They get it as PM-xxxx, like
 * everybody else, and it is settled by whoever is signed in to HR-001 — which is
 * a different account from theirs, and not self-approval at all. What produced
 * this list is not the question "does ฝ่ายบุคคล deserve a birthday", which was
 * never in doubt, but the question "which rows in the ROSTER are humans".
 *
 * Being on the list at all costs something when the answer is wrong: an account
 * with no วันเกิด — which a function login will never have — lands in
 * `uncheckable` with `reason: 'missing'`, and ฝ่ายบุคคล are then told for ever to
 * fill in a birth date that does not exist. That warning is what stops a
 * half-filled roster reading as a clean month, so it is exactly the warning that
 * must not be spent on noise.
 *
 * `hr` and `admin` each spent an afternoon on this list on the way here, on the
 * strength of the seed, where HR-001 is dressed as a person with a name and a
 * birthday. It is not one, and neither is ADMIN.
 *
 * Listed rather than derived, so a role added later is a decision somebody makes
 * here rather than a benefit that appears on its own. Acting on birthday rows is
 * a separate question and the two system roles keep it — see
 * `birthdayActionPermission` below.
 */
export const BIRTHDAY_SUBJECT_ROLES = Object.freeze(['employee', 'manager']);

/** One predicate, so widening this later is one list and not a search. */
export function isBirthdaySubject(employee) {
  return BIRTHDAY_SUBJECT_ROLES.includes(employee?.role);
}

/**
 * May this person act on this birthday row — either button?
 *
 * ฝ่ายบุคคล and Admin, and nobody else. HR's rule, 2026-08-13: สวัสดิการวันเกิด
 * is theirs to settle end to end; a หัวหน้า approves ordinary OT requests and
 * that is the whole of their part in this system.
 *
 * IT USED TO GO THROUGH `departmentClaim` — a หัวหน้า for their own team, a
 * ผู้รับช่วง for the teams they were holding — and that has been removed rather
 * than narrowed, which is worth saying because it looks like a lost feature. It
 * was the wrong shape twice over. The single-signature path exists because HR
 * reads the fingerprint scanner's own export, so a หัวหน้า pressing this button
 * would be approving against evidence they do not hold. And the day หัวหน้า
 * joined the list themselves (BIRTHDAY_SUBJECT_ROLES) it stopped being possible
 * to state simply: their own row sat inside their own scope, so the rule needed
 * a self-check bolted on, and a peer หัวหน้า in the same department could still
 * sign for them. "ฝ่ายบุคคลเท่านั้น" has neither hole and needs no exception.
 *
 * Delegation therefore does not reach birthday rows at all. A ผู้รับช่วง holds
 * an approval queue; this is not one.
 *
 * `subject` is who the row is ABOUT, and their own row is refused.
 *
 * UNREACHABLE TODAY, AND KEPT ANYWAY. The two roles that may act here are
 * function logins, and the roles that may be acted ON are people
 * (BIRTHDAY_SUBJECT_ROLES) — the sets do not overlap, so nobody can currently
 * arrive at their own row. This is not that check being pointless; it is the
 * check being the reason a future widening of that list cannot quietly create
 * self-approval in a place nobody thought to look. It is the same refusal
 * `isOwnFiling` makes in the approval queue, and it costs one comparison.
 *
 * Whether a person in ฝ่ายบุคคล gets the day is a different question and the
 * answer is yes — as PM-xxxx, their own employee record, settled from HR-001.
 * Two different accounts, so nothing self-approves.
 *
 * `subject` absent means "not a question about a person" — callers asking only
 * whether this user works with birthday rows at all keep the plain answer.
 *
 * Returns `{ ok: true, actor: 'hr', onBehalfOf, delegationId }` or
 * `{ ok: false, error, status }` ready for `fail()`.
 */
export function birthdayActionPermission({ user, subject = null }) {
  if (!['hr', 'admin'].includes(user?.role)) {
    return {
      ok: false,
      status: 403,
      error: 'รายการสวัสดิการวันเกิดบันทึกได้เฉพาะฝ่ายบุคคล '
        + '— หัวหน้างานมีหน้าที่อนุมัติใบขอ OT ตามปกติเท่านั้น',
    };
  }

  if (subject && idOf(subject) && idOf(subject) === idOf(user)) {
    return {
      ok: false,
      status: 403,
      error: 'ลงนามรายการสวัสดิการวันเกิดของตนเองไม่ได้',
    };
  }

  return { ok: true, actor: 'hr', onBehalfOf: null, delegationId: null };
}

/**
 * Is this genuinely a row from วันเกิดที่ยังไม่มีใบ, and does it take the
 * single-signature path?
 *
 * Two questions, one answer, because they have to be asked in that order: a
 * payload that is not a birthday row is refused outright, and a birthday row
 * that simply is not eligible for the shortcut falls back to the ordinary
 * two-step route rather than failing.
 *
 * @param {object}   args
 * @param {object}   args.actor        who is filing
 * @param {object}   args.employee     who it is for
 * @param {string}   args.workDate     the date claimed by the payload
 * @param {?string}  args.birthdayDate the date the birthday rule ACTUALLY produced
 *                                     for this person this year — computed by the
 *                                     caller from the stored birthDate, never sent
 *                                     by the client
 * @param {boolean}  args.isCompanyHoliday  was that date already วันหยุด for everybody
 * @param {string}   args.today        'YYYY-MM-DD', Asia/Bangkok
 * @param {object}   args.policy       the live policy
 * @param {boolean}  [args.alreadyAbsent]  a live BirthdayCheck says they were away
 *
 * @returns {{ ok: false, status, error } | { ok: true, direct: boolean, reason?: string }}
 */
export function birthdayDirectApproval({
  actor, employee, workDate, birthdayDate, isCompanyHoliday = false,
  today, policy = {}, alreadyAbsent = false,
}) {
  // ── is this a birthday row at all? ────────────────────────────────────────
  // Everything below is a way the answer can be no, and each one is a hard
  // refusal: this path exists for one list and a request that is not on it has
  // come to the wrong door, not asked for something it may not have.

  if (!policy.birthdayHolidayEnabled) {
    return {
      ok: false,
      status: 409,
      error: 'กฎสวัสดิการวันเกิดปิดอยู่ — ไม่มีรายการวันเกิดให้บันทึก',
    };
  }

  if (!employee) return { ok: false, status: 404, error: 'ไม่พบพนักงานที่ระบุ' };
  if (employee.active === false) {
    return { ok: false, status: 409, error: 'พนักงานคนนี้ถูกปิดใช้งานแล้ว' };
  }
  // NOT `proxyPermission`'s target rule, and the difference is deliberate: that
  // one asks "could this person have filed it themselves", which is the right
  // question for ordinary OT and the wrong one here. The birthday holiday is
  // granted to everybody who comes in, หัวหน้า included — see
  // BIRTHDAY_SUBJECT_ROLES above. §2 is untouched: a manager still has no way
  // into POST /api/entries, and this door only opens on the one date the
  // birthday rule itself produced for this person, checked immediately below.
  if (!isBirthdaySubject(employee)) {
    return { ok: false, status: 400, error: 'บทบาทนี้ไม่อยู่ในข่ายสวัสดิการวันเกิด' };
  }

  /**
   * THE CHECK THAT MAKES THE LIMIT REAL.
   *
   * `birthdayDate` is what `birthdayInYear` returned for this person's stored
   * วันเกิด under the live policy — including the leap-day answer, which is why
   * it is computed rather than compared date-part by date-part here. Null means
   * no holiday is owed this year at all ('none' fallback, or no birth date on
   * record), and a mismatch means the payload named some other day.
   */
  if (!birthdayDate || birthdayDate !== workDate) {
    return {
      ok: false,
      status: 400,
      error: 'วันที่ที่ระบุไม่ใช่สวัสดิการวันเกิดของพนักงานคนนี้ '
        + '— เส้นทางนี้ใช้ได้เฉพาะรายการจากวันเกิดที่ยังไม่มีใบ · '
        + 'ใบ OT ทั่วไปให้บันทึกจากหน้าปกติและผ่านหัวหน้าอนุมัติ',
    };
  }

  // A birthday that lands on a Saturday or a company holiday was never on the
  // list: the day was already วันหยุด for everybody, the rule added nothing, and
  // anybody who worked it files an ordinary holiday request.
  if (isCompanyHoliday) {
    return {
      ok: false,
      status: 409,
      error: 'วันนี้เป็นวันหยุดของทั้งบริษัทอยู่แล้ว ไม่ได้อยู่ในรายการวันเกิด '
        + '— บันทึกเป็นใบ OT วันหยุดตามปกติ',
    };
  }

  /**
   * A date that has not arrived. The whole justification for one signature is
   * that HR read the scan record, and there is no scan record for a shift that
   * has not happened — so this is refused rather than downgraded to the ordinary
   * path. The screen puts these rows in กำลังจะถึง with no buttons; this is the
   * same rule, at the only place it can actually be enforced.
   */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) {
    throw new Error('birthdayDirectApproval ต้องรับ today เป็น YYYY-MM-DD');
  }
  if (workDate > today) {
    return {
      ok: false,
      status: 409,
      error: 'วันเกิดนี้ยังไม่ถึง — ยังไม่มีบันทึกเวลาเข้า-ออกงานให้ตรวจสอบ',
    };
  }

  // Somebody already answered the other way. Two contradictory records of the
  // same day help nobody; retract the check first, which is one press and leaves
  // both rows on the record.
  if (alreadyAbsent) {
    return {
      ok: false,
      status: 409,
      error: 'มีการบันทึกไว้แล้วว่าพนักงานไม่ได้มาทำงานในวันนี้ '
        + '— กด “ยกเลิกการบันทึก” ก่อน จึงจะบันทึก OT ให้ได้',
    };
  }

  // ── it is. does it take the shortcut? ─────────────────────────────────────
  // From here on nothing is an error. Both answers file a real request; they
  // differ only in which desk it lands on, which is what makes the flag
  // COSMETIC in the sense lib/policyVersion.js means.

  if (policy.hrDirectApproveBirthday === false) {
    return {
      ok: true,
      direct: false,
      reason: 'ปิดการอนุมัติชั้นเดียวไว้ในนโยบาย — รายการนี้จะรอหัวหน้าอนุมัติตามปกติ',
    };
  }

  /**
   * ฝ่ายบุคคล only, and NOT because a หัวหน้า is trusted less.
   *
   * The single signature is HR's own confirmation step, spent early on the
   * strength of the scan record they are holding. A หัวหน้า has no second step
   * to spend: theirs is the first one, and a request they wrote still has to
   * reach ฝ่ายบุคคล to be confirmed by somebody. So their press files exactly
   * what บันทึก OT แทนลูกทีม has always filed — `initialStatus` skips their own
   * step openly and it waits at `pending_hr` — and nothing here has to teach
   * that path anything new.
   */
  if (!['hr', 'admin'].includes(actor?.role)) {
    return {
      ok: true,
      direct: false,
      reason: 'หัวหน้างานบันทึกแทนได้ แต่รายการยังต้องให้ฝ่ายบุคคลยืนยัน',
    };
  }

  // Filing for oneself is not this, and HR does not submit OT in the first
  // place (§2) — but the comparison is cheap and the alternative is an entry
  // approved by the person it pays.
  if (idOf(actor) === idOf(employee)) {
    return { ok: false, status: 400, error: 'การบันทึกให้ตนเองไม่ใช่การบันทึกแทน' };
  }

  return { ok: true, direct: true };
}
