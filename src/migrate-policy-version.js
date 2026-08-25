/**
 * One-off migration: give every entry filed before versioning existed a rule
 * set to point at.
 *
 * Run: npm run migrate:policy-version        (--dry to see the plan and change nothing)
 *
 * Two steps, each idempotent on its own terms (see planBackfill in
 * lib/policyVersion.js):
 *
 *   1. Record version 1 — the rules in force right now — but only if
 *      otPolicyVersions is empty. A second run finds the origin already there
 *      and adds nothing; it must not mint a rival one, because by then HR may
 *      legitimately have answered another [OPEN] item and version 2 would be
 *      the live one while the entries still point at 1.
 *   2. Point every entry that has no pointer at that origin. Entries that
 *      already have one are never touched, whatever their status.
 *
 * Step 2 is the single, deliberate exception to "an approved entry is never
 * restated". It writes a pointer and nothing else — no hours are recomputed
 * here, and a signed-off figure comes out of this script byte for byte as it
 * went in. The alternative was leaving approved rows permanently unattributable,
 * which is the problem this whole change exists to fix.
 *
 * Not run at start-up. A migration that fires on boot runs on a machine nobody
 * is watching, against whichever database that machine points at.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import OtEntry from './models/OtEntry.js';
import PolicyVersion from './models/PolicyVersion.js';
import Setting from './models/Setting.js';
import { DEFAULT_POLICY } from './config/policy.js';
import { planBackfill, diffPolicy, policyHash } from '../lib/policyVersion.js';
import { today } from '../lib/today.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

/**
 * Give every version already on record the date it started applying.
 *
 * `effectiveFrom` arrived on 2026-08-14, when HR settled that an entry is
 * computed under the rules in force on the day it was WORKED. Rows written
 * before that have no such date, and `versionForDate` ignores a version without
 * one — so until this runs, a database with versions behaves as though it had
 * none, and every entry falls back to the live policy. That is the old
 * behaviour rather than a wrong one, but it is not the new rule.
 *
 * THE OLDEST VERSION IS BACKDATED TO BEFORE THE OLDEST ENTRY, deliberately, and
 * it is the only backdating this system permits. That version is the record of
 * the rules everything was computed under before anybody was recording them; if
 * it started at its own `createdAt` instead, every entry worked before the
 * migration ran would resolve to no version at all and be recomputed under
 * today's policy — which is precisely the retroactive restatement the field
 * exists to prevent. Later versions start on the day they were recorded, which
 * is the truth about them: nobody could announce a date before the field
 * existed.
 *
 * Idempotent: rows that already have a date are left alone, so this runs with
 * the rest of the migration as often as anybody likes.
 */
async function backfillEffectiveFrom({ dry = false } = {}) {
  const missing = await PolicyVersion.find({
    $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: '' }],
  }).select('seq createdAt').sort({ seq: 1 }).lean();
  if (!missing.length) return;

  const oldestEntry = await OtEntry.findOne().select('workDate').sort({ workDate: 1 }).lean();
  const asDate = (d) => today(d instanceof Date ? d : new Date(d));
  const [first, ...rest] = missing;

  /** Earlier of "the first entry ever" and "the day the version was recorded". */
  const floor = [oldestEntry?.workDate, first.createdAt && asDate(first.createdAt)]
    .filter(Boolean).sort()[0] || today();

  const writes = [
    { updateOne: { filter: { _id: first._id }, update: { $set: { effectiveFrom: floor } } } },
    ...rest.map((v) => ({
      updateOne: {
        filter: { _id: v._id },
        update: { $set: { effectiveFrom: v.createdAt ? asDate(v.createdAt) : floor } },
      },
    })),
  ];

  /**
   * `--dry` REPORTS AND WRITES NOTHING, and this check is here rather than at
   * the call site because the first version of it was at the call site — below
   * the call — and a dry run wrote the backfill for real. Caught on 2026-08-14
   * by running it. A function that writes must be the one that knows whether it
   * is allowed to.
   */
  if (dry) {
    console.log(`--dry: จะเติมวันที่เริ่มมีผลให้เวอร์ชันเดิม ${writes.length} เวอร์ชัน (เวอร์ชันแรกเริ่ม ${floor})`);
    return;
  }

  // `strict: false` — `effectiveFrom` is `immutable`, which mongoose enforces on
  // updates too, and these rows are being given a value they have never had
  // rather than having one changed.
  await PolicyVersion.bulkWrite(writes, { strict: false });
  console.log(`เติมวันที่เริ่มมีผลให้เวอร์ชันเดิม ${writes.length} เวอร์ชัน (เวอร์ชันแรกเริ่ม ${floor})`);
}

async function run() {
  await connect();

  /**
   * The snapshot is the EFFECTIVE policy — the file's defaults with whatever
   * HR has already saved in Setting applied — because that, not the file, is
   * what the stored entries were actually computed with. Taking the file alone
   * would produce an origin version whose numbers do not reproduce the hours
   * sitting in the database, which is the one thing a version is for.
   */
  const snapshot = await Setting.effectivePolicy();
  const drift = diffPolicy(DEFAULT_POLICY, snapshot);

  await backfillEffectiveFrom({ dry: dryRun });

  const [existingVersions, entries] = await Promise.all([
    PolicyVersion.find().select('seq policy createdAt').lean(),
    OtEntry.find().select('policyVersionId status').lean(),
  ]);

  const plan = planBackfill({ existingVersions, entries });

  console.log(`ใบ OT ทั้งหมด ${entries.length} ใบ`);
  console.log(`  มีเวอร์ชันกำกับแล้ว ${plan.alreadyStamped} ใบ`);
  console.log(`  ยังไม่มีเวอร์ชัน ${plan.backfill.length} ใบ`);

  if (plan.createGenesis) {
    console.log('\nยังไม่มีเวอร์ชันใดในระบบ — จะสร้าง "เวอร์ชัน 1" จากนโยบายที่ใช้อยู่ปัจจุบัน');
  } else {
    console.log(`\nใช้เวอร์ชัน ${plan.genesis.seq} ที่มีอยู่แล้วเป็นต้นทาง (สร้างเมื่อ ${plan.genesis.createdAt?.toISOString?.() || '—'})`);
  }

  /**
   * Reported before anything is written, and fatal without --yes.
   *
   * The file's defaults and the database's overrides disagreeing is normal —
   * it means HR has answered an [OPEN] item. But it also means the origin
   * version will not match src/config/policy.js, and whoever runs this
   * expecting "version 1 = the file" should find that out here rather than
   * from a report six weeks later.
   */
  if (plan.createGenesis && drift.length) {
    console.log(`\nนโยบายในฐานข้อมูลต่างจากค่าตั้งต้นในไฟล์ ${drift.length} ข้อ — เวอร์ชัน 1 จะบันทึกค่าจากฐานข้อมูล:`);
    for (const c of drift) {
      const mark = c.arithmetic ? ' (มีผลต่อการคำนวณ)' : '';
      console.log(`  ${c.key}: ไฟล์ ${JSON.stringify(c.from)} → ฐานข้อมูล ${JSON.stringify(c.to)}${mark}`);
    }
    if (!dryRun && !confirmed) {
      console.log('\nหยุดไว้ก่อน — ตรวจรายการข้างบนแล้วรันซ้ำด้วย --yes เพื่อยืนยัน (หรือ --dry เพื่อดูอย่างเดียว)');
      await disconnect();
      process.exitCode = 1;
      return;
    }
  }

  if (!plan.createGenesis && !plan.backfill.length) {
    console.log('\nไม่มีอะไรต้องทำ — ทุกใบมีเวอร์ชันกำกับครบแล้ว');
    await disconnect();
    return;
  }

  if (dryRun) {
    console.log('\n--dry: ไม่ได้บันทึกอะไรลงฐานข้อมูล');
    await disconnect();
    return;
  }

  const genesis = plan.createGenesis
    ? await PolicyVersion.create({
      seq: 1,
      // Copied — effectivePolicy() returns a frozen object.
      policy: { ...snapshot },
      note: 'ต้นทาง — นโยบายที่ใช้อยู่ก่อนเริ่มบันทึกเวอร์ชัน (สร้างโดย migrate:policy-version)',
    })
    : plan.genesis;

  // The fingerprint is printed so that whoever ran this can check the settings
  // page afterwards and see the same eight characters — the one-line
  // confirmation that the version on record is the policy actually in force.
  console.log(`\nเวอร์ชันต้นทาง: เวอร์ชัน ${genesis.seq} (${genesis._id}) · ลายนิ้วมือกฎ ${genesis.policyHash || policyHash(genesis.policy)}`);

  if (!plan.backfill.length) {
    console.log('ไม่มีใบที่ต้อง backfill');
    await disconnect();
    return;
  }

  /**
   * updateOne per id, not a blanket updateMany on "has no pointer".
   *
   * The plan was decided from a read taken a moment ago, and an entry filed
   * between that read and this write already carries the right pointer from
   * `applyComputation`. Naming the ids means this can only ever write the rows
   * it looked at, and re-running it writes none of them a second time.
   */
  const res = await OtEntry.bulkWrite(plan.backfill.map((id) => ({
    updateOne: {
      filter: { _id: id, policyVersionId: null },
      update: { $set: { policyVersionId: genesis._id } },
    },
  })));

  console.log(`backfill แล้ว ${res.modifiedCount} ใบ`);
  if (res.modifiedCount !== plan.backfill.length) {
    console.log(`  (${plan.backfill.length - res.modifiedCount} ใบถูกกำกับไปแล้วระหว่างที่สคริปต์ทำงาน — ไม่ถูกเขียนทับ)`);
  }
  console.log('ชั่วโมงและสถานะของทุกใบไม่ถูกแตะต้อง — สคริปต์นี้เขียนเฉพาะ policyVersionId');

  await disconnect();
}

/**
 * Only when run as a command — `npm run migrate:policy-version`. The line
 * seed, backup, restore and reset-admin already carry.
 *
 * Read the opening comment again with an accidental import in mind: step 1
 * MINTS A POLICY VERSION from whatever the live rules happen to be, and step 2
 * stamps `policyVersionId` onto every entry that has none — approved entries
 * included, which is the one deliberate exception to "a signed-off figure is
 * never restated". Doing that on purpose is a decision somebody made. Doing it
 * because a file was imported is a version row nobody minted and a pointer
 * nobody meant to set, on a database nobody chose.
 *
 * The idempotence in step 1 does not save this: it only stops a SECOND origin
 * being minted. Nothing stops the first. Added 2026-08-25.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
