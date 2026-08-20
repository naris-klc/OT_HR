/**
 * One-off correction: วันหยุดวันเกิด counts from the START OF THE MONTH the rule
 * was turned on, not from the afternoon somebody ticked the box.
 *
 * Run: npm run migrate:birthday-rule-start   (--dry to see the plan and change
 *                                             nothing, --yes to confirm)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * HR turned `birthdayHolidayEnabled` on during the afternoon of 13 August 2026,
 * and `savePolicy` recorded that with `effectiveFrom: today()` — the 13th,
 * because that is the honest default for a rule nobody announced in advance.
 *
 * Two halves of the system then read that date at two different precisions.
 * `queueWindow` rounded it to a MONTH and offered every August birthday in
 * วันเกิดที่ยังไม่มีใบ; the compute path resolves rules per DATE
 * (`versionForDate`) and for the 10th read the version in force on the 10th,
 * which had the rule off. So ฝ่ายบุคคล opened บันทึก OT ให้ on a row the screen
 * had just told them to work and got a red กฎวันหยุดวันเกิดปิดอยู่ over two empty
 * time boxes, with 08:00–17:00 computing to 0 ชั่วโมง — for วิชัย ศรีสุข,
 * 10 สิงหาคม 2026, the one date on this database that fell in the gap.
 *
 * The queue's rounding has been removed (see `queueWindow`), which closes the
 * contradiction — but on its own it closes it the other way, by dropping the
 * row. HR's answer on 2026-08-20 was the opposite: the benefit belongs to the
 * whole month it started in. This script is that answer written where the
 * arithmetic can read it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A NEW VERSION AND NOT AN EDIT
 *
 * Every field on a PolicyVersion is `immutable`, and its own doc says how a
 * mistaken date is corrected: record another version. That is exactly what this
 * does — one row, the rules as they stand, carrying the earlier date HR chose.
 * Nothing already on record is touched, so what the system believed last week is
 * still readable next year.
 *
 * It is also the one kind of backdating the settings screen refuses on purpose
 * (`effectiveFromRefusal`), which is why it is a script somebody runs
 * deliberately with `--yes` and not a field on a form. The refusal exists to
 * stop a rule change restating hours that were already computed, printed and
 * paid, so this prints every entry the new row could possibly move BEFORE it
 * writes anything, and stops if there is one.
 *
 * On this database there is none: the only figure the correction reaches is a
 * birthday nobody has filed a ใบ for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DATE IT WRITES MAY NOT BE THE FIRST OF THE MONTH
 *
 * `versionForDate` answers with the LATEST `effectiveFrom` that is not after the
 * work date, ties going to the higher `seq`. A row dated the 1st is therefore
 * shadowed for the whole gap by any version already sitting inside it — here
 * version 1, the migration's origin snapshot, dated 2026-08-05 because that is
 * the oldest entry in the database. Writing the 1st would produce a record that
 * says one thing and a system that does another, which is worse than not
 * running at all.
 *
 * So the row is dated to TIE with the last version inside the gap and wins on
 * `seq` — the same "somebody changed their mind that morning" rule
 * `versionForDate` already documents. Dates earlier than every recorded version
 * resolve to the live policy anyway (that is `versionForDate` returning null),
 * so the whole target month ends up covered. That is not assumed: every date in
 * the gap is re-resolved through `versionForDate` after the write and printed.
 *
 * Idempotent. A second run finds every date in the gap already resolving to the
 * rule ON and writes nothing.
 */

import 'dotenv/config';
import { connect, disconnect } from './db.js';
import OtEntry from './models/OtEntry.js';
// Imported for its side effect — `populate('employee')` below resolves the model
// by name off the connection, and a name nothing registered is a crash at the
// query rather than at the import.
import './models/Employee.js';
import PolicyVersion from './models/PolicyVersion.js';
import Setting from './models/Setting.js';
import { versionForDate } from '../lib/policyVersion.js';
import { addDays } from './lib/otEngine.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

const NOTE = 'แก้วันเริ่มมีผลของกฎวันหยุดวันเกิด — ฝ่ายบุคคลตัดสิน 2026-08-20 ว่าสิทธิ์นี้'
  + 'นับตั้งแต่ต้นเดือนที่เปิดใช้กฎ ไม่ใช่ตั้งแต่วันที่กดบันทึก · '
  + 'ค่ากฎอื่นเหมือนเวอร์ชันที่ใช้อยู่ทุกตัว — เปลี่ยนเฉพาะวันที่เริ่มมีผล';

/** Every 'YYYY-MM-DD' from `from` to `to`, inclusive. Empty when `to` is earlier. */
function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Was the birthday holiday in force on this date, by the record?
 *
 * The same two steps `loadCalendar.policyFor` takes, and deliberately not a
 * shortcut past them: a date older than every recorded version falls back to
 * the live policy, and that fallback is the reason the first four days of the
 * month need no row written for them.
 */
const ruleOnFor = (versions, livePolicy, date) => {
  const version = versionForDate(versions, date);
  return Boolean((version ? version.policy : livePolicy)?.birthdayHolidayEnabled);
};

async function run() {
  await connect();

  const livePolicy = await Setting.effectivePolicy();
  const versions = await PolicyVersion.find().select('seq policy effectiveFrom').lean();

  const enabled = versions
    .filter((v) => v.policy?.birthdayHolidayEnabled)
    .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)) || a.seq - b.seq);

  if (!enabled.length) {
    console.log('กฎวันหยุดวันเกิดไม่เคยถูกเปิดใช้เลย — ไม่มีอะไรต้องแก้');
    await disconnect();
    return;
  }

  const ruleStart = enabled[0].effectiveFrom;
  const target = `${ruleStart.slice(0, 7)}-01`;
  const gap = datesBetween(target, addDays(ruleStart, -1));

  console.log(`กฎวันหยุดวันเกิดเริ่มมีผลตามที่บันทึกไว้: ${ruleStart} (เวอร์ชัน ${enabled[0].seq})`);
  console.log(`ฝ่ายบุคคลต้องการให้เริ่ม: ${target}`);

  const missing = gap.filter((d) => !ruleOnFor(versions, livePolicy, d));
  if (!missing.length) {
    console.log('\nไม่มีอะไรต้องทำ — ทุกวันในเดือนนั้นคิดเป็นวันหยุดวันเกิดอยู่แล้ว');
    await disconnect();
    return;
  }
  console.log(`\nวันที่ยังคิดเป็นวันทำงานปกติอยู่ ${missing.length} วัน: ${missing[0]} ถึง ${missing[missing.length - 1]}`);

  /**
   * THE ONE THING THAT MUST BE ZERO.
   *
   * Any ใบ already worked on one of those dates would be recomputed under the
   * new row the next time anything replays it, and a signed-off figure that
   * moves because a script ran is the whole reason backdating is refused on the
   * form. Only a birthday can actually move — nothing else in the policy
   * changes — but this asks the wider question and prints whatever it finds.
   */
  const touched = await OtEntry.find({ workDate: { $in: missing } })
    .select('workDate status employee totals').populate('employee', 'code name birthDate').lean();
  const atRisk = touched.filter((e) => {
    const birth = e.employee?.birthDate || '';
    return birth.slice(5) === e.workDate.slice(5);
  });

  if (touched.length) {
    console.log(`\nมีใบ OT อยู่ในช่วงวันดังกล่าว ${touched.length} ใบ:`);
    for (const e of touched) {
      const mark = atRisk.includes(e) ? '  ⚠ ตรงกับวันเกิด — ชั่วโมงจะเปลี่ยน' : '  (ไม่ใช่วันเกิดของเจ้าของใบ — ชั่วโมงไม่เปลี่ยน)';
      console.log(`  ${e.workDate} · ${e.employee?.code || '—'} ${e.employee?.name || ''} · ${e.status}${mark}`);
    }
  } else {
    console.log('\nไม่มีใบ OT ใดอยู่ในช่วงวันดังกล่าว');
  }

  if (atRisk.length && !confirmed) {
    console.log('\nหยุดไว้ก่อน — มีใบที่ชั่วโมงจะเปลี่ยน ตรวจรายการข้างบนแล้วรันซ้ำด้วย --yes เพื่อยืนยัน');
    await disconnect();
    process.exitCode = 1;
    return;
  }

  /**
   * The date to write: tie with the last version inside the gap, or the target
   * itself when nothing is in the way. See the header for why the first of the
   * month is not always the answer.
   */
  const shadowing = versions
    .filter((v) => v.effectiveFrom >= target && v.effectiveFrom < ruleStart)
    .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))
    .pop();
  const effectiveFrom = shadowing ? shadowing.effectiveFrom : target;
  const seq = versions.reduce((n, v) => Math.max(n, v.seq ?? 0), 0) + 1;

  console.log(`\nจะบันทึกเวอร์ชัน ${seq} · เริ่มมีผล ${effectiveFrom}`
    + (shadowing ? ` (วันเดียวกับเวอร์ชัน ${shadowing.seq} เพื่อให้ทับของเดิมได้)` : ''));

  if (dryRun) {
    console.log('--dry: ไม่ได้บันทึกอะไรลงฐานข้อมูล');
    await disconnect();
    return;
  }
  if (!confirmed) {
    console.log('\nรันซ้ำด้วย --yes เพื่อบันทึกจริง (หรือ --dry เพื่อดูอย่างเดียว)');
    await disconnect();
    process.exitCode = 1;
    return;
  }

  const version = await PolicyVersion.create({
    seq,
    // Copied — `effectivePolicy()` hands back a frozen object.
    policy: { ...livePolicy },
    effectiveFrom,
    note: NOTE,
  });
  console.log(`บันทึกแล้ว: เวอร์ชัน ${version.seq} (${version._id}) · ลายนิ้วมือกฎ ${version.policyHash}`);

  /**
   * VERIFIED AGAINST THE RECORD, NOT AGAINST THE INTENTION — re-read, re-resolved
   * through the same function the compute path uses. A tie-break that did not go
   * the way this script expected has to be visible here, in the run that caused
   * it, rather than in a form somebody opens next week.
   */
  const after = await PolicyVersion.find().select('seq policy effectiveFrom').lean();
  const stillOff = gap.filter((d) => !ruleOnFor(after, livePolicy, d));
  if (stillOff.length) {
    console.log(`\n⚠ ยังมีวันที่คิดเป็นวันทำงานปกติอยู่ ${stillOff.length} วัน: ${stillOff.join(', ')}`);
    console.log('  ต้องตรวจลำดับเวอร์ชันด้วยตนเอง — อย่าเพิ่งถือว่าแก้เสร็จ');
    process.exitCode = 1;
  } else {
    console.log(`\nตรวจแล้ว: ทุกวันตั้งแต่ ${target} ถึง ${ruleStart} คิดเป็นวันหยุดวันเกิดครบ`);
  }

  await disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await disconnect();
  process.exitCode = 1;
});
