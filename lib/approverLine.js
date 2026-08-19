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
    if (APPROVE_ACTIONS.has(h?.action) || REFUSE_ACTIONS.has(h?.action)) {
      return {
        action: h.action,
        approved: APPROVE_ACTIONS.has(h.action),
        byName: h.byName || null,
        onBehalfOfName: h.onBehalfOfName || null,
        // The HR account is shared by the whole department — see the note in
        // the roster. `hr` here means "somebody at ฝ่ายบุคคล", never a person,
        // and the label says the desk for that reason.
        atHr: h.action === 'approve_hr' || h.action === 'reject_hr'
          || h.action === 'submit_hr_verified',
        note: h.note || null,
        at: h.at || null,
      };
    }
  }
  return null;
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
 * @returns {{ tone, icon, text, note }|null}
 */
export function approverLine(entry, signers = null) {
  if (!entry?.status) return null;

  if (entry.status === 'approved' || entry.status === 'rejected') {
    const decision = lastDecision(entry);
    // An approved entry with no decision row is data written before the history
    // existed. "อนุมัติแล้ว" with no name is the whole truth about it.
    if (!decision) {
      return entry.status === 'approved'
        ? { tone: 'ok', icon: '✅', text: 'อนุมัติแล้ว', note: null }
        : { tone: 'no', icon: '❌', text: 'ไม่อนุมัติ', note: entry.rejectionReason || null };
    }
    const who = decision.byName
      || (decision.atHr ? 'ฝ่ายบุคคล' : null);
    const behalf = decision.onBehalfOfName ? ` (ทำแทน ${decision.onBehalfOfName})` : '';
    // The desk, when the name does not already say it. ฝ่ายบุคคล sign under one
    // shared account, so "โดย ฝ่ายบุคคล" is the honest form and adding it twice
    // would read as two different people.
    const desk = decision.atHr && who !== 'ฝ่ายบุคคล' ? ' (ฝ่ายบุคคล)' : '';
    return decision.approved
      ? {
        tone: 'ok',
        icon: '✅',
        text: who ? `อนุมัติโดย: ${who}${behalf}${desk}` : 'อนุมัติแล้ว',
        note: decision.note || null,
      }
      : {
        tone: 'no',
        icon: '❌',
        text: who ? `ปฏิเสธโดย: ${who}${behalf}${desk}` : 'ไม่อนุมัติ',
        // The reason the employee has to act on. `rejectionReason` is where the
        // refusal route stores it and the history note is the same sentence;
        // either may be the one that is filled in.
        note: entry.rejectionReason || decision.note || null,
      };
  }

  if (entry.status === 'pending_hr') {
    // No name, and not for want of looking it up: ฝ่ายบุคคล share one login, so
    // any name printed here would be an account rather than the person who will
    // read it. See the roster note about the shared account.
    return { tone: 'wait', icon: '⏳', text: 'รอการยืนยันจาก: ฝ่ายบุคคล', note: null };
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
    };
  }

  if (entry.status === 'cancelled') return null;
  return null;
}
