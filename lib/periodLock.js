/**
 * ปิดงวด — a month that has been sent to accounting stops moving.
 *
 * HR's answer, 2026-08-13, to a gap that had been open since the beginning:
 * ฝ่ายบุคคล could correct an approved entry at any time, including months after
 * the figure had been exported and paid. Nothing in the system said a month was
 * finished, so nothing could refuse to change it, and the file on the accounts
 * team's desk and the rows in this database could drift apart silently and
 * permanently.
 *
 * THE RULES, in HR's words: ปิดแล้วปิดเลย. If HR later needs a correction, an
 * administrator opens the period again — deliberately, with a reason, on the
 * record.
 *
 * WHY A WHOLE PERIOD AND NOT ONE ENTRY. Unlocking a single row would leave a
 * month that is "closed except for three entries", which is a state nobody can
 * describe to an auditor and which makes every figure in that month a question
 * — is this one of the three? A period is closed or it is not, and reopening it
 * is a visible event with a reason attached that must be closed again
 * afterwards.
 *
 * PURE. Every function here takes the lock document and the counts it needs and
 * returns a refusal or null. Nothing reads the database; lib/periodLockQuery.js
 * does that and calls these. The point is that the rule which decides whether a
 * signed-off month may change can be tested exhaustively without a Mongo.
 */
import { periodLabel } from './api.js';

/** ฝ่ายบุคคล close a month — they are the ones who send it to accounting. */
export const CLOSE_ROLES = Object.freeze(['hr', 'admin']);

/**
 * Only an administrator reopens one, and that asymmetry is the whole design.
 *
 * If the role that closes a month can also open it, closing is a preference
 * rather than a control: the same person who decided the month was finished can
 * decide it is not, on their own, with nobody else involved. Splitting the two
 * means a correction to a closed month always passes through a second person.
 *
 * It is the same shape as `authorizeReplay` in lib/policyVersion.js, which is
 * admin-only for the same reason — both are the paths by which a figure that
 * has been signed off can move.
 */
export const REOPEN_ROLES = Object.freeze(['admin']);

/** The period a work date belongs to. The entry model stamps the same slice. */
export const periodOf = (workDate) => String(workDate || '').slice(0, 7);

/**
 * 'YYYY-MM', and a real month — '2026-13' is not one.
 *
 * Here rather than in the route files it validates, because a `route.js` under
 * the App Router may only export HTTP methods and Next's own config keys; a
 * shared helper exported from one and imported by its siblings is a build
 * error waiting for whoever runs `next build`.
 */
export const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p ?? ''));

/** A period with no lock document has never been closed. */
export function isPeriodClosed(lock) {
  return lock?.state === 'closed';
}

/**
 * "งวด สิงหาคม 2569 ปิดแล้ว" — the refusal, or null when the month is open.
 *
 * `verb` is what the caller was trying to do, in Thai, so the sentence reads as
 * an answer to the button that was pressed rather than as a general statement
 * about the month: แก้ไข, ยกเลิก, อนุมัติ, ไม่อนุมัติ, บันทึกรายการย้อนหลัง.
 *
 * 409 rather than 403 throughout. The caller has the right to do this; the
 * month is in a state where it cannot be done. That distinction is the
 * difference between "you are not allowed" — which sends somebody to ask for a
 * role they do not need — and "not while this is closed", which sends them to
 * the person who can open it.
 */
export function lockRefusal({ lock, period, verb = 'แก้ไข' }) {
  if (!isPeriodClosed(lock)) return null;
  const label = periodLabel(period || lock?.period);
  return {
    status: 409,
    error: `งวด ${label} ปิดแล้ว จึง${verb}ไม่ได้ — หากจำเป็นต้องแก้ ให้ผู้ดูแลระบบเปิดงวดก่อน`,
  };
}

/**
 * May this person close this period, and is it in a state that can be closed?
 *
 * `pendingCount` is what makes this more than a role check. A month closed
 * while requests are still waiting for a signature strands them completely:
 * they cannot be approved, cannot be refused, and cannot be withdrawn, because
 * every one of those paths goes through a lock check. The employee who filed
 * them sees them sitting in their history forever and nobody can act.
 *
 * So the refusal names the number, and HR clears the queue first. It is not a
 * warning to be clicked through: the alternative to refusing is a month that
 * has to be reopened by an administrator to fix a mistake that the system could
 * have declined to make.
 */
export function closeRefusal({
  user, lock, pendingCount = 0, openWithdrawalCount = 0, period,
}) {
  if (!CLOSE_ROLES.includes(user?.role)) {
    return { status: 403, error: 'ปิดงวดได้เฉพาะฝ่ายบุคคลและผู้ดูแลระบบ' };
  }
  if (isPeriodClosed(lock)) {
    return { status: 409, error: `งวด ${periodLabel(period)} ปิดอยู่แล้ว` };
  }
  if (pendingCount > 0) {
    return {
      status: 409,
      error: `งวด ${periodLabel(period)} ยังมีใบค้างอนุมัติ ${pendingCount} ใบ — `
        + 'ต้องอนุมัติหรือไม่อนุมัติให้ครบก่อนจึงจะปิดงวดได้',
    };
  }
  /**
   * ขอถอนใบที่ยังไม่มีใครตอบ — blocked for EXACTLY the reason pending requests
   * are, and it is the same failure wearing different clothes.
   *
   * A withdrawal request lives on an entry that is `approved`, so it passes the
   * count above without being noticed. But `withdraw/decide` refuses a closed
   * month like every other write path, so closing over an open request strands
   * it permanently: it cannot be granted, cannot be refused, and the employee
   * who asked watches it sit there. The only way out is an administrator
   * reopening the month — which is the mistake this function exists to decline
   * to make.
   *
   * Its own clause and its own sentence rather than being folded into
   * `pendingCount`, because the two are cleared by different people doing
   * different things: the first by approving a queue, this one by answering a
   * question somebody asked. A single number covering both would name a total
   * that matches neither screen.
   */
  if (openWithdrawalCount > 0) {
    return {
      status: 409,
      error: `งวด ${periodLabel(period)} ยังมีคำขอถอนใบค้างพิจารณา ${openWithdrawalCount} คำขอ — `
        + 'ต้องอนุมัติหรือไม่อนุมัติให้ครบก่อนจึงจะปิดงวดได้ '
        + '(ปิดไปแล้วจะไม่มีใครตอบคำขอได้อีก)',
    };
  }
  return null;
}

/**
 * What HR should look at before closing — the things that do NOT block.
 *
 * The distinction this function exists to hold is worth stating plainly,
 * because the temptation is to make everything a refusal:
 *
 *   A REFUSAL is for a state that closing would STRAND — a request nobody can
 *   answer afterwards. There are two, and both are above.
 *
 *   A WARNING is for a state that is finished but worth a second look. An entry
 *   flagged `capExceeded` has been approved; its hours are real, its status is
 *   final, and closing the month does not trap it. Refusing to close over one
 *   would also contradict `capBehaviour: 'warn'`, which is the policy's own
 *   answer that an over-cap request goes through carrying a flag — HR approving
 *   it IS the decision. Blocking would mean the only way to close a month is to
 *   press ยกเว้นเพดาน on every flagged row, which turns a deliberate policy
 *   choice into paperwork.
 *
 * Returns a list of `{ kind, count, text }`, empty when there is nothing to
 * say. A list rather than a sentence because the screen prints them as separate
 * lines and the count is what makes each one actionable.
 */
export function closeWarnings({ capExceededCount = 0, belowMinimumCount = 0 } = {}) {
  const out = [];
  if (capExceededCount > 0) {
    out.push({
      kind: 'capExceeded',
      count: capExceededCount,
      text: `มีใบที่เกินเพดานของแผนก ${capExceededCount} ใบ — อนุมัติไปแล้วและยังไม่ได้บันทึกการยกเว้นเพดาน`,
    });
  }
  if (belowMinimumCount > 0) {
    out.push({
      kind: 'belowMinimum',
      count: belowMinimumCount,
      text: `มีใบที่ต่ำกว่าเกณฑ์ขั้นต่ำ ${belowMinimumCount} ใบ — บันทึกชั่วโมงไว้ตามจริงแล้ว`,
    });
  }
  return out;
}

/**
 * May this person reopen it, and did they say why?
 *
 * The reason is required and stored, because a reopened month is the one case
 * where a figure that was signed off, exported and possibly paid is allowed to
 * change. "Why" is the only part of that event which cannot be reconstructed
 * afterwards from the entries themselves.
 */
export function reopenRefusal({ user, lock, reason, period }) {
  if (!REOPEN_ROLES.includes(user?.role)) {
    return { status: 403, error: 'เปิดงวดที่ปิดแล้วได้เฉพาะผู้ดูแลระบบ' };
  }
  if (!isPeriodClosed(lock)) {
    return { status: 409, error: `งวด ${periodLabel(period)} ยังไม่ได้ปิด` };
  }
  if (!String(reason || '').trim()) {
    return { status: 400, error: 'กรุณาระบุเหตุผลในการเปิดงวดที่ปิดแล้ว' };
  }
  return null;
}

/**
 * The statuses that count as "still waiting" when deciding whether a period can
 * be closed.
 *
 * Approved, refused and withdrawn are all finished — a month full of refusals is
 * a month that has been dealt with. Only the two waiting states block.
 */
export const PENDING_STATUSES = Object.freeze(['pending_mgr', 'pending_hr']);

/**
 * One line describing where a period stands, for the screen and for the API.
 *
 * Built here rather than in the component so that the settings screen, the
 * monthly review and any refusal message describe the same state in the same
 * words.
 */
export function lockSummary(lock, period) {
  const label = periodLabel(period || lock?.period);
  if (!lock) return { closed: false, text: `งวด ${label} ยังเปิดอยู่ — ยังไม่เคยปิด` };
  if (isPeriodClosed(lock)) {
    return {
      closed: true,
      text: `งวด ${label} ปิดแล้วโดย ${lock.closedByName || '—'}`,
    };
  }
  return {
    closed: false,
    text: lock.reopenedAt
      ? `งวด ${label} ถูกเปิดอีกครั้งโดย ${lock.reopenedByName || '—'} — ปิดใหม่เมื่อแก้เสร็จ`
      : `งวด ${label} ยังเปิดอยู่`,
  };
}
