/**
 * ตั้งรหัสผ่านใหม่ให้บัญชีผู้ดูแลระบบ จากเครื่องเซิร์ฟเวอร์ — the way back in.
 *
 * Run: npm run reset-admin -- ADMIN
 *
 * ── The hole this fills ─────────────────────────────────────────────────────
 *
 * ผู้ดูแลระบบ is the escalation path for ฝ่ายบุคคล and has no escalation path of
 * its own. `rosterPermission` refuses HR every write to an Admin row — the reset
 * included — so an Admin who forgets their password has nobody in the
 * application who can help them, and there is exactly one active Admin. The
 * stored hash is one-way, so the old password cannot be read back from anywhere
 * either. Before this file the only repair was a mongo shell and a hand-computed
 * bcrypt hash, which is a procedure nobody performs correctly on the afternoon
 * it is needed.
 *
 * ── Why it is safe to have ──────────────────────────────────────────────────
 *
 * It is not a wider grant than the database already gives. Whoever can run this
 * is sitting at the machine that holds `MONGODB_URI`, and anybody in that
 * position could already write the collection directly. What this adds is that
 * the repair goes through the SAME generator, the SAME `mustChangePassword`
 * flag and the SAME audit trail as every reset made from the ทะเบียน screen, so
 * a rescue leaves a record behind instead of an unexplained password change.
 *
 * ── The three limits ────────────────────────────────────────────────────────
 *
 * ADMIN ROWS ONLY. This exists so the last administrator can get back in, not
 * as a command-line way around `rosterPermission` for the rest of the roster.
 * Every other account has a path already: ฝ่ายบุคคล resets it from the screen,
 * and that path records the name of whoever pressed the button. A script that
 * would reset anybody turns "has a shell on this server" into "is any employee",
 * which is the shortest route to a หัวหน้า's signature.
 *
 * A CODE IS REQUIRED. It does not go looking for "the admin" and reset whatever
 * it finds: on a database with two that is a coin toss, and the person running
 * this is already having a bad day.
 *
 * IT PRINTS THE PASSWORD ONCE AND NOTHING STORES IT. The same one-shot reveal
 * the screen gives, for the same reason — the database holds only a hash.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Employee from './models/Employee.js';
import { codeMatcher, sameCode } from './lib/employeeCode.js';
import { generateTempPassword } from '../lib/tempPassword.js';
import { recordRosterChange } from '../lib/rosterAuditLog.js';

const USAGE = [
  'ใช้: npm run reset-admin -- <รหัสพนักงาน>',
  '',
  'ตัวอย่าง:  npm run reset-admin -- ADMIN',
  '',
  'ตั้งรหัสผ่านชั่วคราวใหม่ให้บัญชีผู้ดูแลระบบที่ระบุ แล้วพิมพ์รหัสออกมาหนึ่งครั้ง',
  'บัญชีนั้นเข้าใช้งานได้ทันที และจะเห็นแถบเตือนให้เปลี่ยนรหัสผ่านจนกว่าจะเปลี่ยนจริง',
  '',
  'ใช้ได้กับแถวที่เป็นผู้ดูแลระบบเท่านั้น — บัญชีอื่นให้ฝ่ายบุคคลตั้งรหัสใหม่จาก',
  'หน้า ตั้งค่าระบบ → พนักงาน ซึ่งบันทึกชื่อผู้กดไว้ในประวัติการแก้ทะเบียน',
].join('\n');

/**
 * The employee code out of `process.argv`, or null.
 *
 * `--` and anything starting with `-` are dropped: npm passes the separator
 * through on some shells, and a flag arriving here as a code would be looked up
 * as an employee and reported as "not found", which sends the reader off after
 * the wrong problem.
 */
export function codeFromArgs(argv = []) {
  const rest = argv.filter((a) => a !== '--' && !String(a).startsWith('-'));
  const code = String(rest[0] ?? '').trim();
  return code || null;
}

/**
 * Why this row may not be reset here — or null when it may be.
 *
 * Pure and exported so the rule is testable without a database, the same split
 * lib/seedGuard.js draws for the same reason: the caller does the querying,
 * this decides what the row means.
 */
export function adminOnlyRefusal(employee) {
  if (!employee) return null;
  if (employee.role !== 'admin') {
    return `${employee.code} · ${employee.name} ไม่ใช่บัญชีผู้ดูแลระบบ (บทบาท: ${employee.role})\n`
      + 'สคริปต์นี้ใช้กู้บัญชีผู้ดูแลระบบเท่านั้น — บัญชีอื่นให้ฝ่ายบุคคล'
      + 'ตั้งรหัสใหม่จากหน้าทะเบียนพนักงาน ซึ่งบันทึกชื่อผู้กดไว้';
  }
  if (employee.active === false) {
    return `${employee.code} · ${employee.name} ถูกปิดใช้งานอยู่ — บัญชีที่ปิดแล้วเข้าระบบไม่ได้\n`
      + 'ให้เปิดใช้งานบัญชีก่อน แล้วจึงตั้งรหัสผ่านใหม่';
  }
  return null;
}

async function run() {
  const code = codeFromArgs(process.argv.slice(2));
  if (!code) {
    console.error(USAGE);
    process.exit(1);
  }

  await connect();

  /**
   * `codeMatcher` then `sameCode`, exactly as the PATCH route resolves a code.
   * The roster holds `PM-0620` and `PM00511` shapes side by side and whoever
   * runs this is reading the code off a screen or a printed form — being
   * refused over a hyphen is the wrong failure for a recovery tool.
   */
  const matcher = codeMatcher(code);
  const found = matcher
    // `{ code: matcher }`, not `matcher` — `codeMatcher` returns the RegExp for
    // the field, exactly as the PATCH route uses it (`findOne({ code: matcher,
    // … })`). Handed to `find()` bare it is not a filter and mongoose throws.
    ? await Employee.find({ code: matcher }).select('code name role active').lean()
    : [];
  const employee = found.find((e) => sameCode(e.code, code)) || null;

  if (!employee) {
    console.error(`ไม่พบพนักงานรหัส "${code}"`);
    await disconnect();
    process.exit(1);
  }

  const refusal = adminOnlyRefusal(employee);
  if (refusal) {
    console.error(refusal);
    await disconnect();
    process.exit(1);
  }

  /**
   * Generated here and written with one targeted `updateOne`, the shape the
   * route uses and for the same reason: the document is never loaded, validated
   * and re-saved, so no unrelated field's validator can fail in between
   * deciding on a password and storing it.
   */
  const issued = generateTempPassword();
  const passwordHash = await Employee.hashPassword(issued);
  await Employee.updateOne(
    { _id: employee._id },
    { $set: { passwordHash, mustChangePassword: true } },
  );

  /**
   * `actor: null`, and the record says so rather than naming somebody.
   *
   * Every other row in otEmployeeAudits carries the account that made the
   * change. This one has no session behind it: the caller is whoever is at the
   * server console and the system has no way to know who that was. Putting a
   * name there would be an invention, and a trail that invents one field is not
   * evidence about the others. `source: 'script'` is the honest answer, and
   * ประวัติการแก้ทะเบียน prints it as "(สคริปต์บนเซิร์ฟเวอร์)".
   */
  const logged = await recordRosterChange({
    employee,
    action: 'password_reset',
    passwordReset: true,
    reason: 'ตั้งรหัสผ่านใหม่จากสคริปต์บนเซิร์ฟเวอร์ (npm run reset-admin)',
    actor: null,
    source: 'script',
  });

  console.log('');
  console.log(`ตั้งรหัสผ่านใหม่ให้ ${employee.code} · ${employee.name} แล้ว`);
  console.log('');
  console.log(`  รหัสผ่านชั่วคราว:  ${issued}`);
  console.log('');
  console.log('รหัสนี้แสดงเพียงครั้งเดียว — ฐานข้อมูลเก็บไว้เป็น hash เท่านั้น');
  console.log('ถ้าทำหาย ให้รันคำสั่งนี้ใหม่ จะได้รหัสใหม่อีกอัน');
  console.log('เข้าใช้งานได้ทันที และจะเห็นแถบเตือนให้เปลี่ยนรหัสผ่านจนกว่าจะเปลี่ยนจริง');
  if (!logged) {
    console.log('');
    console.warn('⚠ เขียนประวัติการแก้ทะเบียนไม่สำเร็จ — รหัสผ่านเปลี่ยนแล้ว '
      + 'แต่จะไม่มีบันทึกไว้ว่าเกิดขึ้น');
  }
  console.log('');

  await disconnect();
}

/**
 * Only when run as a command — the line src/seed.js, src/backup.js and
 * src/restore.js all carry. `codeFromArgs` and `adminOnlyRefusal` above are
 * imported by the test, and an import that reset a password as a side effect
 * would be the worst possible version of this file.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async (err) => {
    console.error(err.message || err);
    await disconnect().catch(() => {});
    process.exit(1);
  });
}
