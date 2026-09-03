/**
 * One-off rename: the บทบาท stored as `manager` becomes `supervisor`.
 *
 * Run: npm run migrate:roles   (--dry to see the plan and change nothing,
 *                               --yes to confirm)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A ROW HAS TO MOVE AT ALL
 *
 * บทบาท went from four to seven on 2026-09-03, and the new seven contain a real
 * ผู้จัดการแผนก standing one rung ABOVE หัวหน้างาน. The old `manager` meant
 * หัวหน้างาน — every comment in the repository written before that day says
 * หัวหน้า where the code said `manager`, and both Thai label maps rendered it
 * as "หัวหน้างาน" — so the string could not be kept with its old meaning beside
 * a role whose name it now reads as.
 *
 * `lib/roles.js` explains why it was retired rather than reused. The short of
 * it: a leftover comparison against the old spelling now matches nobody and
 * fails where somebody can see it, where reusing the string would have quietly
 * handed a หัวหน้างาน's queue to a ผู้จัดการแผนก.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT TOUCH, AND WHY
 *
 * `Employee.role` and nothing else. Three near neighbours are deliberately left
 * exactly as they are:
 *
 *   · **`OtEntry.history[].action`** — `approve_mgr` / `reject_mgr` name the
 *     STEP, not the signer's บทบาท. `lib/approverLine.js` reads the desk off
 *     the action precisely so a signature stays labelled with the capacity it
 *     was made in, and rewriting a decision already signed would restate the
 *     trail rather than migrate it.
 *   · **`OtEntry.status: 'pending_mgr'`** — same reason, and the same word: the
 *     first step is still the mgr step whoever ends up holding it.
 *   · **`Setting.policy.hrRejectReturnsTo: 'manager'`** — a policy value naming
 *     that step. Renaming it would need its own migration to buy nothing.
 *
 * `EmployeeAudit` rows are left alone for the reason the history is: they say
 * what the บทบาท was called on the day it was recorded, which is true, and a
 * trail that is rewritten to agree with today is not a trail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAFE TO RUN TWICE
 *
 * It matches on the old spelling, so a second run finds nothing and says so. It
 * is also safe to run against a database that never had the old spelling: the
 * count is zero and nothing is written.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Employee from './models/Employee.js';
import { ROLE_LABEL_TH } from '../lib/roles.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

/** The one spelling this script exists to remove, and what it becomes. */
const FROM = 'manager';
const TO = 'supervisor';

async function run() {
  await connect();

  /**
   * Read with `.lean()` and matched on the RAW value, not through the model's
   * enum. The enum no longer contains the old spelling, so a `find` that went
   * through validation would be asking mongoose for rows it now considers
   * impossible — which is exactly the shape of the rows this has to find.
   */
  const stale = await Employee.collection
    .find({ role: FROM })
    .project({ code: 1, name: 1, department: 1 })
    .toArray();

  if (!stale.length) {
    console.log(`ไม่มีแถวไหนที่ยังเก็บบทบาท "${FROM}" — ไม่ต้องทำอะไร`);
    await disconnect();
    return;
  }

  console.log(`พบ ${stale.length} แถวที่ยังเก็บบทบาท "${FROM}" `
    + `· จะเปลี่ยนเป็น "${TO}" (${ROLE_LABEL_TH[TO]})\n`);
  for (const p of stale) console.log(`  ${p.code} · ${p.name}`);

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

  const { modifiedCount } = await Employee.collection
    .updateMany({ role: FROM }, { $set: { role: TO } });
  console.log(`\nเปลี่ยนแล้ว ${modifiedCount} แถว`);

  const left = await Employee.collection.countDocuments({ role: FROM });
  console.log(left
    ? `เหลืออีก ${left} แถว — ลองรันซ้ำ`
    : `ไม่เหลือแถวที่เก็บ "${FROM}" อีกแล้ว`);

  await disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { run };
