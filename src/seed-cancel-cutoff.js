/**
 * ข้อมูลตัวอย่างสำหรับเดินดูฟีเจอร์ วันตัดของงวด (`cancelCutoffDay`).
 *
 * Run: npm run seed:cutoff        (--undo ลบฐานตัวอย่างทิ้งทั้งฐาน)
 *      npm run seed:cutoff -- --cutoff 5
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES TO A DATABASE OF ITS OWN, AND THAT IS THE WHOLE POINT
 *
 * A worktree isolates files and nothing else — every tree on this laptop reads
 * the same `.env`, which points at the one `mongod` ฝ่ายบุคคล is using. Seeding
 * demonstration OT into THAT database puts invented hours in front of the
 * people who file real ones, in a system where an hour is a thing payroll pays.
 *
 * So this script does not use `MONGODB_URI` as given. It takes the host from it
 * and swaps the database name for `<name>_cutoff` — same `mongod`, no second
 * process to start, nothing shared with the live data but the port. It REFUSES
 * to run if the target it computed is the live name anyway.
 *
 * `cancelCutoffDay` is set on THAT database's settings singleton. The live
 * policy is not touched, and turning the rule on for the company stays what it
 * was: the user's decision, made on หน้านโยบาย.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH งวด IS CLOSED IS COMPUTED, NEVER WRITTEN DOWN
 *
 * The rule measures against `today()`, so a fixture with dates baked into it is
 * correct on the afternoon it was written and wrong by the next month. Three
 * periods are seeded relative to the day it is run:
 *
 *   งวด M-2  ปิดแน่นอน    — its deadline is a day of M-1, always before today
 *   งวด M-1  แล้วแต่วันนี้ — the boundary: open up to and including วันที่ D
 *   งวด M    เปิดแน่นอน    — its deadline is a day of M+1
 *
 * The printout at the end asks `cancelDeadline` and `isPastCancelCutoff` — the
 * functions the app itself asks — so what it says is what the screens will do,
 * whatever day this is run on. Nothing here re-does the arithmetic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ROW THAT IS HERE TO SHOW NOTHING HAPPENING
 *
 * Each period gets a `rejected` entry. ใบไม่อนุมัติ has no แก้ไข and no ยกเลิก
 * for a reason that has nothing to do with วันตัด — and the screen must NOT
 * print หมดเวลาแก้ไข on it. That is what `wouldOffer` in EmployeeView is for,
 * and a walk that only looks at rows where the sentence is expected cannot see
 * it go wrong.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connect, disconnect } from './db.js';
import Department from './models/Department.js';
import Employee from './models/Employee.js';
import OtEntry from './models/OtEntry.js';
import Setting from './models/Setting.js';
import { loadCalendar, contextFor, compute, applyComputation } from './services/otService.js';
import { cancelDeadline, isPastCancelCutoff } from '../lib/entries.js';
import { periodLabel, thaiDate } from '../lib/api.js';
import { today } from '../lib/today.js';

const PASSWORD = process.env.SEED_PASSWORD || 'primus123';
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const CUTOFF_ARG = argOf('cutoff', '3');
const CUTOFF_DAY = Number(CUTOFF_ARG);
const UNDO = process.argv.includes('--undo');

/**
 * The live URI with its database name swapped. Refuses rather than guesses when
 * the URI has no database name at all — that case connects to `test` on a real
 * server, which is a live database somewhere even if it is not this one.
 */
function demoUri(live) {
  if (!live) throw new Error('MONGODB_URI is not set. Copy .env.example to .env.');
  const m = live.match(/^(.*?\/)([^/?]+)(\?.*)?$/);
  if (!m || !m[2]) throw new Error(`อ่านชื่อฐานข้อมูลจาก MONGODB_URI ไม่ได้: ${live}`);
  const target = `${m[1]}${m[2]}_cutoff${m[3] || ''}`;
  if (target === live) throw new Error('ฐานตัวอย่างชนกับฐานจริง — ไม่รัน');
  return { target, liveName: m[2], demoName: `${m[2]}_cutoff` };
}

const DEPT = { code: 'CUT', name: 'Cutoff Demo', nameTh: 'แผนกทดสอบวันตัด' };

const PEOPLE = [
  { code: 'PM-9001', name: 'สมชาย ใจดี', position: 'ช่างเทคนิค', role: 'employee' },
  { code: 'PM-9002', name: 'หัวหน้า ทดสอบ', position: 'ผู้จัดการแผนกทดสอบ', role: 'supervisor' },
  { code: 'HR-001', name: 'ฝ่ายบุคคล', position: 'บัญชีระบบ', role: 'hr' },
  { code: 'ADMIN', name: 'ผู้ดูแลระบบ', position: 'บัญชีระบบ', role: 'admin' },
];

/** งวดย้อนหลัง n เดือนจากเดือนของ `from`. */
function periodBack(from, n) {
  const [y, m] = from.slice(0, 7).split('-').map(Number);
  const i = (y * 12 + (m - 1)) - n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/**
 * สี่ใบต่อหนึ่งงวด หนึ่งใบต่อหนึ่งปุ่มที่กฎนี้ปิด บวกใบไม่อนุมัติที่ต้องไม่ขึ้นประโยค.
 * งวดที่ปิดแน่นอนได้คำขอถอนสองใบ เพื่อให้ปุ่ม ทั้งหมด ในคิวมีอะไรให้นับ.
 */
function entriesFor(period, { extraWithdrawal }) {
  const rows = [
    { day: 10, status: 'pending_mgr', what: 'แก้ไข · ยกเลิก', description: 'ประกอบชุดสายไฟ' },
    { day: 11, status: 'approved', what: 'ขอถอนใบ', description: 'ตรวจงานส่งมอบ' },
    { day: 12, status: 'approved', withdrawn: true, what: 'ตัดสินคำขอถอน', description: 'ซ่อมสายพาน' },
    { day: 13, status: 'rejected', what: 'ต้องไม่ขึ้นประโยค', description: 'ใบที่หัวหน้าไม่อนุมัติ' },
  ];
  if (extraWithdrawal) {
    rows.push({
      day: 14, status: 'approved', withdrawn: true,
      what: 'ตัดสินคำขอถอน (ใบที่สอง — ให้ปุ่ม ทั้งหมด มีของนับ)',
      description: 'เข้าเวรแทนเพื่อน',
    });
  }
  return rows.map((r) => ({ ...r, period, workDate: `${period}-${String(r.day).padStart(2, '0')}` }));
}

async function run() {
  const { target, liveName, demoName } = demoUri(process.env.MONGODB_URI);
  console.log(`ฐานจริง     ${liveName}  — ไม่ถูกแตะ`);
  console.log(`ฐานตัวอย่าง ${demoName}\n`);

  await connect(target);

  if (UNDO) {
    await mongoose.connection.db.dropDatabase();
    console.log(`ลบฐาน ${demoName} ทิ้งแล้ว — ฐานจริงไม่ถูกแตะ`);
    await disconnect();
    return;
  }

  if (!Number.isInteger(CUTOFF_DAY) || CUTOFF_DAY < 1 || CUTOFF_DAY > 28) {
    throw new Error(`--cutoff ต้องเป็น 1 ถึง 28 — ได้มา ${CUTOFF_ARG}`);
  }

  // ฐานนี้เป็นของสคริปต์นี้ทั้งฐาน ล้างได้โดยไม่ต้องถามใคร — ต่างจาก npm run seed
  // ที่ต้องมี seedGuard เพราะมันเล็งฐานเดียวกับที่คนใช้งานจริง
  await Promise.all([
    Department.deleteMany({}), Employee.deleteMany({}),
    OtEntry.deleteMany({}), Setting.deleteMany({}),
  ]);

  const setting = await Setting.load();
  setting.policy = { ...(setting.policy || {}), cancelCutoffDay: CUTOFF_DAY };
  setting.markModified('policy');
  await setting.save();

  const dept = await Department.create(DEPT);
  const people = new Map();
  for (const p of PEOPLE) {
    const e = new Employee({
      code: p.code, name: p.name, position: p.position,
      department: dept._id, role: p.role,
    });
    await e.setPassword(PASSWORD);
    await e.save();
    people.set(p.code, e);
  }
  await Department.findByIdAndUpdate(dept._id, { manager: people.get('PM-9002')._id });

  const author = people.get('PM-9001');
  const manager = people.get('PM-9002');
  const hr = people.get('HR-001');

  const now = today();
  const PERIODS = [
    { period: periodBack(now, 2), extraWithdrawal: true },
    { period: periodBack(now, 1), extraWithdrawal: false },
    { period: periodBack(now, 0), extraWithdrawal: false },
  ];
  const plan = PERIODS.flatMap((p) => entriesFor(p.period, p));
  const calendar = await loadCalendar(plan.map((e) => e.workDate));
  const policy = await Setting.effectivePolicy();

  const made = [];
  for (const ex of plan) {
    const session = { workDate: ex.workDate, startTime: '18:00', endTime: '21:00', noBreakTaken: false };
    const ctx = contextFor(calendar, session, author);
    const result = await compute(session, ctx);

    const entry = new OtEntry({
      employee: author._id, department: author.department, ...session,
      description: ex.description, status: ex.status,
    });
    applyComputation(entry, result, ctx);
    entry.log(author, 'submit', null, null);

    if (ex.status === 'rejected') {
      entry.managerDecision = { by: manager._id, at: new Date(), note: 'ชั่วโมงไม่ตรงกับที่ตกลงไว้' };
      entry.log(manager, 'reject_mgr', 'ชั่วโมงไม่ตรงกับที่ตกลงไว้', 'pending_mgr');
    } else if (ex.status !== 'pending_mgr') {
      entry.managerDecision = { by: manager._id, at: new Date(), note: 'ตรวจสอบแล้ว' };
      entry.log(manager, 'approve_mgr', null, 'pending_mgr');
    }
    if (ex.status === 'approved') {
      entry.hrDecision = { by: hr._id, at: new Date(), note: 'ยืนยัน' };
      entry.log(hr, 'approve_hr', null, 'pending_hr');
    }
    if (ex.withdrawn) {
      const reason = 'ลงวันที่ผิด ขอถอนใบนี้';
      entry.withdrawal = {
        state: 'requested', requestedBy: author._id, requestedByName: author.name,
        requestedAt: new Date(), reason,
      };
      entry.log(author, 'withdraw_request', reason, entry.status);
    }
    await entry.save();
    made.push({ ...ex, entry });
  }

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  console.log(`วันนี้ ${thaiDate(now)} · วันตัด = วันที่ ${CUTOFF_DAY} ของเดือนถัดจากงวด\n`);
  for (const p of PERIODS) {
    const sample = made.find((m) => m.period === p.period);
    const deadline = cancelDeadline(sample.entry, policy);
    const past = isPastCancelCutoff(sample.entry, policy, now);
    // ● / ○ มาจาก isPastCancelCutoff ตัวเดียวกับที่หน้าจอถาม ไม่ใช่จากตารางที่เขียนไว้
    // ล่วงหน้า — งวดกลางพ้นหรือยังขึ้นกับวันที่รันจริง ๆ
    const edge = deadline === now ? '  ← วันสุดท้าย ยังกดได้ทั้งวัน พรุ่งนี้ปิด' : '';
    console.log(
      `${pad(periodLabel(p.period), 20)} กำหนดสุดท้าย ${thaiDate(deadline)}  ` +
      `${past ? '● พ้นแล้ว' : '○ ยังเปิด'}${edge}`,
    );
    for (const m of made.filter((x) => x.period === p.period)) {
      console.log(`    ${pad(thaiDate(m.workDate), 12)} ${pad(m.status, 12)} ${m.what}`);
    }
  }

  // วันตัดมีค่าเดียวทั้งระบบ งวดที่กำหนดสุดท้ายตรงกับวันนี้พอดีจึงจัดให้ไม่ได้
  // ด้วยค่าใดค่าหนึ่งตายตัว — ต้องตั้งวันตัด = วันที่ของวันนี้ แล้วงวดเดือนก่อน
  // จะไปยืนบนเส้นพอดี ซึ่งเป็นกรณีเดียวที่ off-by-one มองไม่เห็นจากข้างนอก
  if (!PERIODS.some((p) => cancelDeadline(made.find((m) => m.period === p.period).entry, policy) === now)) {
    console.log(`\nอยากเห็นวันสุดท้ายพอดี:  npm run seed:cutoff -- --cutoff ${Number(now.slice(8, 10))}`);
  }

  console.log(`\nเข้าระบบด้วยรหัสผ่าน ${PASSWORD}`);
  console.log('    PM-9001 พนักงาน · PM-9002 หัวหน้า · HR-001 ฝ่ายบุคคล · ADMIN ผู้ดูแลระบบ');
  console.log('\nเปิดแอปชี้มาที่ฐานนี้ — :3000 ยังเสิร์ฟของจริงอยู่ ห้ามแตะ:');
  console.log(`    MONGODB_URI="${target}" npx next dev -p 3001`);
  console.log('\nลบทิ้งเมื่อเดินดูเสร็จ:  npm run seed:cutoff -- --undo');

  await disconnect();
}

/** เฉพาะตอนถูกสั่งเป็นคำสั่ง — เหตุผลเดียวกับที่ src/seed.js มีบรรทัดนี้. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async (err) => {
    console.error(err.message || err);
    await disconnect().catch(() => {});
    process.exit(1);
  });
}
