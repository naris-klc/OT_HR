/**
 * แผนกจริงทั้ง 18 แผนก จากตาราง หน่วยงาน — เข้าฐานข้อมูลครั้งเดียว.
 *
 * Run: npm run import:departments   (--dry to see the plan and change nothing,
 *                                    --yes to confirm)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS DATA COMES FROM, AND WHY IT IS IN A FILE RATHER THAN TYPED IN
 *
 * `หน่วยงาน.pdf`, shown 2026-09-03: eighteen rows of ชื่อแผนก with the
 * หัวหน้างาน / ผู้จัดการ / ผู้จัดการฝ่าย who sign for each, and a
 * เพดาน ชม./เดือน column. Both halves are loaded here — the names and the
 * ceilings — because they came from one sheet and a ceiling typed in later by
 * hand is a ceiling that can disagree with the sheet nobody re-reads.
 *
 * THE SIGNERS ARE NOT LOADED, and that is the whole reason this is one script
 * and not two. A signer is a PERSON on the roster, and the roster
 * (163 rows, `employee-import-template.csv`) has not been imported yet. Writing
 * `Department.manager` from this sheet would point eighteen departments at
 * people who do not exist as rows — and that field decides nothing anyway (see
 * the note over `isDepartmentManager`: coverage is department MEMBERSHIP plus
 * บทบาท, never `Department.manager`). Who signs for whom arrives with the
 * people, in the roster import.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CODES ARE THIS FILE'S OWN INVENTION
 *
 * The sheet has no รหัสแผนก column, and `Department.code` is required and
 * unique. So they are made up here, in the shape the five seed departments
 * already use — short, Latin, upper case — and they are the ONE thing in this
 * file that nobody outside it has approved. HR can rename any of them on
 * ตั้งค่าระบบ → แผนก without touching anything else: the code is a handle, and
 * every screen shows `nameTh`.
 *
 * `WH` (คลังสินค้า, seeded) and `WH-FG` (แผนกคลังสินค้าสำเร็จรูป, real) are two
 * different departments and both are kept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ADDS, IT NEVER EDITS OR REMOVES
 *
 * A row whose `code` is already there is left exactly as it is and reported as
 * skipped — so running this twice changes nothing the second time, and running
 * it after HR has re-capped a department by hand does not undo them. The five
 * seeded departments (ENG · PROD · QC · WH · ADM) are not touched either: the
 * 22 seeded employees still point at them, and deleting a department out from
 * under a person is not something a load script gets to decide.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Department from './models/Department.js';

const dryRun = process.argv.includes('--dry');
const confirmed = process.argv.includes('--yes');

/**
 * The sheet, in its own order.
 *
 * `weeklyCapHours` is null on every row and that is what the sheet says — it
 * has one ceiling column, per month. Null means no weekly ceiling, which is
 * different from zero (see the field on src/models/Department.js), and adding a
 * weekly cap nobody asked for would refuse hours HR expects to be allowed.
 *
 * `otMode` is left to the model's default (`normal`). The sheet does not say,
 * and เหมารายวัน / ไม่มีโอที are answers HR gives per department on
 * ตั้งค่าระบบ → แผนก.
 */
const DEPARTMENTS = [
  { code: 'PROD1', nameTh: 'แผนกผลิต1', name: 'Production 1', monthlyCapHours: 40 },
  { code: 'PROD2', nameTh: 'แผนกผลิต2', name: 'Production 2', monthlyCapHours: 40 },
  { code: 'PROD3', nameTh: 'แผนกผลิต3', name: 'Production 3', monthlyCapHours: 40 },
  { code: 'RND', nameTh: 'แผนกออกแบบและวิจัยผลิตภัณฑ์', name: 'Product Design and Research', monthlyCapHours: 30 },
  { code: 'SALES', nameTh: 'ฝ่ายขาย', name: 'Sales', monthlyCapHours: 30 },
  { code: 'MKT', nameTh: 'แผนกการตลาดและกราฟฟิคดีไซน์', name: 'Marketing and Graphic Design', monthlyCapHours: 30 },
  { code: 'SALESCO', nameTh: 'แผนกประสานงานขาย', name: 'Sales Coordination', monthlyCapHours: 30 },
  { code: 'SVC', nameTh: 'แผนกบริการ', name: 'Service', monthlyCapHours: 40 },
  { code: 'BR-SPK', nameTh: 'สาขาสมุทรปราการ', name: 'Samut Prakan Branch', monthlyCapHours: 40 },
  { code: 'BR-CBI', nameTh: 'สาขาชลบุรี', name: 'Chonburi Branch', monthlyCapHours: 40 },
  { code: 'BR-RAMA2', nameTh: 'สาขาพระราม2', name: 'Rama 2 Branch', monthlyCapHours: 40 },
  { code: 'BR-PTE', nameTh: 'สาขาปทุมธานี', name: 'Pathum Thani Branch', monthlyCapHours: 40 },
  { code: 'IT', nameTh: 'แผนกIT', name: 'Information Technology', monthlyCapHours: 30 },
  { code: 'ACCFIN', nameTh: 'แผนกบัญชีและการเงิน', name: 'Accounting and Finance', monthlyCapHours: 30 },
  { code: 'PUR', nameTh: 'แผนกจัดซื้อ', name: 'Purchasing', monthlyCapHours: 30 },
  { code: 'HRD', nameTh: 'แผนกทรัพยากรมนุษย์', name: 'Human Resources', monthlyCapHours: 30 },
  { code: 'WH-FG', nameTh: 'แผนกคลังสินค้าสำเร็จรูป', name: 'Finished Goods Warehouse', monthlyCapHours: 30 },
  { code: 'SHIP', nameTh: 'แผนกจัดส่ง', name: 'Shipping', monthlyCapHours: 30 },
];

async function run() {
  await connect();

  const existing = await Department.find().select('code nameTh name monthlyCapHours').lean();
  const byCode = new Map(existing.map((d) => [d.code, d]));
  const byNameTh = new Map(existing.filter((d) => d.nameTh).map((d) => [d.nameTh, d]));

  const adding = [];
  const skipped = [];
  for (const row of DEPARTMENTS) {
    /**
     * Matched on the CODE and on the THAI NAME, because either one being taken
     * means the department is already there. A second `แผนกจัดส่ง` under a
     * different code is the failure this catches — the screens show `nameTh`,
     * so the two would be indistinguishable everywhere a person looks while
     * splitting one team's ceiling and one team's queue in half.
     */
    const clash = byCode.get(row.code) || byNameTh.get(row.nameTh);
    if (clash) skipped.push({ row, clash });
    else adding.push(row);
  }

  console.log(`แผนกในฐานข้อมูลตอนนี้ ${existing.length} แผนก · ในตาราง หน่วยงาน ${DEPARTMENTS.length} แผนก\n`);

  if (skipped.length) {
    console.log(`มีอยู่แล้ว ${skipped.length} แผนก — ข้ามไป ไม่แก้ของเดิม`);
    for (const { row, clash } of skipped) {
      console.log(`  ${row.code.padEnd(9)} ${row.nameTh}  (ตรงกับ ${clash.code} · ${clash.nameTh || clash.name})`);
    }
    console.log('');
  }

  if (!adding.length) {
    console.log('ไม่มีแผนกใหม่ต้องเพิ่ม');
    await disconnect();
    return;
  }

  console.log(`จะเพิ่ม ${adding.length} แผนก:`);
  for (const row of adding) {
    const cap = row.monthlyCapHours == null ? 'ไม่มีเพดาน' : `${row.monthlyCapHours} ชม./เดือน`;
    console.log(`  ${row.code.padEnd(9)} ${row.nameTh.padEnd(30)} ${cap}`);
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

  /**
   * One at a time rather than `insertMany`, so that a row the schema refuses
   * names itself and the ones before it stay. `insertMany` without `ordered`
   * reports a bag of errors against indexes; with it, a failure halfway leaves
   * the caller guessing which half landed.
   */
  let written = 0;
  for (const row of adding) {
    try {
      await Department.create({
        code: row.code,
        name: row.name,
        nameTh: row.nameTh,
        manager: null,
        monthlyCapHours: row.monthlyCapHours,
        weeklyCapHours: null,
      });
      written += 1;
    } catch (err) {
      console.error(`\n  ✗ ${row.code} · ${row.nameTh} — ${err.message}`);
    }
  }

  console.log(`\nเพิ่มแล้ว ${written} จาก ${adding.length} แผนก`);
  console.log(`รวมทั้งหมดตอนนี้ ${await Department.countDocuments()} แผนก`);
  console.log('\nรหัสแผนกเป็นสิ่งที่สคริปต์นี้ตั้งเอง — เปลี่ยนได้ที่ ตั้งค่าระบบ → แผนก');

  await disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { run, DEPARTMENTS };
