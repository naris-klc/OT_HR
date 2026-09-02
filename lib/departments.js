/**
 * WHO MAY WRITE แผนก, AND THE ONE FIELD THAT IS NOT THEIRS.
 *
 * A pure rule in its own file, for the reason `rosterPermission` is one: the
 * department row is written by two handlers (`POST /api/departments` and
 * `PATCH /api/departments/[id]`) and drawn by a third place that greys out what
 * cannot be pressed. A rule spelled out in three places is a rule that will be
 * right in two of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ฝ่ายบุคคล MAY NOW CREATE A DEPARTMENT
 *
 * `POST` was ผู้ดูแลระบบ-only from the first commit, with no comment saying so
 * and no commit that decided it — it arrived with the file. `PATCH` was never
 * restricted the same way, so the split that actually shipped was: HR may rename
 * a department, renumber it, move its ceilings, change its รูปแบบโอที and switch
 * it off — but not add one. The screen offered them the เพิ่มแผนก button anyway
 * and answered 403 when they pressed it.
 *
 * Creating a department changes no figure that exists. It is an empty row until
 * somebody is moved into it, at which point the move itself is the roster edit
 * that HR already makes. So it goes where the rest of the day's work is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `active` DOES NOT, IN EITHER DIRECTION
 *
 * `active: false` is the removal this system reaches for FIRST, and until
 * 2026-09-02 it was the only one there was. This paragraph read "there is no
 * DELETE handler for a department and there must not be one", and the reason it
 * gave has not changed one word: `OtEntry.department` is a required reference
 * set when the request was filed (the แผนก is snapshotted onto the entry ON
 * PURPOSE, so a mid-month transfer leaves the hours where they were worked),
 * and `groupByDepartment` in lib/departmentSummary.js spells out what a deleted
 * row costs — every entry that pointed at it collapses into one unnamed
 * 'ไม่ระบุแผนก' bucket, for good, together with every other department ever
 * deleted. Switching a department off keeps all of that intact and simply takes
 * it out of the pickers.
 *
 * WHAT CHANGED IS NOT THE REASON, IT IS WHO THE REASON APPLIES TO. Every word
 * above is about a department that something POINTS AT. A row created with a
 * typo in its code five minutes ago, that no employee has ever belonged to and
 * that no entry has ever named, costs none of it — deleting that changes no
 * figure, empties no queue and renames nothing in any report, because there is
 * nothing on the other end of the reference to rename. It was the one case the
 * blanket refusal could not tell apart, and it left every mistyped department
 * on the screen for ever, switched off, in a list of eight.
 *
 * So the refusal moved from the handler to the DATA, where it can be checked
 * instead of assumed: `departmentDeleteBlock` below is the whole rule, the
 * route counts what points at the row and asks it, and the screen asks the same
 * question through the same function before it offers to delete anything. A
 * department that anything references still cannot be deleted, by anybody, ever
 * — which is what the old paragraph was protecting.
 *
 * That still empties queues and stops submissions, which is why it is Admin's:
 * it is the closest thing to deletion anybody can press, and it is pressed from
 * a table where the switch sits two columns from a ceiling that HR edits daily.
 *
 * BOTH DIRECTIONS, and this is the part worth stating rather than leaving to be
 * inferred. If HR could switch a department off but not back on, the refusal
 * would arrive one step too late to be any use — after the department was
 * already off, with the repair needing somebody who may be at lunch. A control
 * that is one-way is a trap wearing the costume of a safeguard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `{ ok: true }`, or `{ ok: false, status, error }` ready for the route to
 * return — the shape `rosterPermission` and `editPermission` both use.
 */

/** Who is on the ตั้งค่าระบบ → แผนกและเพดาน screen at all. */
export const DEPARTMENT_ROLES = ['hr', 'admin'];

/**
 * May this person write this department row — and set `active` to this value.
 *
 * @param actor    the authenticated user
 * @param active   what the request is asking `active` to become, or null/undefined
 *                 for "not mentioned in this request". A create passes nothing:
 *                 `POST` does not accept the field and a new row is active.
 * @param current  `active` as the stored row has it. Absent means a row that
 *                 does not exist yet, which is treated as active — the value the
 *                 schema default gives it a moment later.
 */
export function departmentPermission(actor, { active = null, current = null } = {}) {
  if (!actor) return { ok: false, status: 401, error: 'ไม่ได้เข้าสู่ระบบ' };
  if (!DEPARTMENT_ROLES.includes(actor.role)) {
    return { ok: false, status: 403, error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' };
  }
  if (actor.role === 'admin') return { ok: true };

  // Not mentioned. Every other field on the row is HR's.
  if (active === null || active === undefined) return { ok: true };

  /**
   * A payload REPEATING the value it already has is not a change and is not
   * refused — the same courtesy `selfEditPermission` and `codeChangePermission`
   * extend, and needed for the same reason: the edit dialog sends the whole row
   * back, so a save that only moved a ceiling still carries `active` at its
   * current value, and refusing that would make HR unable to edit any field on
   * any department.
   *
   * `!== false` on both sides rather than `=== true`: the stored value is a
   * schema default that a row written before the field existed may not carry at
   * all, and `undefined` there means active.
   */
  if (Boolean(active) === (current !== false)) return { ok: true };

  return {
    ok: false,
    status: 403,
    error: Boolean(active)
      ? 'เปิดใช้งานแผนกที่ปิดไว้ ทำได้โดยผู้ดูแลระบบเท่านั้น'
      : 'ปิดใช้งานแผนก ทำได้โดยผู้ดูแลระบบเท่านั้น — เป็นวิธีเดียวที่จะเอาแผนกซึ่งมีประวัติแล้ว'
        + 'ออกจากระบบ พนักงานในแผนกจะยื่น OT ไม่ได้และแผนกจะหายจากช่องเลือกทุกที่ '
        + '· ชื่อ รหัส เพดาน หัวหน้า และรูปแบบโอที ฝ่ายบุคคลแก้ได้ตามปกติ',
  };
}

/**
 * THE HEADLINE THE SCREEN AND THE ROUTE BOTH SAY, word for word.
 *
 * Exported rather than written out twice: the dialog says it when the button is
 * pressed and the route says it when the request arrives, and those are two
 * chances for the same refusal to be worded two ways. The advice at the end of
 * it is the whole point of the sentence — a refusal that only refuses leaves
 * somebody with a department they cannot get rid of and no idea what to do.
 */
export const DEPARTMENT_DELETE_BLOCKED =
  'ไม่สามารถลบแผนกนี้ได้เนื่องจากมีข้อมูลประวัติในระบบ '
  + 'แนะนำให้เปลี่ยนสถานะเป็น “ปิดใช้งาน” แทน';

/**
 * May a department row be REMOVED, given what points at it.
 *
 * PURE, AND IT COUNTS NOTHING ITSELF. The caller does the counting and this
 * decides — which is what lets the screen ask the question before it offers the
 * button and the route ask it again before it acts, off one rule rather than
 * two readings of one paragraph. `GET /api/departments/[id]` answers the first
 * and `DELETE` the second; the route re-counts on the way through, so a screen
 * holding a stale answer cannot get past it.
 *
 * BOTH COUNTS ARE ALL-TIME, not "active" ones. An employee who left the company
 * still has a row and that row still names this department; an entry from 2024
 * still resolves its แผนก label through it. `headcount` on the table is a count
 * of ACTIVE employees and is the wrong number for this question — it reads zero
 * for a department whose whole team was deactivated last year.
 *
 * @param employees  rows in `employees` naming this department, any state
 * @param entries    rows in `otentries` naming it, any status, any month
 * @returns null when there is nothing in the way, or `{ status, error, employees,
 *          entries }` ready for the route to return and for the dialog to read.
 */
export function departmentDeleteBlock({ employees = 0, entries = 0 } = {}) {
  if (!employees && !entries) return null;
  const held = [
    employees ? `พนักงาน ${employees} คน` : null,
    entries ? `ใบ OT ${entries} ใบ` : null,
  ].filter(Boolean).join(' · ');
  return {
    status: 409,
    error: `${DEPARTMENT_DELETE_BLOCKED} (${held})`,
    employees,
    entries,
  };
}

/**
 * WHO MAY DELETE, and it is the narrower of the two lines this file draws.
 *
 * ผู้ดูแลระบบ, the same as `active` — and for a reason that survives the guard
 * above rather than duplicating it. `departmentDeleteBlock` already promises
 * that nothing can be deleted while anything points at it, so the worst a wrong
 * press can do is remove an empty row somebody meant to keep. That is cheap and
 * it is also IRREVERSIBLE: there is no undo, and recreating the row gives it a
 * new id. Switching a department off is one press to undo; this is not, and the
 * line between the two is exactly that.
 *
 * ฝ่ายบุคคล see the button, greyed, with the reason on it — the same treatment
 * the สถานะ badge gets in the table, and for the same reason: a control that
 * vanishes for one role teaches that role the feature does not exist.
 */
export function departmentDeletePermission(actor) {
  if (!actor) return { ok: false, status: 401, error: 'ไม่ได้เข้าสู่ระบบ' };
  if (actor.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: 'ลบแผนก ทำได้โดยผู้ดูแลระบบเท่านั้น — ลบได้เฉพาะแผนกที่ยังไม่มีพนักงาน'
        + 'และไม่มีใบ OT ใดอ้างถึง และลบแล้วเรียกคืนไม่ได้',
    };
  }
  return { ok: true };
}
