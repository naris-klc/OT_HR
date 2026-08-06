import mongoose from 'mongoose';
import { model } from './model.js';
import bcrypt from 'bcryptjs';
import { COMPANY_KEYS, DEFAULT_COMPANY, companyFromCode } from '../config/companies.js';

export const ROLES = ['employee', 'manager', 'hr', 'admin'];

/**
 * พนักงาน. Every employee belongs to exactly one department and reports to
 * that department's manager (§9).
 *
 * §12: `admin` is the fourth role, new in v1.
 *
 * Managers are NOT eligible to submit OT (§2) — that is enforced in
 * src/routes/entries.js, which removes the "who approves the manager"
 * problem entirely.
 */
const employeeSchema = new mongoose.Schema(
  {
    /** รหัสพนักงาน, e.g. PM-0412. The payroll-facing identifier. */
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    /** ชื่อ-สกุล as it should print on F-HR-027. */
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    position: { type: String, trim: true },

    /**
     * วันเกิด, 'YYYY-MM-DD'. A string for the same reason Holiday.date is one:
     * a birthday is a calendar date, not an instant, and a Date would let the
     * server's timezone move it a day either way.
     *
     * HR master data — the employee sees it on their profile but cannot change
     * it; only Admin can, on the พนักงาน screen. Nothing in the OT arithmetic
     * or on F-HR-027 reads it.
     */
    birthDate: {
      type: String,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD'],
    },

    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    role: { type: String, enum: ROLES, default: 'employee', required: true },

    /**
     * Which legal entity pays this person — the two file their payroll
     * separately. Nothing in the OT arithmetic depends on it.
     *
     * Stored rather than derived from `code`: the prefix convention is a
     * convention, and a roster that departs from it must not quietly move
     * somebody's hours onto the other company's payroll. See the pre-validate
     * hook below for how it is filled in when nobody says.
     */
    // No schema `default`: mongoose applies defaults at construction, which
    // would make the hook below unable to tell "nobody said" from "they said
    // Primus" — and every Themtech hire created without the field would file
    // under Primus.
    company: { type: String, enum: COMPANY_KEYS, required: true },

    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/**
 * Fill `company` in from the code prefix when the caller did not say — PM…
 * is Primus, THT… is Themtech. Non-roster accounts (HR-001, ADMIN) match
 * neither and fall back to DEFAULT_COMPANY; Admin can see and correct any of it
 * in the บริษัท column on the พนักงาน screen.
 */
employeeSchema.pre('validate', function inferCompany() {
  if (!this.company) this.company = companyFromCode(this.code) || DEFAULT_COMPANY;
});

employeeSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
};

employeeSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

/** Managers do not submit OT (§2). */
employeeSchema.methods.maySubmitOt = function maySubmitOt() {
  return this.role === 'employee';
};

export default model('Employee', employeeSchema);
