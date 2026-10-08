/**
 * คำนวณใบที่ยังมีผลทุกใบใหม่ — รออนุมัติและอนุมัติแล้ว — ด้วยโค้ดที่ deploy อยู่.
 *
 * Run: npm run recompute -- --yes   (--dry นับใบอย่างเดียว ไม่เขียนอะไร)
 *
 * WHY A SCRIPT. ทุกครั้งที่บันทึกนโยบายบนหน้าตั้งค่า `savePolicy` ทำแบบนี้ให้เอง
 * (2026-10-08). แต่การแก้กฎในโค้ด — เช่น OT วันเกิดกลับไปแบ่งตามนาฬิกา วันเดียวกัน —
 * ไม่มีอะไรไปสั่งให้คำนวณใหม่ ใบเดิมจึงค้างตัวเลขเก่า. รันหลัง deploy เท่านั้น:
 * ก่อน deploy โค้ดที่คำนวณคือโค้ดเก่า.
 *
 * แต่ละใบคิดด้วยนโยบายรุ่นที่มีผลในวันทำงานของใบนั้น (`versionForDate`) เหมือนการ
 * บันทึกนโยบาย · ใบที่คำนวณใหม่ไม่ได้ (เช่นกฎทำให้เหลือ 0 ชม.) คงตัวเลขเดิมและถูกรายงาน.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import OtEntry from './models/OtEntry.js';
import { recomputeEntries } from './services/otService.js';

const LIVE = ['pending_mgr', 'pending_hr', 'approved'];
const NOTE = 'คำนวณใหม่ทุกใบหลังแก้กฎการคำนวณ';

async function run() {
  await connect();
  const filter = { status: { $in: LIVE } };

  if (!process.argv.includes('--yes')) {
    const n = await OtEntry.countDocuments(filter);
    console.log(`ใบที่จะคำนวณใหม่: ${n} ใบ (รออนุมัติและอนุมัติแล้ว)`);
    console.log('ยังไม่ได้เขียนอะไร — รันอีกครั้งพร้อม --yes เพื่อคำนวณจริง');
    await disconnect();
    return;
  }

  const r = await recomputeEntries(filter, null, {
    includeApproved: true, note: NOTE, source: 'script',
  });
  console.log(`คำนวณใหม่ ${r.updated} ใบ · ชั่วโมงเปลี่ยนจริง ${r.changed} ใบ`
    + ` (อนุมัติแล้ว ${r.approvedReplayed ?? 0} ใบ)`);
  for (const f of r.failed || []) console.log(`  ข้าม ${f.id}: ${f.error}`);
  await disconnect();
}

// Run only when invoked directly — an accidental import must not BE the run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
