/**
 * ใบตัวอย่างสำหรับเดินดูฟีเจอร์ วันตัดของงวด (`cancelCutoffDay`) บนฐานของเครื่องนี้.
 *
 * Run: npm run mock:cutoff                 (--cutoff <D> เปลี่ยนวันตัด, ปริยาย 3)
 *      npm run mock:cutoff -- --who PM00xxx
 *      npm run mock:cutoff -- --undo       (เอาทุกอย่างที่มันเขียนออก)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * เขียนลงฐานที่ `.env` ชี้อยู่ — เครื่องนี้เป็นเครื่อง dev
 *
 * สั่งไว้ 2026-09-15. ฉบับก่อนหน้าของสคริปต์นี้ (`645833b`, ถอนด้วย `fc5180c`)
 * สลับชื่อฐานไปเขียนที่ `<ชื่อฐาน>_cutoff` เพื่อกันฐานจริง ซึ่งเป็นการกันในสิ่งที่
 * ไม่ต้องกันบนเครื่องนี้ และแลกมาด้วยการที่ของที่เดินดูไม่ใช่ข้อมูลชุดเดียวกับที่
 * เปิดดูอยู่ทุกวัน
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ของส่วนใหญ่มีอยู่แล้ว สคริปต์นี้เติมเฉพาะที่ขาด
 *
 * ตั้ง `cancelCutoffDay` เมื่อไร ใบทุกใบของงวดที่พ้นกำหนดก็ปิดพร้อมกันทันที —
 * ฐานนี้มีใบงวดสิงหาคมอยู่เกือบสามร้อยใบ และนั่นคือตัวฟีเจอร์เองแล้ว
 *
 * ที่ฐานไม่มีคือ **คำขอถอนที่ยังไม่มีใครตัดสิน** (`withdrawal.state:'requested'`
 * — ศูนย์แถวทั้งฐาน) และชุดสถานะที่ครบทั้งสี่ปุ่มบนคนคนเดียว เพื่อให้ล็อกอิน
 * ครั้งเดียวแล้วเห็นทั้งฝั่งงวดปิดและฝั่งงวดเปิดเทียบกันได้ สคริปต์จึงสร้าง
 * **ใบใหม่ที่ติดป้ายไว้** ไม่แก้ใบที่มีอยู่เดิมแม้แต่ใบเดียว — `--undo` จึงลบ
 * ของตัวเองได้เป๊ะโดยไม่ต้องจำว่าเคยแก้อะไรไว้ตรงไหน
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * งวดไหนปิด คำนวณตอนรัน ไม่ใช่เขียนค่าไว้
 *
 * กฎนี้วัดที่ `today()` ใบที่ฝังวันที่ไว้จึงถูกเฉพาะเดือนที่เขียนมัน สคริปต์
 * ถาม `cancelDeadline` กับ `isPastCancelCutoff` ตัวเดียวกับที่หน้าจอถาม แล้ว
 * **ปฏิเสธถ้าเดือนก่อนยังไม่ปิดด้วยวันตัดที่สั่งมา** — ดีกว่าสร้างใบให้เต็มฐาน
 * แล้วค่อยพบว่าไม่มีอะไรให้ดู
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ใบ `rejected` มีไว้ดูของที่ต้องไม่เกิด
 *
 * ใบไม่อนุมัติไม่มี แก้ไข และไม่มี ยกเลิก ด้วยเหตุคนละเรื่องกับวันตัด หน้าจอจึง
 * ต้อง **ไม่** ขึ้นประโยค `หมดเวลาแก้ไข` บนใบนั้น นั่นคือหน้าที่ของ `wouldOffer`
 * ใน EmployeeView และการเดินดูที่มองเฉพาะแถวที่คาดว่าประโยคจะขึ้น มองไม่เห็นข้อนี้
 */
import 'dotenv/config';
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

/**
 * ป้ายที่ทำให้แถวของสคริปต์นี้แยกออกจากใบจริงได้ ทั้งด้วยตาบนหน้าจอและด้วย query
 * ตอน `--undo` อยู่ใน `description` เพราะนั่นคือช่องที่ขึ้นทุกที่ที่ใบขึ้น —
 * ตาราง ใบพิมพ์ ไฟล์ส่งออก ป้ายที่ซ่อนอยู่ในฟิลด์ที่ไม่มีใครเห็นคือป้ายที่
 * ไม่ได้เตือนใคร
 */
const TAG = '[ตัวอย่างวันตัด]';
/**
 * แถวของสคริปต์นี้ เป็น regex ที่ประกอบจาก TAG ที่เดียว ไม่ใช่ค่าที่สองที่ต้องคอย
 * ดูให้ตรงกัน — ป้ายกับตัวกรองที่หลุดกันเมื่อไร `--undo` จะลบไม่ครบหรือลบเกิน
 */
const TAGGED = new RegExp(`^${TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const CUTOFF_ARG = argOf('cutoff', '3');
const CUTOFF_DAY = Number(CUTOFF_ARG);
const WHO = argOf('who', 'PM00112');
const UNDO = process.argv.includes('--undo');

/** งวดย้อนหลัง n เดือนจากเดือนของ `from`. */
function periodBack(from, n) {
  const [y, m] = from.slice(0, 7).split('-').map(Number);
  const i = (y * 12 + (m - 1)) - n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/**
 * สี่ใบต่อหนึ่งงวด ใบละหนึ่งปุ่มที่กฎนี้ปิด บวกใบไม่อนุมัติที่ต้องไม่ขึ้นประโยค.
 * งวดที่ปิดแล้วได้คำขอถอนสองใบ เพื่อให้ปุ่ม ทั้งหมด ในคิวมีของให้นับ — ปุ่มที่
 * ชื่อ ทั้งหมด แล้วเคลียร์ได้ใบเดียวดูไม่ออกว่าถูกหรือผิด
 *
 * **รายละเอียดงานบอกด้วยว่าแถวนี้อยู่ฝั่งไหน** ฉบับแรกติดป้ายเดียวกันทั้งสองฝั่ง
 * สองชุดจึงหน้าตาเหมือนกันบนจอ และ 2026-09-15 คนเดินดูกด ขอถอนใบ บนแถวของงวดที่
 * ยังเปิด (`2026-09-28` เหตุผล `ทดสอบ`) แล้วมันผ่าน — ซึ่งถูกต้อง แต่อ่านออกมา
 * เหมือนฟีเจอร์ไม่ทำงาน ชุดของงวดที่ยังเปิดคือ **ของเทียบ** และของเทียบที่ไม่ได้
 * บอกว่าตัวเองเป็นของเทียบ คือกับดัก
 */
function planFor(period, closed, freeDays) {
  const side = closed ? 'งวดปิดแล้ว' : 'ของเทียบ งวดยังเปิด';
  const rows = [
    { status: 'pending_mgr', what: 'แก้ไข · ยกเลิก', description: 'ประกอบชุดสายไฟไลน์ 2' },
    { status: 'approved', what: 'ขอถอนใบ', description: 'ตรวจงานก่อนส่งมอบ' },
    { status: 'approved', withdrawn: true, what: 'ตัดสินคำขอถอน', description: 'ซ่อมสายพานลำเลียง' },
    { status: 'rejected', what: 'ต้องไม่ขึ้นประโยค', description: 'ใบที่หัวหน้าไม่อนุมัติ' },
  ];
  if (closed) {
    rows.push({
      status: 'approved', withdrawn: true,
      what: 'ตัดสินคำขอถอน (ใบที่สอง ให้ปุ่ม ทั้งหมด มีของนับ)',
      description: 'เข้าเวรแทนเพื่อน',
    });
  }
  if (freeDays.length < rows.length) {
    throw new Error(`งวด ${periodLabel(period)} เหลือวันว่างไม่พอ (${freeDays.length}/${rows.length})`);
  }
  return rows.map((r, i) => ({
    ...r,
    period,
    closed,
    description: `${side} · ${r.description}`,
    workDate: `${period}-${String(freeDays[i]).padStart(2, '0')}`,
  }));
}

/**
 * วันในงวดที่เจ้าของใบยังไม่มีใบอยู่ ไล่จากวันหลังสุดที่ใช้ได้ขึ้นมา.
 *
 * เดิมสคริปต์ตรึงวันที่ 24–28 ไว้ แล้วปฏิเสธถ้าชนใบจริง ซึ่งเป็นการโยนงานกลับไป
 * ให้คนสั่ง — ฐานนี้มีใบงวดสิงหาคมเกือบสามร้อยใบ คนที่มีใบเยอะที่สุดคือคนที่
 * เหมาะจะเป็นตัวอย่างที่สุด และก็เป็นคนที่ชนแน่นอนที่สุดด้วย
 *
 * **ไม่เลยวันนี้** `notAfter` มีไว้เพื่อข้อนี้ข้อเดียว ฉบับก่อนไล่จากปลายเดือน
 * ทุกงวด งวดที่กำลังเดินอยู่จึงได้ใบลงวันที่ 27–30 ทั้งที่วันนี้เพิ่งวันที่ 15
 * — ใบที่ **แอปเองสร้างไม่ได้** เพราะ `maxAdvanceSubmissionDays` บนฐานนี้คือ 7
 * วัน (`advanceSubmissionRefusal`) ตัวอย่างที่เส้นทางปกติไม่มีวันผลิตออกมาได้
 * ไม่ใช่ตัวอย่างของอะไร และคนเดินดูจะเสียเวลาไปกับการสงสัยว่าวันที่นั้นมาจากไหน
 */
async function freeDaysIn(period, employeeId, want, notAfter) {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const capped = notAfter && notAfter.slice(0, 7) === period
    ? Math.min(lastDay, Number(notAfter.slice(8, 10)))
    : lastDay;
  const taken = new Set(
    (await OtEntry.find({ employee: employeeId, period }).select('workDate').lean())
      .map((e) => Number(e.workDate.slice(8, 10))),
  );
  const free = [];
  for (let d = capped; d >= 1 && free.length < want; d -= 1) if (!taken.has(d)) free.push(d);
  return free.reverse();
}

/**
 * คนเซ็น — และคนที่จะ **เห็นแถวนี้ในคิว** ซึ่งเป็นคำถามคนละข้อกับ "ใครเป็นหัวหน้า".
 *
 * ไม่ใช่ `Department.manager` แม้จะเป็นช่องที่ชื่อตรงที่สุด: ฐานนี้มี 18 แผนก
 * และ **ไม่มีแผนกไหนตั้งค่านั้นไว้เลยสักแผนก** (ตรวจ 2026-09-15) คิวไม่ได้อ่าน
 * ช่องนั้นอยู่แล้ว — `scopeFor` → `ownClaims` → `approvalDepartments` ตอบเป็น
 * *แผนกของผู้เซ็นเอง* บวก `approvesDepartments` ดังนั้นคนที่เห็นใบของ subject
 * คือผู้เซ็นที่สังกัดแผนกเดียวกัน
 *
 * ฉบับแรกหยิบ `Department.manager` ก่อนแล้วตกไปที่ผู้เซ็นคนแรกที่หาเจอ ผลคือ
 * ใบพิมพ์บอกให้ล็อกอินเป็น PM00013 ซึ่งอยู่คนละแผนกและเปิดคิวมาแล้วว่างเปล่า —
 * คำแนะนำที่ผิดแบบที่คนอ่านจะโทษฟีเจอร์ ไม่ใช่โทษคำแนะนำ
 */
const SIGNER_ROLES = ['supervisor', 'dept_manager', 'division_manager'];

async function signersFor(subject) {
  const manager = await Employee.findOne({
    department: subject.department, role: { $in: SIGNER_ROLES }, active: true,
  }) || await Employee.findOne({
    approvesDepartments: subject.department, role: { $in: SIGNER_ROLES }, active: true,
  });
  const hr = await Employee.findOne({ role: 'hr', active: true });
  const dept = await Department.findById(subject.department).lean();
  if (!manager) {
    throw new Error(
      `ไม่มีผู้เซ็นคนไหนสังกัดแผนก ${dept?.nameTh || dept?.code} — คิวคำขอถอนของ ` +
      `${subject.code} จะว่างเปล่าสำหรับทุกคน\nเลือกคนอื่นด้วย --who`,
    );
  }
  if (!hr) throw new Error('ไม่พบบัญชีฝ่ายบุคคลสำหรับเซ็นใบตัวอย่าง');
  return { manager, hr, dept };
}

async function undo() {
  const gone = await OtEntry.deleteMany({ description: TAGGED });
  const setting = await Setting.load();
  const had = Object.prototype.hasOwnProperty.call(setting.policy || {}, 'cancelCutoffDay');
  const was = setting.policy?.cancelCutoffDay;
  if (had) {
    delete setting.policy.cancelCutoffDay;
    setting.markModified('policy');
    await setting.save();
  }
  console.log(`ลบใบตัวอย่าง ${gone.deletedCount} ใบ`);
  // ตั้งกลับเป็น ไม่กำหนด เสมอ ไม่ใช่กลับไปเป็นค่าที่เคยมีอยู่ก่อนรัน — สคริปต์นี้
  // ไม่จำค่าเดิม ถ้ามีคนตั้งวันตัดไว้จริงก่อนหน้านี้ ต้องไปตั้งใหม่ที่หน้านโยบาย
  console.log(had
    ? `ตั้ง cancelCutoffDay กลับเป็น ไม่กำหนด (เดิมในฐานคือ ${was} — ถ้าเป็นค่าที่ตั้งไว้เองไม่ใช่ของสคริปต์ ต้องไปตั้งคืนที่หน้านโยบาย)`
    : 'cancelCutoffDay ไม่ได้ตั้งไว้อยู่แล้ว ไม่ต้องคืนค่า');
  console.log('ใบที่มีอยู่เดิมไม่ถูกแตะ — สคริปต์นี้ไม่เคยแก้ใบที่ไม่ได้สร้างเอง');
}

async function run() {
  await connect();
  console.log(`ฐาน ${process.env.MONGODB_URI.replace(/^.*\//, '')}\n`);

  if (UNDO) {
    await undo();
    await disconnect();
    return;
  }

  if (!Number.isInteger(CUTOFF_DAY) || CUTOFF_DAY < 1 || CUTOFF_DAY > 28) {
    throw new Error(`--cutoff ต้องเป็น 1 ถึง 28 — ได้มา ${CUTOFF_ARG}`);
  }

  const subject = await Employee.findOne({ code: WHO.toUpperCase() });
  if (!subject) throw new Error(`ไม่พบพนักงานรหัส ${WHO} — สั่ง --who <รหัส> ให้ตรงกับทะเบียน`);
  const { manager, hr, dept } = await signersFor(subject);

  /**
   * นโยบายที่ "จะเป็น" ประกอบไว้ในหน่วยความจำก่อน ยังไม่บันทึก — ทุกคำปฏิเสธ
   * ข้างล่างจึงเกิดขึ้นบนฐานที่ยังไม่ถูกแตะเลย ฉบับแรกของสคริปต์นี้บันทึกก่อน
   * ตรวจ แล้วชนใบจริงของ PM00112 ซึ่งออกจากการรันโดยทิ้ง cancelCutoffDay ที่
   * ตั้งค้างไว้กับฐาน ทั้งที่ประกาศว่าไม่ได้สร้างอะไร
   */
  const policy = { ...(await Setting.effectivePolicy()), cancelCutoffDay: CUTOFF_DAY };

  const now = today();
  const CLOSED = periodBack(now, 1);
  const OPEN = periodBack(now, 0);

  // ถามฟังก์ชันจริงว่างวดก่อนปิดหรือยัง แทนที่จะเชื่อว่าปิด — วันตัดที่มากกว่า
  // วันที่ของวันนี้ทำให้งวดก่อนยังเปิด และเดินดูแล้วจะไม่เห็นอะไรเลย
  const probe = { workDate: `${CLOSED}-15` };
  if (!isPastCancelCutoff(probe, policy, now)) {
    throw new Error(
      `วันนี้ ${thaiDate(now)} · วันตัด ${CUTOFF_DAY} ทำให้งวด ${periodLabel(CLOSED)} ` +
      `ยังไม่ปิด (กำหนดสุดท้าย ${thaiDate(cancelDeadline(probe, policy))})\n` +
      'ไม่ได้เขียนอะไรลงฐาน — สั่ง --cutoff ที่น้อยกว่าวันที่ของวันนี้',
    );
  }

  // ลบของรันก่อนหน้าก่อนหาวันว่าง ไม่งั้นใบตัวอย่างของเมื่อวานจะนับเป็นวันที่ไม่ว่าง
  // แล้วชุดใหม่จะเลื่อนถอยไปเรื่อย ๆ ทุกครั้งที่รัน
  const cleared = await OtEntry.deleteMany({ description: TAGGED });
  const plan = [
    ...planFor(CLOSED, true, await freeDaysIn(CLOSED, subject._id, 5, now)),
    ...planFor(OPEN, false, await freeDaysIn(OPEN, subject._id, 4, now)),
  ];
  if (cleared.deletedCount) console.log(`ลบใบตัวอย่างของรันก่อนหน้า ${cleared.deletedCount} ใบ\n`);

  const calendar = await loadCalendar(plan.map((p) => p.workDate));
  const made = [];
  for (const ex of plan) {
    const session = { workDate: ex.workDate, startTime: '18:00', endTime: '21:00', noBreakTaken: false };
    const ctx = contextFor(calendar, session, subject);
    const result = await compute(session, ctx);

    const entry = new OtEntry({
      employee: subject._id, department: subject.department, ...session,
      description: `${TAG} ${ex.description}`, status: ex.status,
    });
    applyComputation(entry, result, ctx);
    entry.log(subject, 'submit', null, null);

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
        state: 'requested', requestedBy: subject._id, requestedByName: subject.name,
        requestedAt: new Date(), reason,
      };
      entry.log(subject, 'withdraw_request', reason, entry.status);
    }
    await entry.save();
    made.push({ ...ex, entry });
  }

  // ท้ายสุด เพราะนี่คือบรรทัดที่เปลี่ยนสิ่งที่ทั้งบริษัทเห็น ใบตัวอย่างที่ค้างอยู่
  // โดยยังไม่มีวันตัดคือข้อมูลเกินมาสี่ห้าแถว วันตัดที่ตั้งไว้โดยยังไม่มีใบให้ดู
  // คือปุ่มที่หายไปจากจอของทุกคนโดยไม่มีอะไรอธิบาย
  const setting = await Setting.load();
  setting.policy = { ...(setting.policy || {}), cancelCutoffDay: CUTOFF_DAY };
  setting.markModified('policy');
  await setting.save();

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  console.log(`วันนี้ ${thaiDate(now)} · วันตัด = วันที่ ${CUTOFF_DAY} ของเดือนถัดจากงวด`);
  console.log(`เจ้าของใบ ${subject.code} ${subject.name} · ${dept?.nameTh || dept?.code}\n`);

  for (const period of [CLOSED, OPEN]) {
    const rows = made.filter((m) => m.period === period);
    const deadline = cancelDeadline(rows[0].entry, policy);
    const past = isPastCancelCutoff(rows[0].entry, policy, now);
    const others = await OtEntry.countDocuments({
      period, description: { $not: TAGGED },
    });
    console.log(
      `${pad(periodLabel(period), 18)} กำหนดสุดท้าย ${thaiDate(deadline)}  ` +
      `${past ? '● พ้นแล้ว' : '○ ยังเปิด'}   ` +
      `(ใบเดิมในงวดนี้อีก ${others} ใบ ${past ? 'ปิดไปด้วยทั้งหมด' : 'ยังกดได้ตามปกติ'})`,
    );
    for (const m of rows) console.log(`    ${pad(thaiDate(m.workDate), 12)} ${pad(m.status, 12)} ${m.what}`);
  }

  console.log('\nเดินดูที่ไหน');
  console.log(`    หน้าพนักงาน      ล็อกอิน ${subject.code} — ฝั่งงวดปิดปุ่มหาย เหลือประโยค ฝั่งงวดเปิดปุ่มครบ`);
  console.log(`    คิวคำขอถอน       ล็อกอิน ${manager.code} ${manager.name} — ปุ่มคู่เทาพร้อมเหตุผล`);
  console.log(`    ฟอร์มแก้ไขของ HR  ล็อกอิน ${hr.code} ${hr.name} — แถบเตือน แล้วกล่องยืนยันตอนบันทึก`);
  console.log(`    ตัดสินคำขอถอน     ${hr.code} ผ่านได้ แต่งวดที่ปิดแล้วบังคับกรอกเหตุผล`);
  console.log('\nเก็บกวาด:  npm run mock:cutoff -- --undo   (ลบใบตัวอย่างและคืน cancelCutoffDay เป็น ไม่กำหนด)');

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
