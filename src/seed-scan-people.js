/**
 * ข้อมูลตัวอย่าง — พนักงานสองคน (PM00112, THT0107) และใบ OT ของเดือน 07/2026
 * ที่อ่านเวลามาจากไฟล์สแกนนิ้วมือสองไฟล์ (ทดสอบ.txt, THT07261.txt)
 *
 * ไฟล์สแกนไม่ได้ถูกนำเข้าระบบ — คอลเลกชัน otScanPunches / otScanBatches
 * ไม่ถูกแตะเลย ที่สร้างคือ Employee สองแถว กับ OtEntry ของเดือนกรกฎาคม
 *
 * เดินผ่าน service ชุดเดียวกับที่ route ใช้ (loadCalendar → contextFor →
 * compute → applyComputation → checkCap → stampCap) ชั่วโมงจึงคิดด้วยนโยบาย
 * ที่ใช้อยู่จริง ไม่ใช่ตัวเลขที่เขียนทับลงไป
 *
 *   node src/seed-scan-people.js             สร้าง (ปฏิเสธถ้ามีใบเดือน 07 อยู่แล้ว)
 *   node src/seed-scan-people.js --replace   ลบใบ 2026-07 ของสองคนนี้แล้วสร้างใหม่
 */
import 'dotenv/config';
import { connect, disconnect } from './db.js';
import Department from './models/Department.js';
import Employee from './models/Employee.js';
import OtEntry from './models/OtEntry.js';
import {
  loadCalendar, contextFor, compute, applyComputation, checkCap,
} from './services/otService.js';
import { stampCap } from '../lib/entries.js';

const REPLACE = process.argv.includes('--replace');
/** คำนวณและพิมพ์ตาราง แต่ไม่เขียนอะไรลงฐานข้อมูลเลย */
const DRY = process.argv.includes('--dry');

// ── ทะเบียนพนักงานสองแถว ────────────────────────────────────────────────────
const PEOPLE = [
  {
    code: 'PM00112',
    name: 'วีระพงษ์ ศรีมงคล',
    position: 'พนักงานฝ่ายผลิต',
    dept: 'PROD1',
    birthDate: '1990-03-14',
    approver: 'PM-0101',           // หัวหน้าแผนกผลิต1 ฝั่ง Primus
  },
  {
    code: 'THT0107',
    name: 'อดิศักดิ์ แก้วมณี',
    position: 'พนักงานควบคุมเครื่องจักร',
    dept: 'PROD1',
    birthDate: '1985-11-02',
    approver: 'THT0012',           // หัวหน้าแผนกผลิต1 ฝั่ง Themtech
  },
];

/**
 * ใบ OT ทีละแถว
 *
 * `scan` คือเวลาที่อยู่ในไฟล์สแกนของวันนั้น เก็บไว้เพื่อพิมพ์ตอนท้ายว่าแถวไหน
 * ตรงแถวไหนไม่ตรง — ไม่ได้ถูกบันทึกลงฐานข้อมูล และไม่มีอะไรในระบบอ่านมัน
 *
 * เวลาเริ่ม 17:00 คือขอบเวลาที่ OT เริ่มนับ (otStartsAtCoreEnd) ไม่ใช่เวลาที่
 * แตะเครื่องตอนเช้า — ช่วง 08:00–17:00 เป็นเวลาทำงานปกติ ไม่ใช่ OT
 */
const ENTRIES = {
  PM00112: [
    { d: '2026-07-01', s: '17:00', e: '19:30', st: 'approved', desc: 'เดินไลน์ประกอบต่อจากกะปกติ', scan: '07:21 / 19:30' },
    { d: '2026-07-02', s: '17:00', e: '19:00', st: 'approved', desc: 'ประกอบชิ้นงานส่งลูกค้า', scan: '07:30 / 19:30', off: 'ลงเวลาออกเร็วกว่าที่สแกนไว้ 30 นาที' },
    { d: '2026-07-06', s: '17:00', e: '19:30', st: 'approved', desc: 'เดินไลน์ประกอบต่อจากกะปกติ', scan: '07:24 / 19:30' },
    { d: '2026-07-07', s: '17:00', e: '19:30', st: 'approved', desc: 'ประกอบชุดคำสั่งผลิตค้างส่ง', scan: '07:23 / 19:30' },
    { d: '2026-07-08', s: '17:00', e: '19:30', st: 'approved', desc: 'เดินไลน์ประกอบต่อจากกะปกติ', scan: '07:32 / 19:30' },
    { d: '2026-07-09', s: '17:00', e: '20:00', st: 'approved', desc: 'เก็บงานค้างไลน์ 2', scan: '07:07 / 19:30', off: 'ลงเวลาออกช้ากว่าที่สแกนไว้ 30 นาที' },
    { d: '2026-07-11', s: '07:48', e: '17:00', st: 'approved', flat: true, desc: 'ทำงานวันเสาร์ เร่งงานส่งลูกค้า — เหมารายวัน', scan: '07:48 / 17:00' },
    { d: '2026-07-13', s: '17:00', e: '18:30', st: 'approved', desc: 'เก็บงานค้างไลน์ 2', scan: '07:11 / 18:30' },
    { d: '2026-07-14', s: '17:00', e: '18:35', st: 'approved', desc: 'ตรวจนับชิ้นงานก่อนส่งคลัง', scan: '07:34 / 18:35' },
    { d: '2026-07-15', s: '17:00', e: '19:30', st: 'approved', desc: 'เดินไลน์ประกอบต่อจากกะปกติ', scan: '07:34 / 19:30' },
    { d: '2026-07-20', s: '17:00', e: '18:30', st: 'pending_hr', desc: 'เก็บงานค้างไลน์ 2', scan: '07:27 / 18:31' },
    { d: '2026-07-22', s: '17:00', e: '20:00', st: 'pending_mgr', flat: true, desc: 'เร่งงานส่งลูกค้า ลืมสแกนออก — ยื่นแบบเหมารายวัน', scan: '07:19 / (ไม่มีสแกนออก)', off: 'ไม่มีเวลาสแกนออกให้เทียบ' },
  ],
  THT0107: [
    { d: '2026-07-01', s: '17:00', e: '22:59', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:26 / 22:59' },
    { d: '2026-07-02', s: '17:37', e: '20:11', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '17:37 / 18:24 / 20:11' },
    { d: '2026-07-03', s: '17:00', e: '22:36', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:46 / 22:36' },
    { d: '2026-07-06', s: '08:00', e: '17:00', st: 'approved', flat: true, desc: 'คุมเครื่องทั้งวัน — เหมารายวัน', scan: '07:49 / 17:04' },
    { d: '2026-07-07', s: '17:00', e: '23:13', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:11 / 21:48 / 23:13' },
    { d: '2026-07-08', s: '17:00', e: '21:53', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:22 / 21:53' },
    { d: '2026-07-09', s: '17:00', e: '23:09', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:48 / 21:36 / 23:09' },
    { d: '2026-07-10', s: '17:00', e: '23:36', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:46 / 23:36' },
    { d: '2026-07-13', s: '17:00', e: '19:36', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:07 / 19:36' },
    { d: '2026-07-14', s: '17:00', e: '23:20', st: 'approved', desc: 'ซ่อมบำรุงเครื่องจักรหลังเลิกกะ', scan: '07:18 / 23:20' },
    { d: '2026-07-15', s: '17:00', e: '21:16', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:13 / 21:14 / 21:16' },
    { d: '2026-07-16', s: '17:00', e: '21:00', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:41 / 20:13', off: 'ลงเวลาออกช้ากว่าที่สแกนไว้ 47 นาที' },
    { d: '2026-07-17', s: '17:00', e: '22:22', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:08 / 22:22' },
    { d: '2026-07-20', s: '17:00', e: '20:05', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:18 / 20:05' },
    { d: '2026-07-21', s: '17:00', e: '22:27', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:12 / 18:40 / 22:27' },
    { d: '2026-07-22', s: '17:00', e: '22:24', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:20 / 22:24' },
    { d: '2026-07-23', s: '17:00', e: '23:24', st: 'approved', desc: 'ควบคุมเครื่องจักรรอบดึก', scan: '07:36 / 23:24' },
    { d: '2026-07-24', s: '18:10', e: '22:26', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:15 / 18:10 / 22:26' },
    { d: '2026-07-27', s: '17:00', e: '20:20', st: 'approved', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '07:42 / 20:20' },
    { d: '2026-07-30', s: '17:00', e: '21:00', st: 'pending_mgr', desc: 'เดินเครื่องต่อเนื่องหลังเลิกกะ', scan: '17:58 (มีครั้งเดียวทั้งวัน)', off: 'สแกนครั้งเดียว ไม่มีเวลาเข้า–ออกให้เทียบ' },
    { d: '2026-07-31', s: '17:00', e: '22:56', st: 'pending_hr', desc: 'ซ่อมบำรุงเครื่องจักรหลังเลิกกะ', scan: '07:55 / 22:56' },
  ],
};

const at = (date, time) => new Date(`${date}T${time}:00+07:00`);
const plusDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function run() {
  await connect();

  const hr = await Employee.findOne({ code: 'HR-001' });
  if (!hr) throw new Error('ไม่พบบัญชี HR-001');

  // ── พนักงาน ───────────────────────────────────────────────────────────────
  const people = new Map();
  for (const p of PEOPLE) {
    const dept = await Department.findOne({ code: p.dept });
    if (!dept) throw new Error(`ไม่พบแผนก ${p.dept}`);
    let doc = await Employee.findOne({ code: p.code });
    if (doc) {
      console.log(`มีอยู่แล้ว: ${p.code} ${doc.name}`);
    } else {
      doc = new Employee({
        code: p.code,
        name: p.name,
        position: p.position,
        department: dept._id,
        role: 'employee',
        birthDate: p.birthDate,
      });
      // รหัสผ่านแรกคือรหัสพนักงาน และต้องเปลี่ยนเมื่อเข้าใช้ครั้งแรก
      await doc.setPassword(p.code);
      doc.mustChangePassword = true;
      if (!DRY) await doc.save();
      console.log(`${DRY ? '[dry] ' : ''}สร้าง: ${p.code} ${p.name} · ${dept.nameTh} · ${doc.company}`);
    }
    const approver = await Employee.findOne({ code: p.approver });
    if (!approver) throw new Error(`ไม่พบผู้อนุมัติ ${p.approver}`);
    people.set(p.code, { doc, approver, dept });
  }

  // ── ใบ OT ────────────────────────────────────────────────────────────────
  const rows = [];
  for (const p of PEOPLE) {
    const { doc: employee, approver, dept } = people.get(p.code);
    const existing = await OtEntry.countDocuments({ employee: employee._id, period: '2026-07' });
    if (existing && !DRY) {
      if (!REPLACE) {
        console.error(`\n${p.code} มีใบเดือน 2026-07 อยู่แล้ว ${existing} ใบ — ใส่ --replace ถ้าต้องการสร้างใหม่`);
        await disconnect();
        process.exit(1);
      }
      await OtEntry.deleteMany({ employee: employee._id, period: '2026-07' });
      console.log(`ลบใบเดือน 2026-07 ของ ${p.code} เดิม ${existing} ใบ`);
    }

    const list = ENTRIES[p.code];
    const calendar = await loadCalendar(list.map((x) => x.d));

    for (const row of list) {
      const session = {
        workDate: row.d,
        startTime: row.s,
        endTime: row.e,
        noBreakTaken: Boolean(row.nb),
        flatDaily: Boolean(row.flat),
      };
      const ctx = contextFor(calendar, session, employee);
      const result = await compute(session, ctx);
      const cap = await checkCap({
        employee,
        department: dept,
        period: row.d.slice(0, 7),
        result,
        policy: ctx.policy,
      });

      const entry = new OtEntry({
        employee: employee._id,
        department: employee.department,
        filedBy: employee._id,
        ...session,
        description: row.desc,
        status: 'pending_mgr',
      });
      applyComputation(entry, result, ctx);
      stampCap(entry, cap);

      entry.log(employee, 'submit', null, null);
      entry.history.at(-1).at = at(row.d, '21:30');

      if (row.st !== 'pending_mgr') {
        entry.status = 'pending_hr';
        const when = at(plusDays(row.d, 1), '09:20');
        entry.managerDecision = { by: approver._id, at: when, note: 'ตรวจสอบแล้ว' };
        entry.log(approver, 'approve_mgr', null, 'pending_mgr');
        entry.history.at(-1).at = when;
      }
      if (row.st === 'approved') {
        entry.status = 'approved';
        const when = at(plusDays(row.d, 2), '10:40');
        entry.hrDecision = { by: hr._id, at: when, note: 'ยืนยัน' };
        entry.log(hr, 'approve_hr', null, 'pending_hr');
        entry.history.at(-1).at = when;
      }
      if (!DRY) await entry.save();

      // วันที่ยื่น — ให้เป็นเดือนที่ทำงานจริง ไม่ใช่วันที่รันสคริปต์ หน้าจอที่
      // ถามว่า "ค้างมากี่วันแล้ว" นับจากช่องนี้
      if (!DRY) await OtEntry.collection.updateOne(
        { _id: entry._id },
        {
          $set: {
            createdAt: at(row.d, '21:30'),
            updatedAt: entry.hrDecision?.at || entry.managerDecision?.at || at(row.d, '21:30'),
          },
        },
      );

      rows.push({
        code: p.code,
        date: row.d,
        time: `${row.s}-${row.e}${row.n ? '(+1)' : ''}`,
        flat: row.flat ? 'เหมารายวัน' : '',
        hours: result.totals.otHours,
        x15w: result.buckets.ot15_weekday,
        x15h: result.buckets.ot15_holiday,
        x3: result.buckets.ot3_holiday,
        status: entry.status,
        cap: cap.exceeded ? 'เกินเพดาน' : '',
        warn: (result.warnings || []).map((w) => w.code).filter((c) => c !== 'NORMAL_HOURS_IGNORED').join(','),
        scan: row.scan,
        off: row.off || '',
      });
    }
  }

  console.log('\nรหัส      วันที่       เวลาบนใบ          ชม.  x1.5ปกติ x1.5หยุด  x3   สถานะ       หมายเหตุ');
  const total = {};
  for (const r of rows) {
    total[r.code] = (total[r.code] || 0) + r.hours;
    console.log(
      `${r.code.padEnd(9)} ${r.date} ${r.time.padEnd(16)} ${String(r.hours).padStart(5)} `
      + `${String(r.x15w).padStart(7)} ${String(r.x15h).padStart(8)} ${String(r.x3).padStart(4)}  `
      + `${r.status.padEnd(11)} ${[r.flat, r.cap, r.warn, r.off].filter(Boolean).join(' · ')}`,
    );
  }
  console.log('');
  for (const [code, h] of Object.entries(total)) {
    const list = rows.filter((r) => r.code === code);
    console.log(`รวม ${code}: ${h.toFixed(2)} ชั่วโมง · ${list.length} ใบ · ไม่ตรงกับไฟล์สแกน ${list.filter((r) => r.off).length} ใบ · เหมารายวัน ${list.filter((r) => r.flat).length} ใบ`);
  }

  await disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await disconnect().catch(() => {});
  process.exit(1);
});
