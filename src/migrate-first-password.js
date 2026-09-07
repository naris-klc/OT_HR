/**
 * One-off repair: บัญชีที่ยังไม่เคยมีใครเข้า และถือรหัสสุ่มที่ไม่มีใครรู้ ให้กลับมา
 * เป็นรหัสพนักงานของตัวเอง
 *
 * Run: npm run migrate:first-password   (--dry to see the plan and change
 *                                        nothing, --yes to write)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Nothing, in the code. `defaultPassword()` has issued the employee's own
 * รหัสพนักงาน from every path that hands out a password since `91612a9`,
 * 2026-09-02 14:36 — but the rows written BEFORE that commit hold the output of
 * `generateTempPassword()`, a random string that was printed once on the screen
 * of whoever created them and stored nowhere.
 *
 * The seam is invisible from the ทะเบียน screen, so what HR sees is that some
 * new accounts log in with their code and some do not. Two rows of the SAME CSV
 * import demonstrate it: `PM00416` and `THT0079` were written 0.1 seconds apart
 * at 13:21 on 2026-09-02 — 75 minutes before the commit — and both got a random
 * password. `PM00416` works today only because somebody pressed รีเซ็ตรหัสผ่าน
 * on it afterwards; `THT0079` was never pressed and cannot be logged into at
 * all.
 *
 * Pressing the button four times would fix this database. This exists because
 * the same seam is waiting in every backup taken before that date and in any
 * other copy of this roster — and because "press the button on the ones that do
 * not work" requires first knowing which ones do not, which is a bcrypt compare
 * per row and not something anybody can do from a screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT THE "RESET ANYBODY" SCRIPT reset-admin REFUSES TO BE
 *
 * src/reset-admin-password.js turns down exactly this shape of power in its
 * header: a script that would reset any account "turns 'has a shell on this
 * server' into 'is any employee', which is the shortest route to a หัวหน้า's
 * signature". That refusal stands, and this script is not a hole in it, because
 * of the second half of the selection rule below.
 *
 * A row is touched only when BOTH are true:
 *
 *   1. `mustChangePassword` is still true — nobody has ever set their own
 *      password on this account. The flag is cleared by exactly one route,
 *      POST /api/employees/me/password, which requires the CURRENT password.
 *      So a false flag means the person holding the account proved they had it.
 *   2. The stored hash does NOT already accept `defaultPassword(code)` — the
 *      password on the row is one nobody can look up.
 *
 * An account somebody actually uses fails (1). An account already on the
 * current rule fails (2) and is left alone rather than re-hashed, so a second
 * run writes nothing. What is left is the set of accounts that CANNOT BE LOGGED
 * INTO BY ANYONE — nobody's access is taken over, because nobody has any.
 *
 * The value it writes is public by design (README §รหัสผ่านแรกเข้า): it is
 * printed on every ใบ F-HR-027. Writing it changes an account from "locked to
 * everybody" to "guessable until its owner changes it", which is the trade HR
 * asked for on 2026-09-02, and `mustChangePassword` stays true so the reminder
 * strip keeps saying so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT REACH
 *
 * The 13 rows `npm run seed` wrote hold the shared `SEED_PASSWORD` and have
 * `mustChangePassword: false`, because the seed never set it. They therefore
 * fail rule (1) and this script skips them — deliberately. They are development
 * rows on a development password (README §บัญชีที่ seed ไว้), `ADMIN` among
 * them, and quietly turning ADMIN's password into the string `ADMIN` is not a
 * thing a migration gets to decide. If those need moving, that is a separate
 * decision and a separate run.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { connect, disconnect } from './db.js';
import Employee from './models/Employee.js';
import { defaultPassword } from '../lib/employees.js';
import { recordRosterChange } from '../lib/rosterAuditLog.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

const REASON = 'ตั้งรหัสผ่านแรกเข้าเป็นรหัสพนักงาน — บัญชีถูกสร้างก่อน 2026-09-02 '
  + 'จึงยังถือรหัสสุ่มที่ไม่มีใครรู้ (npm run migrate:first-password)';

/**
 * May this row be repaired — and if not, why not.
 *
 * Pure and exported so both halves of the rule are testable without a database,
 * the same split `refusalFor` uses in src/reset-admin-password.js. `accepts` is
 * passed in rather than computed here because the bcrypt compare is the slow
 * part and belongs where the rows are being walked, not inside the rule.
 */
export function repairRefusal(employee, accepts) {
  if (!employee) return 'ไม่พบแถวนี้';
  if (!employee.mustChangePassword) {
    return 'เจ้าของบัญชีตั้งรหัสผ่านของตัวเองไปแล้ว (หรือเป็นแถวที่ seed เขียน) — ไม่แตะ';
  }
  if (accepts) return 'รหัสพนักงานใช้เข้าได้อยู่แล้ว';
  return null;
}

async function run() {
  await connect();

  const rows = await Employee.find({})
    .select('+passwordHash code name role active mustChangePassword createdAt')
    .sort({ createdAt: 1 });

  const plan = [];
  const skipped = [];
  for (const employee of rows) {
    const accepts = await bcrypt.compare(defaultPassword(employee.code), employee.passwordHash);
    const refusal = repairRefusal(employee, accepts);
    if (refusal) skipped.push({ employee, refusal });
    else plan.push(employee);
  }

  console.log(`ทะเบียนพนักงานทั้งหมด ${rows.length} แถว`);
  console.log(`  เข้าด้วยรหัสพนักงานได้อยู่แล้ว หรือเจ้าของตั้งรหัสเองแล้ว: ${skipped.length}`);
  console.log(`  ต้องแก้: ${plan.length}`);

  if (!plan.length) {
    console.log('\nไม่มีอะไรต้องทำ — ทุกบัญชีที่ยังไม่เคยมีใครตั้งรหัสเอง เข้าได้ด้วยรหัสพนักงานของตัวเองแล้ว');
    await disconnect();
    return;
  }

  console.log('\nบัญชีที่จะตั้งรหัสผ่านใหม่เป็นรหัสพนักงานของตัวเอง:');
  for (const e of plan) {
    const day = new Date(e.createdAt).toISOString().slice(0, 10);
    const off = e.active ? '' : '  (ปิดใช้งานอยู่)';
    console.log(`  ${e.code}\t${e.role}\tสร้าง ${day}\t${e.name}${off}`);
    console.log(`    รหัสผ่านใหม่: ${defaultPassword(e.code)}`);
  }

  if (dryRun) {
    console.log('\n--dry: ไม่ได้บันทึกอะไรลงฐานข้อมูล');
    await disconnect();
    return;
  }
  if (!confirmed) {
    console.log('\nรันซ้ำด้วย --yes เพื่อบันทึกจริง (หรือ --dry เพื่อดูอย่างเดียว)');
    await disconnect();
    process.exitCode = 1;
    return;
  }

  for (const employee of plan) {
    const issued = defaultPassword(employee.code);
    /**
     * Hashed first, written second — the split `hashPassword`/`setPassword`
     * exists for on the routes, and it costs nothing to honour here: the slow
     * call happens while a failure is still free, and the write is one field.
     *
     * A targeted `updateOne` rather than `employee.save()`, for the reason
     * PATCH /api/employees/:id gives: the document was loaded for a password
     * check, not put through the validators a full save would run, and a row
     * that fails validation on some unrelated field it has held for a month
     * must not be the reason its owner still cannot log in.
     */
    const passwordHash = await Employee.hashPassword(issued);
    await Employee.updateOne(
      { _id: employee._id },
      { $set: { passwordHash, mustChangePassword: true } },
    );
    // `source: 'script'` — the one value with no session behind it, which is
    // what tells a reader of บันทึกระบบ that the empty `by` is the truth and
    // not a lost actor. Same value reset-admin writes, for the same reason.
    const logged = await recordRosterChange({
      employee,
      action: 'password_reset',
      passwordReset: true,
      reason: REASON,
      actor: null,
      source: 'script',
    });
    console.log(`  ${employee.code}\tตั้งรหัสผ่านเป็น ${issued}${logged ? '' : '  ⚠ บันทึกประวัติไม่สำเร็จ'}`);
  }

  /**
   * VERIFIED AGAINST THE RECORD, NOT AGAINST THE INTENTION — re-read from the
   * database and compared through bcrypt, the same call the login route makes.
   * A row that did not take has to be visible in the run that caused it.
   */
  const after = await Employee.find({ _id: { $in: plan.map((e) => e._id) } })
    .select('+passwordHash code mustChangePassword');
  const stillWrong = [];
  for (const e of after) {
    const ok = await bcrypt.compare(defaultPassword(e.code), e.passwordHash);
    if (!ok || !e.mustChangePassword) stillWrong.push(e.code);
  }

  if (stillWrong.length) {
    console.log(`\n⚠ ยังเข้าไม่ได้ ${stillWrong.length} บัญชี: ${stillWrong.join(', ')}`);
    console.log('  อย่าเพิ่งถือว่าแก้เสร็จ');
    process.exitCode = 1;
  } else {
    console.log(`\nตรวจแล้ว: ทั้ง ${after.length} บัญชีเข้าด้วยรหัสพนักงานของตัวเองได้ และยังติดธงให้เปลี่ยนรหัส`);
  }

  await disconnect();
}

/**
 * Only when run as a command. The line seed, backup, restore, reset-admin and
 * the other migrations carry — and for the reason spelled out in
 * src/migrate-birthday-rule-start.js: `--yes` answers "did the operator mean
 * this run", never "is there an operator", and this file writes credentials.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async (err) => {
    console.error(err);
    await disconnect();
    process.exitCode = 1;
  });
}
