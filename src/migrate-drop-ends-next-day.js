/**
 * One-off migration: clear `endsNextDay` off every stored OT request.
 *
 * Run: npm run migrate:drop-ends-next-day     (add --dry to see the plan and change nothing)
 *
 * ── WHY THERE IS A SCRIPT AT ALL ────────────────────────────────────────────
 *
 * ทำงานข้ามคืน was removed whole on 2026-09-10 at HR's word — *เคลียร์ทุกอย่าง
 * ที่เกี่ยวกับฟีเจอร์ "ทำงานข้ามคืน" ออกจากระบบ ทั้งหมด* — and with it the field
 * on `src/models/OtEntry.js`. Mongoose does not delete an undeclared field; it
 * ignores it on read and drops it on the next save, so a row filed before that
 * day goes on carrying a key nothing reads until somebody happens to edit it.
 * A field that exists in the data and in no schema is the kind of thing a
 * future reader finds and reasons from.
 *
 * ── WHAT IT DOES NOT DO, AND THIS IS THE HALF TO READ ───────────────────────
 *
 * **It does not touch anybody's times.** A row that carried `endsNextDay: true`
 * has an `endTime` at or before its `startTime`, which is exactly what
 * `computeSession` now refuses (`END_BEFORE_START`). Unsetting the flag does
 * not make such a row computable — it makes it a row that cannot be replayed
 * until a person decides what the real hours were.
 *
 * That decision is not a script's. The honest answers are all human ones: the
 * employee re-files as two requests, one per date; or the row is cancelled; or
 * HR corrects the times through แก้ไขชั่วโมง. Picking one here — clamping an
 * end to 23:59, say — would silently change hours somebody may already have
 * been paid for, in a batch, with nothing on any screen saying it happened.
 *
 * So the script REPORTS those rows, by id, person, date and times, and leaves
 * them for somebody to act on. On the database this was written against there
 * was exactly one: 2026-09-09, 21:00–21:00, `pending_mgr` — a 24-hour session,
 * which is what a pair of equal times meant while the flag existed.
 *
 * Idempotent: a second run finds nothing to unset and reports the same rows.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import OtEntry from './models/OtEntry.js';

const dryRun = process.argv.includes('--dry');

/**
 * Read through the driver rather than through the model.
 *
 * `OtEntry.find()` cannot see `endsNextDay` any more — it is not in the schema,
 * so mongoose strips it from every document on the way out and the count would
 * always be nought. The collection is where the field still is.
 */
function collection() {
  return OtEntry.collection;
}

async function run() {
  await connect();

  const holding = await collection()
    .find({ endsNextDay: { $exists: true } })
    .project({ workDate: 1, startTime: 1, endTime: 1, status: 1, endsNextDay: 1 })
    .toArray();

  console.log(`ใบที่ยังมีฟิลด์ endsNextDay: ${holding.length} ใบ`);

  /**
   * The rows a person has to decide about — an end that is not after its start.
   * Read off the TIMES and not off the flag: a row could carry `false` on times
   * that are out of order (a payload that set the flag itself, a hand-edited
   * document), and it is just as unreplayable as one that carried `true`.
   */
  const unreplayable = holding.filter((e) => (
    e.startTime && e.endTime && String(e.endTime) <= String(e.startTime)
  ));

  if (unreplayable.length) {
    console.log(`\n⚠ ใบที่คิดใหม่ไม่ได้ ${unreplayable.length} ใบ — เวลาสิ้นสุดไม่ได้อยู่หลังเวลาเริ่ม`);
    console.log('  สคริปต์นี้ไม่แตะเวลาให้ ต้องมีคนตัดสินว่าจะแก้เวลา ยกเลิก หรือให้ยื่นใหม่เป็นสองใบ\n');
    for (const e of unreplayable) {
      console.log(`  ${e._id}  ${e.workDate}  ${e.startTime}–${e.endTime}  ${e.status}`);
    }
    console.log('');
  } else {
    console.log('ไม่มีใบที่คิดใหม่ไม่ได้');
  }

  if (dryRun) {
    console.log(`\n--dry — ไม่ได้เขียนอะไรลงฐานข้อมูล (จะ $unset ${holding.length} ใบ)`);
    await disconnect();
    return;
  }

  if (!holding.length) {
    console.log('\nไม่มีอะไรต้องลบ');
    await disconnect();
    return;
  }

  const res = await collection().updateMany(
    { endsNextDay: { $exists: true } },
    { $unset: { endsNextDay: '' } },
  );
  console.log(`\nลบฟิลด์ออกจาก ${res.modifiedCount} ใบแล้ว`);

  await disconnect();
}

/**
 * Only when run as a command — `npm run migrate:drop-ends-next-day`. The same
 * line every migration in this directory carries, and for the reason written
 * out at the foot of src/migrate-company.js: an accidental import — a
 * module-graph walk, an editor auto-import — would otherwise BE the migration,
 * against whichever database the machine points at, with no argument typed.
 *
 * This one only unsets a field nothing reads, so the blast radius is smaller
 * than that file's. It is guarded the same way anyway: the next reader should
 * not have to work out which migrations in this directory are the dangerous
 * ones.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
