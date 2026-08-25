/**
 * One-off migration: fill `company` on employees that predate the field.
 *
 * Run: npm run migrate:company        (add --dry to see the plan and change nothing)
 *
 * The field is required from now on, so any row created before this exists
 * without one and would fail the next save. The code prefix decides — PM… is
 * Primus, THT… is Themtech — and anything matching neither is reported by name
 * rather than silently defaulted, because a wrongly-filed employee shows up as
 * a wrong subtotal on somebody's payroll and nowhere else.
 *
 * Idempotent: rows that already have a company are left exactly as they are,
 * including ones an Admin has corrected by hand.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Employee from './models/Employee.js';
import { DEFAULT_COMPANY, companyFromCode, companyLabel } from './config/companies.js';

const dryRun = process.argv.includes('--dry');

async function run() {
  await connect();

  const pending = await Employee.find({
    $or: [{ company: { $exists: false } }, { company: null }, { company: '' }],
  }).select('code name company').lean();

  if (!pending.length) {
    console.log('ไม่มีพนักงานที่ยังไม่ได้กำหนดบริษัท — ไม่ต้องทำอะไร');
    await disconnect();
    return;
  }

  const matched = [];
  const guessed = [];
  const writes = [];

  for (const employee of pending) {
    const derived = companyFromCode(employee.code);
    const company = derived || DEFAULT_COMPANY;
    (derived ? matched : guessed).push({ ...employee, company });
    writes.push({
      updateOne: { filter: { _id: employee._id }, update: { $set: { company } } },
    });
  }

  const tally = new Map();
  for (const row of [...matched, ...guessed]) {
    tally.set(row.company, (tally.get(row.company) || 0) + 1);
  }

  console.log(`พบ ${pending.length} คนที่ยังไม่ได้กำหนดบริษัท`);
  for (const [key, count] of tally) console.log(`  ${companyLabel(key)}: ${count} คน`);

  if (guessed.length) {
    console.log(`\nรหัสไม่ตรงรูปแบบบริษัทใด ตั้งเป็น "${DEFAULT_COMPANY}" ไว้ก่อน — โปรดตรวจสอบในหน้า ตั้งค่าระบบ → พนักงาน:`);
    for (const row of guessed) console.log(`  ${row.code}  ${row.name}`);
  }

  if (dryRun) {
    console.log('\n--dry: ไม่ได้บันทึกอะไรลงฐานข้อมูล');
    await disconnect();
    return;
  }

  // bulkWrite rather than save(): these documents were loaded lean and without
  // passwordHash, and a $set of one known-good enum value needs no validators.
  const res = await Employee.bulkWrite(writes);
  console.log(`\nบันทึกแล้ว ${res.modifiedCount} คน`);

  await disconnect();
}

/**
 * Only when run as a command — `npm run migrate:company`. The same line
 * src/seed.js, src/backup.js, src/restore.js and src/reset-admin-password.js
 * carry, and it is worth MORE here than on any of them.
 *
 * `seed` at least has `seedGuard` refusing on foreign data. This has no guard
 * of any kind: `run()` connects to MONGODB_URI and writes `company` onto every
 * employee row that lacks one, deciding the value from the code prefix. An
 * accidental import — a module-graph walk, a test that wanted
 * `companyFromCode`, an editor auto-import — WAS that migration, against
 * whichever database the machine points at, silently, with no argument typed
 * and `--dry` never considered.
 *
 * A wrongly-filed employee shows up as a wrong subtotal on somebody's payroll
 * and nowhere else, which is the failure this file's own opening comment is
 * about. Added 2026-08-25.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
