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
import { connect, disconnect } from './db.js';
import OtEntry from './models/OtEntry.js';
import PolicyVersion from './models/PolicyVersion.js';
import Setting from './models/Setting.js';
import { DEFAULT_POLICY } from './config/policy.js';
import { planBackfill, diffPolicy, policyHash } from '../lib/policyVersion.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

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

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
