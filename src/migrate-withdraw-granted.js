/**
 * One-off migration: every คำขอถอนใบ still waiting for an answer becomes a
 * completed withdrawal.
 *
 * Run: npm run migrate:withdraw-granted     (add --dry to see the plan and change nothing)
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * On 2026-09-18 ถอนใบ stopped being a request. The employee presses it, the
 * entry is `cancelled`, and nobody decides anything — lib/withdrawal.js has the
 * whole argument. `POST /entries/:id/withdraw/decide`, which was the only way a
 * `requested` row ever moved, was deleted in the same commit.
 *
 * **So without this script those rows are stranded.** They are entries whose
 * owner asked for them to come off the books, sitting `approved` with their
 * hours still counted, and there is no longer a button anywhere in the app that
 * answers them. Three of them were in the database this was written against —
 * and they were stranded for a second reason before this change: `cancelCutoffDay`
 * measures the ตัดสิน press at TODAY, so a request left sitting past the cutoff
 * was out of the หัวหน้า's hands for good. That is the pile this whole piece of
 * work was asked to clear.
 *
 * ── WHAT IT DECIDES, AND ON WHOSE AUTHORITY ─────────────────────────────────
 *
 * ถือว่าถอนสำเร็จทั้งหมด — the user's answer, in those words, asked as a direct
 * question. Every open request is granted, **including the ones past their
 * cutoff**, which is exactly why they were still open.
 *
 * Granting rather than refusing is the reading that matches what was asked for:
 * each of these rows carries an employee's own sentence saying they want their
 * hours off the month, and nobody ever said no. Refusing them in a batch would
 * be answering three people in the negative with nothing behind it.
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────
 *
 *   status              → 'cancelled'
 *   withdrawal.state    → 'granted'
 *   history             += one `withdraw` row, dated TODAY, actor = the person
 *                          who asked, note = why this happened
 *
 * **The request half is never overwritten.** `requestedBy`, `requestedByName`,
 * `requestedAt` and `reason` stay exactly as the employee left them — that
 * reason is the single most useful line on the record when somebody comes back
 * to ask about the month.
 *
 * **`decidedBy` and friends stay empty**, for the reason `withdrawalRecord`
 * leaves them empty: nobody decided. A script's own name in a ผู้ตัดสิน field
 * would be a person who does not exist; the employee's name there would be a
 * forged approval of their own request. The history row carries the truth
 * instead, in a sentence.
 *
 * DATED THE DAY IT RUNS, not `requestedAt`. Back-dating the row would put a
 * withdrawal inside a month that was closed and reported without it, and every
 * trail on the system reads left to right by `at`.
 *
 * ── AND WHAT IT DELIBERATELY DOES NOT TOUCH ─────────────────────────────────
 *
 * `refused` rows. One exists. It is a real answer a real person gave and the
 * entry is still live and still counted, which is what a refusal means. Nothing
 * about this change makes that row wrong.
 *
 * Idempotent: a second run finds no `requested` rows and writes nothing.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import OtEntry from './models/OtEntry.js';

const dryRun = process.argv.includes('--dry');

/** The one sentence this leaves behind on each row, in the trail and nowhere else. */
const NOTE = 'ถอนใบให้อัตโนมัติ — ระบบเลิกใช้ขั้นตอนอนุมัติคำขอถอนเมื่อ 18/09/2569 คำขอที่ค้างอยู่ถือว่าถอนสำเร็จ';

async function run() {
  await connect();

  /**
   * Through the MODEL, not the driver — unlike migrate-drop-ends-next-day.js,
   * which had to reach past mongoose to see a field the schema no longer knows.
   * `withdrawal.state` is still in the schema (`WITHDRAWAL_STATES` keeps
   * `requested` for exactly this reason), and going through the model means
   * `entry.log()` builds the history row the same way every route does.
   */
  const open = await OtEntry.find({ 'withdrawal.state': 'requested' });

  console.log(`คำขอถอนใบที่ยังค้างอยู่: ${open.length} ใบ`);
  for (const e of open) {
    const w = e.withdrawal;
    console.log(
      `  ${e._id}  ${e.period}  ${String(e.workDate).slice(0, 10)}  ${e.status}`
      + `  ขอโดย ${w?.requestedByName || '—'}  เหตุผล: ${w?.reason || '—'}`,
    );
  }

  if (!open.length) {
    console.log('\nไม่มีอะไรต้องแก้');
    await disconnect();
    return;
  }

  if (dryRun) {
    console.log(`\n--dry — ไม่ได้เขียนอะไรลงฐานข้อมูล (จะถอนให้ ${open.length} ใบ)`);
    await disconnect();
    return;
  }

  let done = 0;
  for (const e of open) {
    const from = e.status;
    e.withdrawal.state = 'granted';
    e.status = 'cancelled';
    /**
     * THE ACTOR IS THE PERSON WHO ASKED, and the note says why the row appeared
     * without them pressing anything. `entry.log` copies the name off the
     * object it is handed, so the pair from the request is passed straight
     * through — a roster lookup would only find the same two fields, and would
     * find nothing at all for somebody who has left.
     */
    e.log(
      { _id: e.withdrawal.requestedBy, name: e.withdrawal.requestedByName },
      'withdraw',
      NOTE,
      from,
    );
    await e.save();
    done += 1;
  }

  console.log(`\nถอนใบให้แล้ว ${done} ใบ — สถานะเป็น "ยกเลิก" และชั่วโมงถูกตัดออกจากงวดนั้น`);
  await disconnect();
}

/**
 * Only when run as a command. The same guard every migration in this directory
 * carries, for the reason written out at the foot of src/migrate-company.js: an
 * accidental import — a module-graph walk, an editor auto-import — would
 * otherwise BE the migration, against whichever database the machine points at,
 * with no argument typed. This one moves hours off a month, so it is one of the
 * ones that guard is actually for.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
