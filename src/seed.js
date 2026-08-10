/**
 * Development seed. Run: npm run seed
 *
 * Headcount and the real department list are not yet known (§9), so this is
 * demonstration data, not the Primus roster. Replace it via the Admin screens
 * or the CSV import once HR provides the real list ([OPEN 11]).
 *
 * The OT entries are the five worked examples from requirements §4, so the
 * seeded database doubles as a visual check on the calculation engine.
 */

import 'dotenv/config';
import { connect, disconnect } from './db.js';
import Department from './models/Department.js';
import Employee from './models/Employee.js';
import Holiday from './models/Holiday.js';
import OtEntry from './models/OtEntry.js';
import Setting from './models/Setting.js';
import { loadCalendar, contextFor, compute, applyComputation } from './services/otService.js';

const PASSWORD = process.env.SEED_PASSWORD || 'primus123';

const DEPARTMENTS = [
  // A spread of cap combinations on purpose: both set, monthly only, weekly
  // only, and neither — so the four cases a reviewer has to look at are all
  // reachable in a seeded database without editing one first.
  { code: 'ENG', name: 'Engineering', nameTh: 'วิศวกรรม', monthlyCapHours: 40, weeklyCapHours: 12 },
  { code: 'PROD', name: 'Production', nameTh: 'ผลิต', monthlyCapHours: null, weeklyCapHours: 15 },
  { code: 'QC', name: 'Quality Control', nameTh: 'ควบคุมคุณภาพ', monthlyCapHours: 40, weeklyCapHours: null },
  { code: 'WH', name: 'Warehouse', nameTh: 'คลังสินค้า', monthlyCapHours: null, weeklyCapHours: null },
  { code: 'ADM', name: 'Administration', nameTh: 'สำนักงาน', monthlyCapHours: null, weeklyCapHours: null },
];

const PEOPLE = [
  // managers — one per department (§9). They do not submit OT (§2).
  { code: 'PM-0100', name: 'วิชัย ศรีสุข', position: 'ผู้จัดการฝ่ายวิศวกรรม', dept: 'ENG', role: 'manager' },
  { code: 'PM-0101', name: 'ประเสริฐ วงศ์ทอง', position: 'ผู้จัดการฝ่ายผลิต', dept: 'PROD', role: 'manager' },
  { code: 'PM-0102', name: 'สุนีย์ มั่นคง', position: 'ผู้จัดการฝ่าย QC', dept: 'QC', role: 'manager' },
  { code: 'PM-0103', name: 'อนันต์ ทรัพย์เจริญ', position: 'ผู้จัดการคลังสินค้า', dept: 'WH', role: 'manager' },

  { code: 'HR-001', name: 'มาลี บุญมาก', position: 'เจ้าหน้าที่ฝ่ายบุคคล', dept: 'ADM', role: 'hr' },
  { code: 'ADMIN', name: 'ผู้ดูแลระบบ', position: 'IT', dept: 'ADM', role: 'admin' },

  { code: 'PM-0412', name: 'สมชาย ใจดี', position: 'ช่างเทคนิคอาวุโส', dept: 'ENG', role: 'employee' },
  { code: 'PM-0388', name: 'ธนพล เกษมสุข', position: 'วิศวกรระบบ', dept: 'ENG', role: 'employee' },
  { code: 'PM-0501', name: 'จิราภรณ์ แสงทอง', position: 'เจ้าหน้าที่สอบเทียบ', dept: 'QC', role: 'employee' },
  { code: 'PM-0290', name: 'ณัฐวุฒิ พรหมมา', position: 'ช่างซ่อมบำรุง', dept: 'PROD', role: 'employee' },
  { code: 'PM-0533', name: 'กมลชนก อินทร์แก้ว', position: 'เจ้าหน้าที่ QC', dept: 'QC', role: 'employee' },
  { code: 'PM-0147', name: 'สุรชัย ดวงดี', position: 'ช่างติดตั้ง', dept: 'ENG', role: 'employee' },
  { code: 'PM-0620', name: 'พรทิพย์ สายเพชร', position: 'เจ้าหน้าที่คลังสินค้า', dept: 'WH', role: 'employee' },

  // Themtech. Departments are shared — the split is between payrolls, not
  // between org charts — so these sit in the same แผนก as their Primus
  // colleagues and report to the same หัวหน้างาน. company is left off on
  // purpose: the model reads THT… off the code, which is the path the real
  // roster import takes.
  { code: 'THT0056', name: 'ถาวร แป้นวงษ์', position: 'ช่างประกอบ', dept: 'PROD', role: 'employee' },
  { code: 'THT0074', name: 'สุจินดา แรงกสิวิทย์', position: 'เจ้าหน้าที่ตรวจสอบ', dept: 'QC', role: 'employee' },
  { code: 'THT0018', name: 'จรรยา ประสิทธิ์เกษมกัน', position: 'เจ้าหน้าที่คลังสินค้า', dept: 'WH', role: 'employee' },
];

/**
 * Primus keeps its own calendar, not the government list (§8). These are
 * placeholders — replace with the real one via the import screen ([OPEN 10]).
 */
const HOLIDAYS = [
  { date: '2026-01-01', name: 'วันขึ้นปีใหม่' },
  { date: '2026-04-13', name: 'วันสงกรานต์' },
  { date: '2026-04-14', name: 'วันสงกรานต์' },
  { date: '2026-04-15', name: 'วันสงกรานต์' },
  { date: '2026-08-12', name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง' },
  { date: '2026-12-31', name: 'วันสิ้นปี' },
];

/** Requirements §4, verbatim. Every one is submitted by PM-0412. */
const WORKED_EXAMPLES = [
  {
    label: 'A', workDate: '2026-08-05', startTime: '17:30', endTime: '21:00',
    description: 'แก้ไข wiring ชุดวัดกระแสไลน์ 3', status: 'approved',
  },
  {
    label: 'B', workDate: '2026-08-08', startTime: '08:00', endTime: '17:00',
    description: 'ประกอบตู้ควบคุมไฟฟ้าโครงการ SCG เฟส 2 (พักเที่ยง)', status: 'pending_hr',
  },
  {
    label: 'C', workDate: '2026-08-15', startTime: '08:00', endTime: '17:00', noBreakTaken: true,
    description: 'ทดสอบ calibration ชุด PM-3000 ก่อนส่งมอบ (ไม่พักเที่ยง)', status: 'pending_mgr',
  },
  {
    label: 'D', workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true,
    description: 'ซ่อมด่วน transformer ลูกค้าโรงงานระยอง — ข้ามคืน', status: 'pending_mgr',
  },
  {
    label: 'E', workDate: '2026-08-09', startTime: '06:00', endTime: '10:00',
    description: 'ติดตั้ง power meter ที่ไซต์ลูกค้า อยุธยา', status: 'approved',
  },
];

/**
 * Two more entries, submitted by Themtech staff, so the demo database has OT
 * against both payrolls rather than only Primus. Nothing about the arithmetic
 * differs — company does not enter into it.
 */
const THEMTECH_EXAMPLES = [
  {
    label: 'T1', by: 'THT0056', workDate: '2026-08-06', startTime: '17:00', endTime: '20:00',
    description: 'เดินสายไฟไลน์ประกอบ 2', status: 'approved',
  },
  {
    label: 'T2', by: 'THT0074', workDate: '2026-08-08', startTime: '08:00', endTime: '17:00',
    description: 'ตรวจสอบชิ้นงานส่งมอบ (พักเที่ยง)', status: 'approved',
  },
];

const ALL_EXAMPLES = [...WORKED_EXAMPLES, ...THEMTECH_EXAMPLES];

async function run() {
  await connect();
  console.log('connected');

  await Promise.all([
    Department.deleteMany({}),
    Employee.deleteMany({}),
    Holiday.deleteMany({}),
    OtEntry.deleteMany({}),
    Setting.deleteMany({}),
  ]);
  await Setting.load();

  const depts = new Map();
  for (const d of DEPARTMENTS) depts.set(d.code, await Department.create(d));

  await Holiday.insertMany(HOLIDAYS.map((h) => ({ ...h, year: Number(h.date.slice(0, 4)), source: 'manual' })));

  const people = new Map();
  for (const p of PEOPLE) {
    const employee = new Employee({
      code: p.code,
      name: p.name,
      position: p.position,
      department: depts.get(p.dept)._id,
      role: p.role,
    });
    await employee.setPassword(PASSWORD);
    await employee.save();
    people.set(p.code, employee);
    if (p.role === 'manager') {
      await Department.findByIdAndUpdate(depts.get(p.dept)._id, { manager: employee._id });
    }
  }

  const hr = people.get('HR-001');
  const manager = people.get('PM-0100');
  // One calendar for the run, day types per example: the author differs between
  // them and a birthday is a holiday for one person only.
  const calendar = await loadCalendar(ALL_EXAMPLES.map((e) => e.workDate));

  for (const ex of ALL_EXAMPLES) {
    const author = people.get(ex.by || 'PM-0412');
    const session = {
      workDate: ex.workDate,
      startTime: ex.startTime,
      endTime: ex.endTime,
      endsNextDay: Boolean(ex.endsNextDay),
      noBreakTaken: Boolean(ex.noBreakTaken),
    };
    const ctx = contextFor(calendar, session, author);
    const result = await compute(session, ctx);

    const entry = new OtEntry({
      employee: author._id,
      department: author.department,
      ...session,
      description: ex.description,
      status: ex.status,
    });
    applyComputation(entry, result, ctx);
    entry.log(author, 'submit', `worked example ${ex.label}`, null);
    if (ex.status !== 'pending_mgr') {
      entry.managerDecision = { by: manager._id, at: new Date(), note: 'ตรวจสอบแล้ว' };
      entry.log(manager, 'approve_mgr', null, 'pending_mgr');
    }
    if (ex.status === 'approved') {
      entry.hrDecision = { by: hr._id, at: new Date(), note: 'ยืนยัน' };
      entry.log(hr, 'approve_hr', null, 'pending_hr');
    }
    await entry.save();

    const b = result.buckets;
    console.log(
      `  ${ex.label}  ${author.code}  ${ex.workDate} ${ex.startTime}-${ex.endTime}` +
      `  x1.5วันปกติ=${b.ot15_weekday}  x1.5วันหยุด=${b.ot15_holiday}  x3=${b.ot3_holiday}` +
      `  รวม=${result.totals.otHours}`,
    );
  }

  console.log(`\nseeded ${DEPARTMENTS.length} departments, ${PEOPLE.length} people, ${HOLIDAYS.length} holidays`);
  console.log(`login with any code above, password: ${PASSWORD}`);
  console.log('  employee PM-0412 · manager PM-0100 · hr HR-001 · admin ADMIN');

  await disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
