/**
 * "รอการอนุมัติจากใคร" — one line under the status chip, on the employee's own
 * screen.
 *
 * WHY IT IS WORTH A MODULE. Every fact this prints was already in the database
 * and none of it was on the screen the person asking actually opens. A request
 * sitting at รอหัวหน้า told them a stage, not a desk; an approved one told them
 * it was approved and not by whom; a refused one showed a reason with no name
 * against it. The question that follows every one of those — "so who do I go
 * and ask" — was answerable only by somebody with database access.
 *
 * PURE, AND IT DECIDES NOTHING. It reads a stored entry and a list of names the
 * caller supplies, and returns the words. No permission follows from it, no
 * figure moves, and being wrong here shows the wrong name — which is why the
 * two places it could be wrong are handled by saying less rather than guessing:
 * a decision with no `byName` on it prints without one, and a stage with no
 * eligible signer says so outright instead of naming somebody plausible.
 *
 * Runs in the browser, so nothing here touches mongoose or a clock.
 */

// The one sentence that says a proxy filing STOOD IN for the หัวหน้า step.
// Imported rather than retyped, for the reason it is a constant over there: a
// note spelled out twice is a note that will one day read two ways. It is the
// only thing this file takes from that module, and nothing that module pulls in
// touches mongoose or a clock — so this one still runs in the browser.
import { SKIP_NOTE } from './proxyFiling.js';

/** The history rows that ARE a decision, in the order a reader meets them. */
const APPROVE_ACTIONS = new Set(['approve_mgr', 'approve_hr', 'submit_hr_verified']);
const REFUSE_ACTIONS = new Set(['reject_mgr', 'reject_hr']);

/**
 * WHICH DESK A SIGNATURE WAS MADE AT — read off the action, and not off the
 * signer's roster row.
 *
 * The employee's question is "ใครอนุมัติ" and a bare name only half-answers it:
 * สมหญิง ใจงาม signed this, in what capacity? The action already carries that
 * and carries it FROZEN — `approve_mgr` was the หัวหน้า step on the day it was
 * pressed and stays the หัวหน้า step for ever.
 *
 * WHY NOT THE PERSON'S `position`. Two reasons, and both are about the same
 * entry being read a year later. A position is live: promote สมหญิง and every
 * decision she ever signed silently re-labels itself with a title she did not
 * hold at the time. And a person can leave — their document goes, and `byName`
 * is denormalised onto the history row precisely so the trail survives that,
 * which a looked-up position would not. If HR ever wants the job title itself
 * against a signature, the honest way is a `byPosition` copied onto the row at
 * decision time beside `byName`; it cannot be recovered for rows already
 * written, which is the whole argument for not reading it live.
 */
const DESK = {
  approve_mgr: 'หัวหน้างาน',
  reject_mgr: 'หัวหน้างาน',
  approve_hr: 'ฝ่ายบุคคล',
  reject_hr: 'ฝ่ายบุคคล',
  submit_hr_verified: 'ฝ่ายบุคคล',
};

/**
 * The LAST decision on the entry, approving or refusing.
 *
 * Last rather than first, because a request can be refused, edited and approved
 * — and the line is about where it stands now. `submit_hr_verified` counts as
 * an approval: it is the one action whose `toStatus` is อนุมัติ with no approve
 * row before it, and a reader looking for the missing signature would not find
 * one. See ACTION_META in components/common.jsx, which says the same thing
 * about the same row.
 */
export function lastDecision(entry) {
  const history = entry?.history || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (APPROVE_ACTIONS.has(h?.action) || REFUSE_ACTIONS.has(h?.action)) return decisionOf(h);
  }
  return null;
}

/** One decision row, read into the fields a screen prints. */
function decisionOf(h) {
  return {
    action: h.action,
    approved: APPROVE_ACTIONS.has(h.action),
    byName: h.byName || null,
    onBehalfOfName: h.onBehalfOfName || null,
    /**
     * ผู้ดูแลระบบ signed the หัวหน้า step because the แผนก had none who could.
     * Carried through because it is the one fact that makes an ordinary-looking
     * signature not ordinary, and `note` on the same row is never empty when it
     * is set — `approvalPermission` refuses the decision without a reason.
     */
    adminOverride: Boolean(h.adminOverride),
    // Which desk, frozen at the action — see DESK above.
    desk: DESK[h.action] || null,
    // The HR account is shared by the whole department — see the note in the
    // roster. `hr` here means "somebody at ฝ่ายบุคคล", never a person, and the
    // label says the desk for that reason.
    atHr: DESK[h.action] === 'ฝ่ายบุคคล',
    note: h.note || null,
    /**
     * WHEN THE BUTTON WAS PRESSED. Stored on every history row since the first
     * version (`at`, defaulting to `Date.now`), so this needed recording
     * nowhere — only showing. Raw here rather than formatted: `thaiDateTime` in
     * lib/api.js reads the browser's zone, and this module stays a pure
     * function of the entry so a test can hold it still.
     */
    at: h.at || null,
  };
}

/**
 * EVERY decision on the entry, oldest first — the หัวหน้า signature and the
 * ฝ่ายบุคคล one, each with the desk it was made at and the minute it was made.
 *
 * `approverLine` above answers "where does this stand now", which is one line
 * and one signature — the LAST. That is the right headline and the wrong
 * history: on a fully approved entry the last decision is ฝ่ายบุคคล, so the
 * หัวหน้า who actually read the request and signed it first was named nowhere
 * the employee could see. `EntryHistory` did print both, and only behind
 * ข้อมูลเดิม, which draws at all only on an entry that was edited or re-filed —
 * so the ordinary approved request showed neither name.
 *
 * The same rows through a narrower lens, not a second reading of them: the full
 * trail stays `EntryHistory`'s, this is the two or three lines of it an
 * employee opens the pop-up to find.
 */
export function approvalSteps(entry) {
  return (entry?.history || [])
    .filter((h) => APPROVE_ACTIONS.has(h?.action) || REFUSE_ACTIONS.has(h?.action))
    .map(decisionOf);
}

/**
 * How one eligible signer is named. `standInFor` is set when this person holds
 * somebody else's authority rather than their own.
 */
function nameOf(signer) {
  if (!signer?.name) return null;
  const who = signer.position ? `${signer.name} · ${signer.position}` : signer.name;
  return signer.standInFor ? `${who} (รับช่วงแทน ${signer.standInFor})` : who;
}

/**
 * @param {object} entry           one stored entry, as the list endpoint sends it
 * @param {object} [signers]       `{ people, departmentId }` — who may sign for
 *                                 the person's CURRENT department, from
 *                                 GET /api/entries/approvers. Omitted or from a
 *                                 different department, the waiting line prints
 *                                 the desk without names rather than the wrong
 *                                 ones.
 * @returns {{ tone, icon, text, note, at }|null}
 */
export function approverLine(entry, signers = null) {
  if (!entry?.status) return null;

  if (entry.status === 'approved' || entry.status === 'rejected') {
    const decision = lastDecision(entry);
    // An approved entry with no decision row is data written before the history
    // existed. "อนุมัติแล้ว" with no name is the whole truth about it.
    if (!decision) {
      return entry.status === 'approved'
        ? { tone: 'ok', icon: '✅', text: 'อนุมัติแล้ว', note: null, at: null }
        : {
          tone: 'no', icon: '❌', text: 'ไม่อนุมัติ', note: entry.rejectionReason || null, at: null,
        };
    }
    const who = decision.byName
      || (decision.atHr ? 'ฝ่ายบุคคล' : null);
    /**
     * WHAT QUALIFIES THE NAME — "สมหญิง ใจงาม (หัวหน้างาน)", and when a stand-in
     * signed it, "มานพ (หัวหน้างาน · ทำแทน สมหญิง)".
     *
     * THE DESK IS THE NEW HALF. A name alone said who pressed the button and
     * not what they were when they pressed it, which is half of what "ใครอนุมัติ
     * ใบนี้" asks. It used to be added on the ฝ่ายบุคคล step only; the หัวหน้า
     * step is where it carries the most, because that name is a person's and
     * nothing beside it said which of the two signatures on the entry it was.
     *
     * ONE BRACKET AND NOT TWO. "มานพ (ทำแทน สมหญิง) (หัวหน้างาน)" is the same
     * two facts arranged so that they look like a fact and an afterthought;
     * both qualify the same name and they belong in the same breath.
     *
     * NOTHING WHEN THE NAME ALREADY IS THE DESK. ฝ่ายบุคคล sign under one shared
     * account whose name is ฝ่ายบุคคล — "ฝ่ายบุคคล (ฝ่ายบุคคล)" would read as
     * two different parties, which is the one wrong idea this line can plant.
     */
    const marks = [
      decision.desk && who !== decision.desk ? decision.desk : null,
      decision.onBehalfOfName ? `ทำแทน ${decision.onBehalfOfName}` : null,
    ].filter(Boolean);
    const behalf = marks.length ? ` (${marks.join(' · ')})` : '';
    return decision.approved
      ? {
        tone: 'ok',
        icon: '✅',
        text: who ? `อนุมัติโดย: ${who}${behalf}` : 'อนุมัติแล้ว',
        note: decision.note || null,
        // Drawn only where there is room for it — see the `when` prop on
        // ApproverLine. The pop-up passes it; a table cell four characters wide
        // does not.
        at: decision.at,
      }
      : {
        tone: 'no',
        icon: '❌',
        text: who ? `ปฏิเสธโดย: ${who}${behalf}` : 'ไม่อนุมัติ',
        // The reason the employee has to act on. `rejectionReason` is where the
        // refusal route stores it and the history note is the same sentence;
        // either may be the one that is filled in.
        note: entry.rejectionReason || decision.note || null,
        at: decision.at,
      };
  }

  if (entry.status === 'pending_hr') {
    // No name, and not for want of looking it up: ฝ่ายบุคคล share one login, so
    // any name printed here would be an account rather than the person who will
    // read it. See the roster note about the shared account.
    // `at` is on every shape this returns, and null on the three that are about
    // something not yet done: a waiting line with a time on it would be read as
    // the moment it was signed.
    return { tone: 'wait', icon: '⏳', text: 'รอการยืนยันจาก: ฝ่ายบุคคล', note: null, at: null };
  }

  if (entry.status === 'pending_mgr') {
    const known = signers && (!signers.departmentId || !entry.department?._id
      || String(signers.departmentId) === String(entry.department._id));
    const people = (known ? signers?.people : null) || [];

    if (known && signers && people.length === 0) {
      /**
       * NOBODY CAN SIGN THIS, said out loud on the employee's own screen.
       *
       * ADM has no หัวหน้า and has not had one for as long as the roster has
       * existed, and a narrowed เซ็นให้บริษัท can strand people the same way —
       * see `unsignedStaff` in lib/employees.js, which refuses the save that
       * would cause it. This is the case that already exists. Until now the
       * request simply sat at รอหัวหน้า forever with nothing anywhere saying
       * why, which is the failure mode that note predicts word for word.
       */
      return {
        tone: 'warn',
        icon: '⚠️',
        text: 'ยังไม่มีหัวหน้างานที่เซ็นอนุมัติให้ได้ — กรุณาแจ้งฝ่ายบุคคล',
        note: null,
        at: null,
      };
    }

    const names = people.map(nameOf).filter(Boolean);
    return {
      tone: 'wait',
      icon: '⏳',
      text: names.length
        ? `รอการอนุมัติจาก: ${names.join(' หรือ ')}`
        : 'รอการอนุมัติจากหัวหน้างาน',
      note: null,
      at: null,
    };
  }

  if (entry.status === 'cancelled') return null;
  return null;
}

/**
 * THE ลงชื่อหัวหน้างาน SIGNATURE ON ONE ENTRY — the name that prints in that
 * column of F-HR-027, and null when the column stays blank.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHOEVER PRESSED อนุมัติ — asked for in those words on 2026-09-07, and it is a
 * REVERSAL of the rule this function shipped with five days earlier.
 *
 * Until then it read `approve_mgr` and nothing else, and left the column blank
 * on every row whose approval was ฝ่ายบุคคล's own. That was written down as the
 * true statement — nobody signed the หัวหน้า step, so nothing is printed — and
 * it stopped being tenable the day ฝ่ายบุคคล started filing their own OT and
 * approving it themselves (`approvalPermission` exempts `role: 'hr'` from the
 * self-approval bar, on HR's instruction of 2026-09-03). Those sheets came off
 * the printer approved, with a name in ลงชื่อพนักงาน, and a blank where the
 * person who actually pressed the button belongs. HR read that blank as a bug
 * rather than as a statement, which is the answer that decides it: the column
 * names the person who approved the request, and there was one.
 *
 * SO THE RULE IS THREE STEPS, IN ORDER, AND THE ORDER IS THE WHOLE OF IT:
 *
 *   1. `approve_mgr` — the หัวหน้า step, whenever the entry has one. This is
 *      still first and still wins, and that was asked about explicitly: on an
 *      ordinary พนักงาน's sheet the หัวหน้า signs and ฝ่ายบุคคล confirm after
 *      them, and the column keeps naming the หัวหน้า. Taking simply the LAST
 *      approval would rewrite every ordinary sheet in the database to say
 *      ฝ่ายบุคคล, which is the reading HR rejected.
 *   2. `submit_proxy` on a filing that SKIPPED the หัวหน้า step — the
 *      หัวหน้า who typed the form in, printed as the signature of the step
 *      they did not have to press a second button to make. Asked for on
 *      2026-09-09 in those words: ให้ขึ้นชื่อคนที่กดบันทึก OT แทนด้วย
 *      เหมือนหัวหน้ากดอนุมัติแล้วปกติ.
 *
 *      THE FILING IS THE SIGNATURE HERE, and that is this system's own rule
 *      rather than a generous reading of one. `initialStatus` sends a proxy
 *      filing straight past รอหัวหน้า to รอ HR PRECISELY BECAUSE the person
 *      who typed it is the person who would have signed that step — see
 *      [proxySkipsOwnApproval] in lib/proxyFiling.js — and it writes the
 *      reason onto the row it created: `SKIP_NOTE`, which says หัวหน้างาน
 *      เป็นผู้บันทึกแทนและเป็นผู้อนุมัติขั้นหัวหน้าของรายการนี้เอง. Both
 *      screens have always read it that way — the reviewer's warn box says
 *      เพราะผู้บันทึกคือผู้ที่จะอนุมัติเอง ระบบจึงข้ามขั้นนั้นมา, and
 *      `SignatureFacts` prints ข้ามขั้นหัวหน้า — ผู้บันทึกคือผู้อนุมัติเอง
 *      in the หัวหน้างานอนุมัติ cell. The PAPER was the one document that
 *      did not: it fell through to step 3 and printed ฝ่ายบุคคล in the
 *      หัวหน้างาน column of a row ฝ่ายบุคคล never signed that step of, or
 *      printed nothing at all while the row still waited at รอ HR.
 *
 *      READ OFF THE NOTE, NOT OFF `submit_proxy` ALONE, because a proxy
 *      filing does not always stand in for that step. Two of the branches
 *      above it in `initialStatus` also land at รอ HR with nobody having
 *      signed anything, and the one a proxy filing can reach is
 *      `hrHeadsDepartment` — แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์, whose
 *      หัวหน้างาน IS ฝ่ายบุคคล by rule. There the first signature is still
 *      to come and the box must stay blank until it is made. Those branches
 *      write no note, deliberately (`skipped` stays false, and each says so
 *      in its own comment), so the note is the only thing on the row that
 *      tells 'the filer signed by filing' from 'nothing was passed over'.
 *      Under `proxySkipsOwnApproval: false` nothing is skipped at all: every
 *      proxy filing waits at รอหัวหน้า for a real `approve_mgr`, and step 1
 *      prints it.
 *   3. `approve_hr` or `submit_hr_verified` — but ONLY where neither step
 *      above happened. These are the rows that reach อนุมัติ without a หัวหน้า
 *      signature at all, and there are two ways in: a บทบาท whose
 *      `APPROVED_BY` row is empty (ฝ่ายบุคคล, ผู้ดูแลระบบ, การเงิน,
 *      ผู้จัดการฝ่าย) files straight to the ฝ่ายบุคคล step, and ฝ่ายบุคคล
 *      filing off the fingerprint scanner approves in the same act. On both,
 *      the person who pressed อนุมัติ is ฝ่ายบุคคล, and their name is what the
 *      column now carries.
 *
 * The เฉพาะฝ่ายบุคคล box at the foot of the sheet is unchanged and is not this:
 * it is a rule to sign by hand, it always was, and it is the SECOND signature
 * on a two-signature entry. Printing a name here does not fill it in.
 *
 * WHAT STILL PRINTS BLANK, and each of these exists on prod today:
 *
 *   - a request nobody has approved yet — still at รอหัวหน้า, or at รอ HR
 *     having got there without step 2's note on it. No signature of any kind,
 *     and an unsigned box is what an unsigned form looks like;
 *   - an entry whose approval predates `byName` — `{ name: null }`, printed
 *     blank rather than as a plausible guess. Read off the ROW and not off the
 *     name, so an old `approve_mgr` carrying no name stays step 1 and does not
 *     fall through to ฝ่ายบุคคล's signature underneath it.
 *
 * `adminOverride` rows are step 1 and carry the administrator's own name. ADM
 * has no หัวหน้า, an administrator signed that step as themselves, and the
 * reason they could is on the row (`approvalPermission` refuses the decision
 * without one). Somebody signed the หัวหน้า step and this is who.
 *
 * THE LAST ONE OF ITS STEP, not the first, for the reason `lastDecision` above
 * takes the last: a request can be refused, corrected and signed again, and the
 * signature that stands is the one that stands now.
 *
 * THE การอนุมัติ LIST IN THE POP-UP DOES NOT GROW A ROW FOR STEP 2, and that
 * is not the paper and the screen disagreeing. `approvalSteps` lists BUTTON
 * PRESSES, and on a skipped filing no อนุมัติ button was pressed by anybody —
 * adding a row there would be the system claiming an approval that did not
 * happen, which is the exact lie [proxySkipsOwnApproval] exists to refuse. The
 * screens say it in the words they already had: `SignatureFacts` prints
 * ข้ามขั้นหัวหน้า — ผู้บันทึกคือผู้อนุมัติเอง in the หัวหน้างานอนุมัติ cell,
 * and the filing row carries `SKIP_NOTE` in the full trail.
 *
 * Pure. The name is kept as it was recorded — ฝ่ายบุคคล share one login, so the
 * name that prints for step 3 is an account rather than a person, which is true
 * of every record this system keeps of that desk and is not something this
 * function is in a position to improve.
 */
const HR_STEP_SIGNATURES = new Set(['approve_hr', 'submit_hr_verified']);

/**
 * A proxy filing that WAS the หัวหน้า step — step 2 above.
 *
 * The note and not the action, and not the status either: `toStatus` is
 * `pending_hr` on the departments ฝ่ายบุคคล heads as well, where nobody has
 * signed anything yet. `SKIP_NOTE` is written by exactly one branch, the one
 * whose whole reason is that the filer would have signed this step.
 */
const isOwnApprovalFiling = (h) => h?.action === 'submit_proxy' && h?.note === SKIP_NOTE;

export function managerSignature(entry) {
  const history = entry?.history || [];
  const last = (matches) => {
    for (let i = history.length - 1; i >= 0; i--) if (matches(history[i])) return history[i];
    return null;
  };
  const signed = last((h) => h?.action === 'approve_mgr')
    || last(isOwnApprovalFiling)
    || last((h) => HR_STEP_SIGNATURES.has(h?.action));
  if (!signed) return null;
  return {
    name: signed.byName || null,
    /**
     * Kept although F-HR-027 does not print it (HR asked for the name alone on
     * 2026-09-02, so the 19mm column stays one line). It is the minute the
     * pop-up shows beside the same row — `ApprovalSteps` for a signature,
     * `EntryHistory` for a step-2 filing — and returning half a signature from
     * a function called `managerSignature` is how the other half gets read from
     * somewhere else later.
     */
    at: signed.at || null,
  };
}
