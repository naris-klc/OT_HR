/**
 * Shared helpers for the /api/entries routes.
 *
 * Express kept these at the bottom of one 359-line router file. The App Router
 * splits that router across a directory tree, so they live here instead — the
 * logic is unchanged.
 */

export const POPULATE = [
  { path: 'employee', select: 'code name position role' },
  { path: 'department', select: 'code name nameTh monthlyCapHours' },
  /**
   * One hop only, and only the fields the banner on the review screen needs:
   * which request this replaced, when it was for, and why it was refused.
   *
   * Shallow on purpose — the full chain is its own endpoint. A list of 500
   * rows must not drag an unbounded ancestry behind it, and mongoose resolves
   * this path in one extra query for the whole page however many rows carry it.
   */
  /**
   * One hop, but a complete one: enough of the replaced request to draw its
   * whole block in the trail — its own history, and the entered fields the
   * child's are diffed against.
   *
   * One hop is all there is. The re-filing rule caps a chain at parent →
   * child (see refileState), so a parent can never have a parent of its own;
   * the trail endpoint's deeper walk stays only for data written before that
   * rule existed.
   */
  {
    path: 'refiledFrom',
    select: 'workDate startTime endTime endsNextDay noBreakTaken description '
      + 'status rejectionReason totals history refiledFrom',
  },
];

/**
 * Is there anything to open a history drawer for?
 *
 * Two separate reasons, and the second is the one that was missing: a request
 * filed to replace a refused one carries a single `submit` of its own, so
 * counting its history alone reports "nothing here" on precisely the entries
 * with the most to explain — the refusal that produced them lives in the
 * parent document.
 */
export function hasAuditTrail(entry) {
  if (!entry) return false;
  if (entry.refiledFrom) return true;
  return (entry.history?.length || 0) > 1;
}

/**
 * Whether a refused request may be filed again, said in one word.
 *
 *   null     — not refused. Nothing to re-file.
 *   'open'   — refused once, and this is the employee's one chance to correct
 *              it. The button shows.
 *   'used'   — the chance was taken; a replacement exists. Locked.
 *   'final'  — this request WAS the replacement, and it was refused too. The
 *              matter is closed; a new OT request starts from a blank form.
 *
 * Derived from the two pointers rather than counted in a field of its own.
 * A `resubmitCount` would be a second account of the same fact, and the day it
 * disagreed with the chain there would be no way to tell which one was lying.
 * It also makes the two-level ceiling structural instead of a rule somebody
 * has to remember to check: a request that already has a parent can never
 * acquire a child, so a chain is at most parent → child. Full stop.
 *
 * Deliberately NOT new `status` values. `rejected` is what the workflow and
 * every rollup query mean by "this one is closed and its hours do not count",
 * and all three states below are still exactly that. Splitting the enum would
 * mean auditing every status filter in the codebase — reports, cap usage,
 * queue counts — to add two values that change none of their answers.
 */
export function refileState(entry) {
  if (!entry || entry.status !== 'rejected') return null;
  if (entry.refiledFrom) return 'final';
  return entry.resubmittedTo ? 'used' : 'open';
}

/**
 * One row per line of filing — the request that is live now, not the one it
 * replaced.
 *
 * A refusal is answered by a NEW document rather than by reopening the old one
 * (see refileState), so a month legitimately holds two entries for the same
 * Tuesday evening: the request that was refused, and the correction that
 * answers it. No total was ever confused by that — every rollup filters on
 * status and `rejected` is in none of the lists. A table is: ตรวจสอบรายเดือน
 * lists whatever the entry query returns, so the same evening appears twice,
 * once closed and once live, and HR reading down a month has to work out for
 * themselves which pairs are pairs.
 *
 * So the replaced request comes off the table — and only when its replacement
 * is IN THE SAME SET. Testing `resubmittedTo` alone would be the easier rule
 * and it is the wrong one: a re-filing may carry a corrected วันที่ that moves
 * it into the next month, or fall outside `limit`, and hiding a refusal whose
 * replacement is nowhere on screen would take it off the record with nothing
 * left pointing at it. As written, a row can only ever be folded into one that
 * is present — and that row's drawer draws both, so nothing is lost by it.
 *
 * NOT the superseded-filing rule in lib/reports.js. That one is about one
 * session being filed twice by mistake and only the newest counting. This is a
 * refusal and the answer to it — a chain the employee built on purpose.
 *
 * Returns both sides. A row taken off a screen has to be nameable, exactly as
 * the superseded filings are.
 */
export function latestPerChain(entries) {
  const replaced = new Set();
  for (const entry of entries) {
    const parent = parentIdOf(entry);
    if (parent) replaced.add(parent);
  }

  const shown = [];
  const hidden = [];
  for (const entry of entries) {
    (replaced.has(String(entry._id)) ? hidden : shown).push(entry);
  }
  return { shown, hidden };
}

/** `refiledFrom` is a bare id on a raw document and a document once populated. */
function parentIdOf(entry) {
  const ref = entry?.refiledFrom;
  if (!ref) return null;
  return String(ref._id || ref);
}

/** Role scoping (§2): own / own department / everything. */
export function scopeFor(user) {
  if (user.role === 'employee') return { employee: user._id };
  if (user.role === 'manager') return { department: user.department?._id };
  return {}; // hr, admin
}

/**
 * Who may rewrite a stored entry, and until when.
 *
 * Two callers, and the line between them is the first signature on the entry.
 * The employee owns the request until a manager has looked at it: while it is
 * `pending_mgr` nobody has approved anything, so a correction changes only
 * what the manager is about to read, and no reason is owed. Once the manager
 * approves, the entry carries a decision made against particular hours and the
 * employee is out — from there it is HR's to correct, at any live status, with
 * a reason recorded. Rejected and cancelled are closed to both.
 *
 * Returns `{ ok: true, action }` — the history action the caller earns — or
 * `{ ok: false, error, status }` ready to hand to `fail()`.
 */
export function editPermission(user, entry, note = '') {
  const isOwner = String(entry.employee?._id || entry.employee) === String(user._id);
  const closed = ['rejected', 'cancelled'].includes(entry.status);

  if (['hr', 'admin'].includes(user.role)) {
    if (closed) {
      return { ok: false, status: 409, error: 'รายการที่ไม่อนุมัติหรือยกเลิกแล้ว แก้ไขไม่ได้ ให้พนักงานส่งใหม่' };
    }
    if (!String(note || '').trim()) {
      return { ok: false, status: 400, error: 'กรุณาระบุเหตุผลการแก้ไข' };
    }
    return { ok: true, action: 'hr_edit' };
  }

  if (isOwner && user.role === 'employee') {
    if (entry.status !== 'pending_mgr') {
      return {
        ok: false,
        status: 409,
        error: closed
          ? 'รายการที่ไม่อนุมัติหรือยกเลิกแล้ว แก้ไขไม่ได้ — กด “ส่งใหม่” เพื่อยื่นคำขอใหม่'
          : 'รายการที่อนุมัติแล้ว แก้ไขเองไม่ได้ — ติดต่อฝ่ายบุคคลเพื่อแก้ไข',
      };
    }
    return { ok: true, action: 'edit' };
  }

  return {
    ok: false,
    status: 403,
    error: 'แก้ไขได้เฉพาะรายการของตนเองที่ยังรอหัวหน้าอนุมัติ หรือโดยฝ่ายบุคคล',
  };
}

/**
 * The fields an employee fills in — everything an edit can rewrite, and so
 * everything a `history.before` snapshot has to be compared on.
 *
 * The computed hours are deliberately not here: they follow from these fields
 * and from the policy, so a change in them alone is a recompute, not an edit.
 */
export const ENTERED_FIELDS = Object.freeze([
  'workDate', 'startTime', 'endTime', 'endsNextDay', 'noBreakTaken', 'description',
]);

/**
 * Compare one entered field across two versions of an entry.
 *
 * A stored entry and a freshly-parsed payload disagree about shape more than
 * about content: `endsNextDay` is `false` on one side and missing on the other,
 * a description is `''` or absent. Neither difference is an edit.
 */
export function sameValue(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a ?? '') === String(b ?? '');
}

/**
 * True when an edit left every entered field as it found it.
 *
 * Opening แก้ไข and pressing บันทึก without touching anything is a no-op that
 * the history should not dress up as a correction — storing a `before`
 * identical to the state after it would bury the real edits under empty ones.
 */
export function sameSession(a, b) {
  if (!a || !b) return false;
  return ENTERED_FIELDS.every((k) => sameValue(a[k], b[k]));
}

export function pickSession(body) {
  return {
    workDate: String(body.workDate || '').slice(0, 10),
    startTime: normaliseTime(body.startTime),
    endTime: normaliseTime(body.endTime),
    endsNextDay: Boolean(body.endsNextDay),
    noBreakTaken: Boolean(body.noBreakTaken),
  };
}

function normaliseTime(t) {
  const s = String(t || '').trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

export function stampCap(entry, cap) {
  entry.capExceeded = Boolean(cap?.exceeded);
  entry.capSnapshot = cap
    ? { capHours: cap.capHours, usedHoursBefore: cap.usedHoursBefore, basis: cap.basis }
    : undefined;
}
