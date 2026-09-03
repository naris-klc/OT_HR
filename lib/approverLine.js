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
 * THE หัวหน้างาน SIGNATURE ON ONE ENTRY — the name that prints in the
 * ลงชื่อหัวหน้างาน column of F-HR-027, and null when that column stays blank.
 *
 * `approve_mgr` AND NOTHING ELSE, which is the whole content of this function
 * and the reason it is here rather than written out at the call site. The other
 * two members of `APPROVE_ACTIONS` are ฝ่ายบุคคล's, and the sheet has a
 * separate box at its foot for that desk:
 *
 *   - `approve_hr` is the second signature. Printing it in the หัวหน้า column
 *     would put ฝ่ายบุคคล's name under a heading that says หัวหน้างาน.
 *   - `submit_hr_verified` is ฝ่ายบุคคล filing from the fingerprint scanner and
 *     approving in the same act. There IS no หัวหน้า signature on those rows —
 *     that is what the หัวหน้า's own month alert says about them in so many
 *     words — so the column is blank, and the blank is the true statement.
 *
 * `adminOverride` rows ARE included and carry the administrator's own name.
 * They are `approve_mgr`: ADM has no หัวหน้า, an administrator signed that step
 * as themselves, and the reason they could is on the row (`approvalPermission`
 * refuses the decision without one). Somebody signed the หัวหน้า step and this
 * is who.
 *
 * THE LAST ONE, not the first, for the reason `lastDecision` above takes the
 * last: a request can be refused, corrected and signed again, and the signature
 * that stands is the one that stands now.
 *
 * Pure, and it names nobody it cannot read off the row — an entry approved
 * before histories carried `byName` returns `{ name: null }` and prints blank
 * rather than a plausible guess.
 */
export function managerSignature(entry) {
  const rows = (entry?.history || []).filter((h) => h?.action === 'approve_mgr');
  const signed = rows[rows.length - 1];
  if (!signed) return null;
  return {
    name: signed.byName || null,
    /**
     * Kept although F-HR-027 does not print it (HR asked for the name alone on
     * 2026-09-02, so the 19mm column stays one line). It is what the pop-up's
     * `ApprovalSteps` already shows, and returning half a signature from a
     * function called `managerSignature` is how the other half gets read from
     * somewhere else later.
     */
    at: signed.at || null,
  };
}
