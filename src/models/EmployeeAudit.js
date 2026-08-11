import mongoose from 'mongoose';
import { model } from './model.js';
import { AUDITED_FIELDS } from '../../lib/rosterAudit.js';

/**
 * Every change ever made to a roster row, kept.
 *
 * Append-only in the same sense otPolicyVersions is, and by the same mechanism:
 * every field is `immutable`, so mongoose refuses a write that would restate a
 * record rather than leaving it to whoever writes the next route to remember.
 * There is no update path here and no method offering one.
 *
 * Its own collection rather than an array on the Employee document, which is
 * where the entry history lives on OtEntry. The two are not the same shape of
 * problem: an entry's history is bounded (a request is filed, signed and done
 * with), while a roster row lives for as long as the person does and would grow
 * an unbounded array inside a document that every single request loads through
 * `requireAuth`. A separate collection also survives the one thing an embedded
 * array cannot — the row being deleted — which is exactly when somebody starts
 * asking what happened to it.
 *
 * See lib/rosterAudit.js for what may appear in `changes`, and for why a
 * password can never be one of the things that does.
 */
const changeSchema = new mongoose.Schema(
  {
    /** One of AUDITED_FIELDS — the allowlist, so a password has no way in. */
    field: { type: String, required: true, enum: [...AUDITED_FIELDS] },
    /**
     * Both sides as strings, or null for "not set". An ObjectId, a boolean and a
     * date all end up here (see `auditValue`), and a column whose type depends
     * on which field the row is about is one no screen can print uniformly.
     */
    from: { type: String, default: null },
    to: { type: String, default: null },
  },
  { _id: false },
);

const employeeAuditSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, immutable: true, index: true,
    },
    /**
     * The code as it stood when this was written — denormalised for the reason
     * `history.byName` on OtEntry is, plus one this record has and that one does
     * not: the code itself is now editable, so a trail that resolved the pointer
     * to print it would relabel its own history the moment somebody renumbers an
     * account. The row that RECORDS the renumbering would be the first to lie.
     */
    employeeCode: { type: String, immutable: true },
    employeeName: { type: String, immutable: true },

    /**
     * What happened, not which fields moved — that is `changes`.
     *
     * 'create'  — the row was added, from the form or a CSV row
     * 'update'  — an existing row was edited
     * 'password_reset' — ตั้งรหัสผ่านใหม่ and nothing else
     *
     * A reset that arrives alongside field edits is an 'update' carrying
     * `passwordReset: true`, so one request stays one record. Two rows for one
     * save would make the trail count edits that never happened separately.
     */
    action: {
      type: String, enum: ['create', 'update', 'password_reset'], required: true, immutable: true,
    },

    /**
     * Where the write came from. A CSV import can rewrite a hundred rows from
     * one click, and a trail that made those look like a hundred deliberate
     * edits on the ทะเบียน screen would send whoever is reading it looking for a
     * hundred decisions that were really one.
     */
    source: { type: String, enum: ['form', 'import'], default: 'form', immutable: true },

    changes: { type: [changeSchema], default: [], immutable: true },

    /**
     * ตั้งรหัสผ่านใหม่ happened. A boolean, with no value slot beside it — not a
     * `changes` entry with `from`/`to` left blank, because a blank pair is a
     * shape somebody can later decide to fill in. The password itself is never
     * written here, never hashed into here, and its length is not recorded
     * either. See lib/rosterAudit.js.
     */
    passwordReset: { type: Boolean, default: false, immutable: true },

    /**
     * Why — required by the route only for a รหัสพนักงาน change, free text
     * otherwise. That is the one edit whose consequences are not visible from
     * the row it was made on, so it is the one the record has to be able to
     * explain on its own.
     */
    reason: { type: String, immutable: true },

    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', immutable: true },
    /** Denormalised, so a trail stays readable after the actor leaves. */
    byName: { type: String, immutable: true },
    byRole: { type: String, immutable: true },
  },
  // No `updatedAt`: a document that cannot be updated has no such date, and
  // carrying an empty one invites somebody to fill it in.
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'otEmployeeAudits' },
);

/** The trail for one person, newest first — what the ทะเบียน screen prints. */
employeeAuditSchema.statics.forEmployee = function forEmployee(employeeId, limit = 100) {
  return this.find({ employee: employeeId }).sort({ createdAt: -1 }).limit(limit).lean();
};

export default model('EmployeeAudit', employeeAuditSchema);
