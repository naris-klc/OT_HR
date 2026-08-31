/**
 * What changed on a roster row — the trail ทะเบียนพนักงาน did not have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS SEPARATELY FROM THE ENTRY HISTORY
 *
 * Every OT figure in this system can already be traced: `history` on the entry
 * records who filed it, who signed it, and what it said before anybody rewrote
 * it. None of that covers the roster. A department moved on the ทะเบียน screen
 * changes which report a person's future hours land in; a company moved there
 * restates which payroll file EVERY month of theirs has ever belonged to (see
 * `companyOf` in src/config/companies.js — the sheet reads today's value). The
 * entry that ends up in the wrong file has a spotless history: nothing was ever
 * done to it. The change was made somewhere the entry cannot see.
 *
 * So the roster gets a record of its own, and it is append-only for the reason
 * PolicyVersion is: a trail that can be rewritten answers no question that
 * matters. Every field on the model is `immutable`, so it is mongoose refusing
 * the restatement rather than a convention every future route has to keep.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NEVER IN IT
 *
 * A password. Not the new one, not the old one, not a hash of either, and not a
 * length. `AUDITED_FIELDS` is an allowlist, not a denylist, which is the whole
 * of the guarantee: a field added to the Employee schema next year appears in
 * this trail only when somebody puts it in that array, so the failure mode is a
 * change that goes unrecorded rather than a secret that gets recorded. A reset
 * is a boolean on the record — `passwordReset` — with no value slot for anybody
 * to fill in later.
 *
 * This file is pure on purpose: it takes two plain objects and returns an
 * array, so `node --test` can pin the password rule without opening a database.
 */

/**
 * The fields worth a row in the trail, and the only fields that can produce one.
 *
 * `code` is here because Admin can now change it and that is the single most
 * consequential edit the screen offers. `email` is here because it is an
 * identifier too. `passwordHash`, `mustChangePassword` and the mongoose
 * bookkeeping are deliberately absent — the first must never be recorded, and
 * the other two are consequences of an action already on the record.
 */
export const AUDITED_FIELDS = Object.freeze([
  'code', 'name', 'email', 'position', 'birthDate', 'department', 'role', 'company', 'active',
  /**
   * Not a fact about the person — a change to who may sign for whom. It earns a
   * row here for exactly that reason: "why could that หัวหน้า approve this in
   * March" is a question about authority, and an authority that changed with no
   * record of who changed it cannot be answered afterwards.
   */
  'approvesCompany',
  /**
   * The other half of the same authority, and the half that reaches furthest:
   * เซ็นให้บริษัท narrows a หัวหน้า inside one department, this hands them a
   * whole one. "Who let somebody in ผลิต sign for สำนักงาน in March" is exactly
   * the question above with a different noun.
   */
  'approvesDepartments',
]);

/** What each field is called where a person reads it. */
export const FIELD_LABEL = Object.freeze({
  code: 'รหัสพนักงาน',
  name: 'ชื่อ-สกุล',
  email: 'อีเมล',
  position: 'ตำแหน่ง',
  birthDate: 'วันเกิด',
  department: 'แผนก',
  role: 'บทบาท',
  company: 'บริษัท',
  active: 'สถานะการใช้งาน',
  approvesCompany: 'เซ็นให้บริษัท',
  approvesDepartments: 'แผนกที่คุมเพิ่ม',
});

/**
 * The three fields whose figures reach accounting, named once.
 *
 * The ทะเบียน screen warns before saving any of them and the trail marks them
 * afterwards, and both read this list rather than each carrying their own copy
 * — a warning that has drifted out of step with what is actually flagged is
 * worse than no warning, because it is the one people learn to trust.
 *
 * `role` is on it for the narrow case only — employee ↔ manager changes who
 * appears on the birthday check and who may file at all. See the warning copy
 * in components/AdminView.jsx, which spells out what each one does.
 */
export const ACCOUNTING_SENSITIVE = Object.freeze(['department', 'company', 'role']);

/**
 * The reason a birthday correction writes onto every entry it moves.
 *
 * A constant for the reason `HR_VERIFIED_NOTE` in lib/birthdayFiling.js is one:
 * it is the sentence ประวัติรายการ shows beside an approved figure that changed
 * without anybody pressing approve again, and a sentence typed in two places is
 * a sentence that will one day read two ways.
 *
 * IT IS ALSO WHAT MAKES THE REPLAY LEGAL. `recomputeEntries` refuses to touch a
 * signed-off entry unless the caller says why — the note is the required half
 * of the escape hatch, not decoration. Here the system supplies it because the
 * "why" is not a judgement anybody has to type: the roster edit that triggered
 * it IS the reason, and it is already in ประวัติการแก้ทะเบียน with the old date
 * and the new one on it.
 */
export const BIRTHDATE_REPLAY_NOTE = 'แก้วันเกิดในทะเบียนพนักงาน '
  + '— ระบบคำนวณใบที่เกี่ยวข้องใหม่ตามวันหยุดวันเกิดที่เปลี่ยนไป';

/**
 * One value as the trail stores it: a string, or null for "not set".
 *
 * ObjectIds and populated documents both arrive here — `employee.department` is
 * an id before a save and a document after a `populate()` — and a trail holding
 * `[object Object]` for half its rows is a trail nobody can read. Booleans
 * become 'true'/'false' rather than being left as booleans so that `from` and
 * `to` have one type throughout and a reader never has to ask.
 */
export function auditValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'boolean') return String(raw);
  /**
   * A LIST — `approvesDepartments`, the only one so far. Each element through
   * this same function, then SORTED and joined.
   *
   * Sorted because the trail records what changed, and the order of a set is
   * not a fact about anybody's authority: a form that returns the same three
   * departments in a different order must not file a row saying HR changed who
   * this person signs for. Empty becomes null — the same "not set" every other
   * empty value here becomes, so a หัวหน้า with no extra departments reads the
   * same in the trail as one who never had any.
   *
   * A mongoose array reaches this too, and `Array.isArray` is true for one, so
   * it lands here rather than in the object branch below (which would take its
   * `_id`, a field an array does not have, and fall through to a `String()` of
   * the whole thing).
   */
  if (Array.isArray(raw)) {
    const ids = raw.map(auditValue).filter(Boolean).sort();
    return ids.length ? ids.join(',') : null;
  }
  // A populated department, or any mongoose document: its id is the value the
  // field actually holds. `_id` before `toString()`, because a document's own
  // toString() is not the id.
  if (typeof raw === 'object') {
    if (raw._id != null) return String(raw._id);
    return String(raw);
  }
  return String(raw);
}

/**
 * before → after, one row per field that actually moved.
 *
 * Only `AUDITED_FIELDS`, and only fields PRESENT in `after`: a PATCH that never
 * mentioned `position` has not cleared it, and a diff that read the absence as a
 * change to null would file a row saying HR deleted something nobody touched.
 * The routes hand in the values they are about to write, so "present" here means
 * "the request said something about this field".
 *
 * Returns `[]` when nothing moved — which the callers treat as "write no audit
 * row at all", the same rule the entry history follows for a `before` snapshot
 * that matches its after.
 */
export function rosterChanges(before = {}, after = {}) {
  const changes = [];
  for (const field of AUDITED_FIELDS) {
    if (!(field in after)) continue;
    const from = auditValue(before?.[field]);
    const to = auditValue(after[field]);
    if (from === to) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/** Did this edit touch anything the accounting sheets read? */
export const touchesAccounting = (changes = []) => changes
  .some((c) => ACCOUNTING_SENSITIVE.includes(c.field));

/**
 * Is this an edit worth a record at all?
 *
 * A reset with no field changes is — "HR set a new password for this account"
 * is the event. An edit that changed nothing is not: the ทะเบียน table saves on
 * blur, so tabbing through a row without typing would otherwise file a row
 * saying somebody edited it. Same rule as `figuresMoved` in lib/policyVersion.js
 * and for the same reason: a log padded with non-events is one nobody reads,
 * and the change that mattered is then invisible in the noise.
 */
export const worthRecording = ({ changes = [], passwordReset = false } = {}) => (
  changes.length > 0 || Boolean(passwordReset)
);
