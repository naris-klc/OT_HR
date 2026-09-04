/**
 * ย้ายคนกับใบออกจากแผนกตัวอย่างห้าแผนก แล้วลบแผนกเปล่าทิ้ง — ครั้งเดียว.
 *
 * Run: npm run rehome:demo-roster   (--dry to see the plan and change nothing,
 *                                    --yes to confirm)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The database was seeded with 22 invented people in five invented departments
 * (`ENG` `PROD` `QC` `WH` `ADM`). The eighteen real departments arrived on
 * 2026-09-03 (`npm run import:departments`), and HR asked for the five demo
 * ones to go.
 *
 * They cannot simply be deleted: `departmentDeleteBlock` refuses a department
 * that still holds people or requests, and it is right to. HR's answer, given
 * the same afternoon, was **นobody is deleted — move them**: the demo accounts
 * stay exactly as they are apart from which แผนก they sit in, and the real
 * roster of 163 people will overwrite them on import.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ใบ MOVE TOO, WHICH IS THE ONE THING HERE THAT REWRITES HISTORY
 *
 * `OtEntry.department` is stored on the request, not read from the person at
 * report time — deliberately, so that moving somebody's แผนก changes only their
 * future filings and leaves every month already reported alone. That is exactly
 * why moving the PEOPLE is not enough here: their 22 existing requests would go
 * on pointing at the five departments, and the delete would still be refused.
 *
 * So each request is re-pointed to the department its OWNER is moving to. It is
 * a rewrite of what those rows said, and it is safe only because of what they
 * are: seeded demonstration data on a database whose real roster has not been
 * imported yet. On real hours this would be the wrong operation and the right
 * one would be to keep the department and mark it inactive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE EACH TEAM LANDS
 *
 * Whole teams move together so that each keeps the หัวหน้างาน who signs for it
 * — split them up and their requests have nobody at the first step. The pairing
 * itself is a placeholder chosen for the closest meaning, and three of the five
 * have no real counterpart at all (วิศวกรรม, ควบคุมคุณภาพ, สำนักงาน). Nothing
 * downstream depends on it: the real import replaces every one of these rows.
 *
 * The script REFUSES to write if any destination is missing, or if it cannot
 * account for every person in the five — a half-emptied department is the state
 * that leaves somebody filing into a แผนก that is about to disappear.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Department from './models/Department.js';
import Employee from './models/Employee.js';
import OtEntry from './models/OtEntry.js';
import { DEPARTMENTS } from './import-departments.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

/** แผนกตัวอย่าง → แผนกจริงที่คนทั้งทีมจะย้ายไปอยู่. */
const MOVE_TO = Object.freeze({
  ENG: 'RND',      // วิศวกรรม           → แผนกออกแบบและวิจัยผลิตภัณฑ์
  PROD: 'PROD1',   // ผลิต               → แผนกผลิต1
  QC: 'PROD2',     // ควบคุมคุณภาพ       → แผนกผลิต2
  WH: 'WH-FG',     // คลังสินค้า         → แผนกคลังสินค้าสำเร็จรูป
  ADM: 'HRD',      // สำนักงาน           → แผนกทรัพยากรมนุษย์
});

async function run() {
  await connect();

  const keepCodes = new Set(DEPARTMENTS.map((d) => d.code));
  const keepNames = new Set(DEPARTMENTS.map((d) => d.nameTh));

  const all = await Department.find().select('code name nameTh').lean();
  const byCode = new Map(all.map((d) => [d.code, d]));
  const doomed = all.filter((d) => !keepCodes.has(d.code) && !keepNames.has(d.nameTh));

  if (!doomed.length) {
    console.log('ไม่มีแผนกนอกรายชื่อจริงเหลืออยู่แล้ว — ไม่ต้องทำอะไร');
    await disconnect();
    return;
  }

  // ── every destination has to exist before anything moves ──────────────────
  const missing = doomed.filter((d) => !MOVE_TO[d.code] || !byCode.get(MOVE_TO[d.code]));
  if (missing.length) {
    console.error('หยุด — ไม่รู้ว่าจะย้ายคนของแผนกนี้ไปไหน หรือแผนกปลายทางไม่มีอยู่:');
    for (const d of missing) {
      console.error(`  ${d.code} (${d.nameTh || d.name}) → ${MOVE_TO[d.code] || '— ยังไม่ได้กำหนด —'}`);
    }
    console.error('· รัน npm run import:departments ก่อน หรือเพิ่มปลายทางใน MOVE_TO');
    await disconnect();
    process.exitCode = 1;
    return;
  }

  // ── the plan, one doomed department at a time ─────────────────────────────
  const plan = [];
  for (const from of doomed) {
    const to = byCode.get(MOVE_TO[from.code]);
    const people = await Employee.find({ department: from._id })
      .select('code name role').lean();
    const entries = await OtEntry.countDocuments({ department: from._id });
    plan.push({ from, to, people, entries });
  }

  for (const { from, to, people, entries } of plan) {
    console.log(`── ${from.code} · ${from.nameTh || from.name}`
      + `  →  ${to.code} · ${to.nameTh || to.name}`);
    console.log(`     คน ${people.length} · ใบ OT ${entries}`);
    for (const p of people) console.log(`     ${p.code.padEnd(10)}${String(p.role).padEnd(17)}${p.name}`);
  }

  const totalPeople = plan.reduce((n, p) => n + p.people.length, 0);
  const totalEntries = plan.reduce((n, p) => n + p.entries, 0);
  console.log(`\nรวม ย้ายคน ${totalPeople} · ย้ายใบ ${totalEntries} · แล้วลบ ${doomed.length} แผนก`);
  console.log('ไม่มีใครถูกลบ · ไม่แตะบันทึกประวัติระบบ ประวัติการแก้ทะเบียน วันหยุด นโยบาย');

  if (dryRun) {
    console.log('\n--dry — ไม่ได้เขียนอะไรลงฐานข้อมูล');
    await disconnect();
    return;
  }
  if (!confirmed) {
    console.log('\nยังไม่ได้เขียน — ใส่ --yes เพื่อยืนยัน (หรือ --dry เพื่อดูอย่างเดียว)');
    await disconnect();
    return;
  }

  /**
   * ใบ FIRST, THEN คน, THEN the department.
   *
   * The requests are re-pointed while their owners are still findable in the
   * department being emptied — the query that selects them is the department
   * itself, so moving the people first would leave the entries behind with
   * nothing left to identify them by.
   */
  let movedEntries = 0;
  let movedPeople = 0;
  for (const { from, to } of plan) {
    const e = await OtEntry.updateMany({ department: from._id }, { $set: { department: to._id } });
    const p = await Employee.updateMany({ department: from._id }, { $set: { department: to._id } });
    movedEntries += e.modifiedCount;
    movedPeople += p.modifiedCount;
    console.log(`ย้ายแล้ว ${from.code} → ${to.code} · คน ${p.modifiedCount} · ใบ ${e.modifiedCount}`);
  }
  console.log(`\nรวมย้าย คน ${movedPeople} · ใบ ${movedEntries}`);

  /**
   * Re-counted rather than assumed. Anything still pointing at one of these —
   * a collection this script did not think of — leaves the department in place
   * and says so, which is the same answer `departmentDeleteBlock` gives.
   */
  let dropped = 0;
  for (const { from } of plan) {
    const staffLeft = await Employee.countDocuments({ department: from._id });
    const entriesLeft = await OtEntry.countDocuments({ department: from._id });
    if (staffLeft || entriesLeft) {
      console.log(`  ⚠ ${from.code} ไม่ถูกลบ — ยังมีพนักงาน ${staffLeft} คน ใบ ${entriesLeft} ใบ`);
      continue;
    }
    await Department.deleteOne({ _id: from._id });
    dropped += 1;
  }
  console.log(`ลบแผนกแล้ว ${dropped} จาก ${doomed.length} แผนก`);

  console.log(`\nเหลือ ${await Department.countDocuments()} แผนก · `
    + `${await Employee.countDocuments()} บัญชี · ${await OtEntry.countDocuments()} ใบ`);

  await disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { run, MOVE_TO };
