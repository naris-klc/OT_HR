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
