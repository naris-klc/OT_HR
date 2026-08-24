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
 * `active: false` is the only removal this system has — there is no DELETE
 * handler for a department and there must not be one. `OtEntry.department` is a
 * required reference set when the request was filed (the แผนก is snapshotted
 * onto the entry ON PURPOSE, so a mid-month transfer leaves the hours where they
 * were worked), and `groupByDepartment` in lib/departmentSummary.js already
 * spells out what a deleted row costs: every entry that pointed at it collapses
 * into one unnamed 'ไม่ระบุแผนก' bucket, for good. Switching a department off
 * keeps all of that intact and simply takes it out of the pickers.
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
      : 'ปิดใช้งานแผนก ทำได้โดยผู้ดูแลระบบเท่านั้น — เป็นการลบแผนกอย่างเดียวที่ระบบนี้มี '
        + 'พนักงานในแผนกจะยื่น OT ไม่ได้และแผนกจะหายจากช่องเลือกทุกที่ '
        + '· ชื่อ รหัส เพดาน หัวหน้า และรูปแบบโอที ฝ่ายบุคคลแก้ได้ตามปกติ',
  };
}
