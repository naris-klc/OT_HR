/**
 * One-off correction: แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ are headed by
 * ฝ่ายบุคคล, and the database now says so instead of leaving it to be guessed.
 *
 * Run: npm run migrate:hr-headed   (--dry to see the plan and change nothing,
 *                                   --yes to confirm)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CHANGES ON THIS DATABASE — NOTHING, AND THAT IS THE POINT
 *
 * Both departments already routed to ฝ่ายบุคคล before `signedByHr` existed,
 * because `initialStatus` could find nobody on the roster to sign for them:
 * neither holds a หัวหน้างาน, การเงิน, ผู้จัดการแผนก or ผู้จัดการฝ่าย, and
 * nobody is ticked into either through `approvesDepartments`. Read off prod on
 * 2026-09-07, and there is not one OT entry from either department to restate.
 *
 * So no figure moves and no request re-routes. What moves is WHY: the answer
 * stops depending on who happens to be employed. Appoint a ผู้จัดการแผนกจัดซื้อ
 * tomorrow and, without this, every purchasing request silently starts waiting
 * for that signature — a routing rule changed by a roster edit, with nothing
 * anywhere saying so, and HR finding out when somebody asks why their ใบ is
 * stuck.
 *
 * It also stops ตั้งค่าระบบ calling the rule a fault. Four พนักงาน across the
 * two departments were counted as stranded by `unsignedStaff`, so both rows
 * wore ⚠ ยังไม่มีหัวหน้า with แก้ไขสิทธิ์พนักงาน ↗ beside them — a warning about
 * a state that is correct, pointing at the screen where the "fix" would be to
 * appoint somebody HR does not want appointed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SCRIPT WHEN THE DIALOG CAN SET IT
 *
 * แก้ไขแผนก → การอนุมัติ → ใครเซ็นขั้นที่ 1 writes the same field, and that is
 * the door for the nineteenth department. This exists because these two are not
 * a decision anybody is making today — they are the หน่วยงาน table being copied
 * into the system, the same act as `import-departments`, which skips rows that
 * already exist and so cannot carry a field added afterwards.
 *
 * Idempotent: a department already marked is reported and not written again.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Department from './models/Department.js';
import Employee from './models/Employee.js';
import OtEntry from './models/OtEntry.js';

/** The หัวหน้างาน column of the หน่วยงาน table, where it reads "HR". */
const HR_HEADED = ['PUR', 'HRD'];

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

async function run() {
  await connect();

  const departments = await Department.find({ code: { $in: HR_HEADED } })
    .select('code name nameTh signedByHr').lean();

  const missing = HR_HEADED.filter((c) => !departments.some((d) => d.code === c));
  if (missing.length) {
    console.log(`ไม่พบแผนกรหัส ${missing.join(', ')} — ตรวจว่า import:departments รันแล้วหรือยัง\n`);
  }

  const already = departments.filter((d) => d.signedByHr);
  const todo = departments.filter((d) => !d.signedByHr);

  for (const d of already) {
    console.log(`มีอยู่แล้ว  ${d.code.padEnd(5)} ${d.nameTh || d.name} — ฝ่ายบุคคลเป็นหัวหน้างานอยู่แล้ว`);
  }

  /**
   * WHAT THE CHANGE COULD POSSIBLY MOVE, printed BEFORE anything is written —
   * the same shape as `migrate-birthday-rule-start`, and for the same reason: a
   * migration that says "0 rows affected" after the fact is a migration nobody
   * could have refused.
   *
   * Two lists, because they are two different kinds of surprise. A request
   * waiting at รอหัวหน้า does NOT move — its status was decided when it was
   * filed and this script does not touch entries — so seeing one here is the
   * signal to go and look at it by hand. A signer sitting in the department is
   * the louder one: it means somebody IS holding the step this flag abolishes,
   * and that is a question for HR before it is a write.
   */
  const signerRoles = ['supervisor', 'finance', 'dept_manager', 'division_manager'];
  for (const d of todo) {
    const signers = await Employee.find({
      $or: [{ department: d._id }, { approvesDepartments: d._id }],
      role: { $in: signerRoles },
      active: { $ne: false },
    }).select('code name role').lean();
    const waiting = await OtEntry.countDocuments({ department: d._id, status: 'pending_mgr' });

    console.log(`จะตั้ง    ${d.code.padEnd(5)} ${d.nameTh || d.name} → ฝ่ายบุคคลเป็นหัวหน้างาน`);
    console.log(`            หัวหน้าที่เซ็นให้แผนกนี้ได้ตอนนี้: ${signers.length ? signers.map((p) => `${p.code} (${p.role})`).join(', ') : 'ไม่มี'}`);
    console.log(`            ใบที่ค้างอยู่ที่ "รอหัวหน้า": ${waiting} ใบ${waiting ? ' — ใบเหล่านี้ไม่ย้ายตาม ต้องตามดูเอง' : ''}`);
  }

  if (!todo.length) {
    console.log('\nไม่มีอะไรต้องแก้');
    await disconnect();
    return;
  }
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

  for (const d of todo) {
    await Department.updateOne({ _id: d._id }, { $set: { signedByHr: true } });
    console.log(`เขียนแล้ว ${d.code} · ${d.nameTh || d.name}`);
  }
  console.log(`\nเสร็จ — ${todo.length} แผนก`);
  await disconnect();
}

/**
 * THE ENTRY-POINT GUARD, which every script in src/ carries and this one is on
 * the list for — see `ENTRY_POINTS` in test/seedEntryPoint.test.js. Importing
 * this file must be a READ of it and not the command: a module-graph walk, a
 * test that wants `HR_HEADED`, or an editor's auto-import must not connect to
 * the database and must not write.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async (err) => {
    console.error(err);
    await disconnect();
    process.exit(1);
  });
}

export { run, HR_HEADED };
