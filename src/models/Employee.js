import mongoose from 'mongoose';
import { model } from './model.js';
import bcrypt from 'bcryptjs';
import { COMPANY_KEYS, DEFAULT_COMPANY, companyFromCode } from '../config/companies.js';

// The seven บทบาท and their Thai names live in lib/roles.js, which the BROWSER
// can import and this file is not — see the note at the top of that file.
import { ROLES } from '../../lib/roles.js';

/**
 * พนักงาน. Every employee belongs to exactly one department and reports to
 * that department's manager (§9).
 *
 * §12: `admin` is the fourth role, new in v1.
 *
 * Managers are NOT eligible to submit OT (§2) — that is enforced in
 * app/api/entries/route.js, which removes the "who approves the manager"
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

    /**
     * WHICH COMPANY'S PEOPLE THIS หัวหน้า MAY SIGN FOR. Null — the default, and
     * the state of every row until somebody says otherwise — is ทุกบริษัท: the
     * behaviour this system had before the field existed.
     *
     * Read ONLY for role 'supervisor', and only alongside the department rule it
     * narrows. A หัวหน้า signs for their own department, and — once this is set
     * — only for the people in it whom this company pays. Two หัวหน้า can
     * therefore share one แผนก and split it by payroll without the department
     * itself being duplicated, which would split the ceiling and the
     * สรุป OT แยกแผนก row along with it.
     *
     * Three arrangements, one field: nobody set means one หัวหน้า covers both
     * payrolls, everybody set means each covers their own, and a mixture is
     * what a company part-way through the change actually looks like.
     *
     * A department where no scope covers a company is a department whose people
     * on that payroll cannot be signed for. Deliberately visible rather than
     * papered over with a fallback: ผู้รับช่วงอนุมัติ already answers "somebody
     * must cover this team today", it expires on its own, and it records whose
     * authority was used.
     *
     * Left in place when somebody stops being a หัวหน้า, and inert while they
     * are not one — the same value means the same thing if they are appointed
     * again, and nothing else reads it.
     */
    approvesCompany: { type: String, enum: [...COMPANY_KEYS, null], default: null },

    /**
     * WHICH OTHER แผนก THIS หัวหน้า SIGNS FOR — the ones beyond their own.
     *
     * A หัวหน้า has always signed for exactly one department: their own
     * (`isDepartmentManager` compares `user.department` with the entry's). That
     * is right for four of the five departments on this roster and wrong for the
     * fifth — ADM has three people and no หัวหน้า at all, so a holiday OT filed
     * there waits at รอหัวหน้า with nobody who can clear it. The only two
     * answers before this field were to move somebody's แผนก (which moves their
     * own hours, their ceiling and their report row with them) or to keep
     * renewing a ผู้รับช่วงอนุมัติ, which is a window that closes by design.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * EXTRAS ONLY. THEIR OWN DEPARTMENT IS NOT IN HERE.
     *
     * The full set is `[department, ...approvesDepartments]`, assembled by
     * `approvalDepartments` in lib/entries.js and nowhere else. Storing the home
     * department here as well would be storing a fact twice, and the copy goes
     * stale the first time HR moves somebody: a หัวหน้า moved from ผลิต to
     * วิศวกรรม would keep signing for ผลิต — for a team they are no longer on —
     * because a list written last year still named it. Derived, that cannot
     * happen; the scope follows the person.
     *
     * It also means the ordinary row stores NOTHING. Empty is the state of every
     * หัวหน้า on the roster today and reads as exactly the behaviour this system
     * had before the field existed, so nobody's authority moves until somebody
     * ticks a box.
     *
     * NARROWED BY `approvesCompany` JUST THE SAME, and by the one value — a
     * scope is a property of the SIGNATURE, not of each team it reaches. A
     * หัวหน้า who signs only for เดมเทค signs only for เดมเทค in every department
     * they cover. Per-department payroll scopes would be the same field again in
     * a second shape, and the arrangement that would need it (two departments
     * split differently by company, one signer for both) has not been asked for.
     *
     * Read ONLY for role 'supervisor', like `approvesCompany`, and left in place
     * when somebody stops being one for the same reason: the same list means the
     * same thing if they are appointed again.
     *
     * No `ref` validation that the department still exists — a deleted แผนก
     * leaves an id that matches nothing, which grants nothing. Failing closed is
     * the whole reason this is a list of grants rather than a list of exclusions.
     */
    approvesDepartments: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
      default: () => [],
    },

    passwordHash: { type: String, required: true, select: false },

    /**
     * The password on this account was set by somebody else.
     *
     * True from the moment HR creates the account or resets its password, false
     * again the moment the person holding it sets their own (POST
     * /api/employees/me/password). While it is true the client lets the account
     * do exactly one thing: change the password.
     *
     * Defaults false, so nobody already on the roster is asked to re-do
     * something they did months ago — this marks passwords HR issued from here
     * on, not every password whose history is unknown.
     */
    mustChangePassword: { type: Boolean, default: false },

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

/**
 * A hash, computed and handed back rather than assigned to anything.
 *
 * For the caller that must not write the password until everything else about
 * the request has already succeeded — see the reset in
 * app/api/employees/[id]/route.js. `setPassword` puts the value on the document,
 * and a document with a new hash on it is one stray `save()` away from being
 * committed by unrelated code further down the handler; this leaves the caller
 * holding a string and nothing else, so the moment of no return is the line that
 * writes it and not the line that generates it.
 *
 * The cost of `bcrypt.hash` is why it is worth separating at all: it is the
 * slowest thing in the request, so it happens up front while a failure is still
 * free, and the write at the end is a single field update.
 */
/**
 * THE ONE PLACE A PASSWORD BECOMES BYTES, and why it normalises first.
 *
 * bcryptjs takes the JS string, encodes it UTF-8 and hashes those bytes — which
 * is correct and is not the hazard. The hazard is that two Thai strings that
 * are the same word, look identical on any screen and were typed on the same
 * keyboard can be different byte sequences:
 *
 *   ก + ุ (below vowel) + ่ (tone)   U+0E01 U+0E38 U+0E48
 *   ก + ่ (tone) + ุ (below vowel)   U+0E01 U+0E48 U+0E38
 *
 * The marks have different combining classes, so Unicode says these are the
 * same text and NFC puts them in one order — but bcrypt is hashing bytes, so
 * without this line the second spelling is a wrong password with nothing on
 * screen to show for it. That is exactly the สระ/วรรณยุกต์เพี้ยน failure, and
 * it is invisible from both ends: the person sees their own password refused
 * and ฝ่ายบุคคล sees a correct password that does not work.
 *
 * Latin, digits and punctuation are unaffected — NFC is the identity on all of
 * them, so nothing about the employee-code default or any existing ASCII
 * password moves.
 */
const canonical = (plain) => String(plain ?? '').normalize('NFC');

employeeSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(canonical(plain), 10);
};

employeeSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await this.constructor.hashPassword(plain);
};

/**
 * Verify, and accept a password stored before the line above existed.
 *
 * The raw string is tried FIRST, which is what keeps this change incapable of
 * locking anybody out: any hash written before 2026-09-02 was made from
 * un-normalised bytes, and if somebody's stored password happens to be in a
 * non-canonical order then the raw compare is the one that matches it — exactly
 * as it did yesterday.
 *
 * The second compare runs only when normalising actually CHANGED the string,
 * which it never does for ASCII and rarely does for Thai. So the ordinary login
 * pays for one bcrypt compare as before, and the only request that pays for two
 * is one that would otherwise have been refused.
 */
employeeSchema.methods.verifyPassword = async function verifyPassword(plain) {
  const raw = String(plain ?? '');
  if (await bcrypt.compare(raw, this.passwordHash)) return true;
  const nfc = canonical(raw);
  return nfc === raw ? false : bcrypt.compare(nfc, this.passwordHash);
};

/**
 * EVERY บทบาท FILES ITS OWN OT — since 2026-09-03, and this is a reversal.
 *
 * It read `this.role === 'employee'` and its doc line read "Managers do not
 * submit OT (§2)". §2 existed to remove the question "who approves the
 * หัวหน้า", and the seven-บทบาท structure answers that question outright
 * instead: a หัวหน้างาน's request goes to a ผู้จัดการแผนก, whose own goes to a
 * ผู้จัดการฝ่าย, whose own goes to ฝ่ายบุคคล. See `APPROVED_BY` in
 * lib/roles.js for the whole ladder.
 *
 * So this is now true for everybody and is kept as a method rather than
 * deleted. Two reasons: `publicUser` and the filing route both ask it, and
 * "may this account file" is exactly the sort of rule that grows a condition
 * again — a contractor บทบาท, or somebody suspended. A predicate that is
 * currently always true has somewhere for that to go; a deleted one does not.
 */
employeeSchema.methods.maySubmitOt = function maySubmitOt() {
  return ROLES.includes(this.role);
};

export default model('Employee', employeeSchema);
