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
  {
    path: 'refiledFrom',
    select: 'workDate startTime endTime status rejectionReason refiledFrom',
  },
];

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
