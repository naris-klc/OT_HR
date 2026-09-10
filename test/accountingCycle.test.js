import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cyclePeriods, cycleTag, shortMonth, mergeAccountingReports, MAX_CYCLE_MONTHS,
} from '../lib/accountingCycle.js';

/**
 * งวดจ่ายสองเดือน — ใบเดียว ยอดเดียว.
 *
 * พฤศจิกายนกับธันวาคมถูกรวบจ่ายทีเดียวในเดือนมกราคมทุกปี ใบที่ส่งบัญชีตอนนั้นจึง
 * มีสองเดือนอยู่ในใบเดียวพร้อมยอดรวมของงวด สิ่งที่ไฟล์นี้ยึดคือสองอย่างที่ผิด
 * แล้วเงียบ:
 *
 *   1. **ยอดรวมต้องเป็นผลบวกจริงของสองเดือน** ทุกระดับ — แถว แผนก บริษัท
 *      ยอดใหญ่ ใบที่บวกผิดหนึ่งช่องยังบวกลงตัวกับตัวเองทุกทาง
 *   2. **จำนวนคนบวกไม่ได้** คนที่ทำ OT ทั้งสองเดือนคือคนคนเดียว — `headcount`
 *      กับ `pending.employees` ที่บวกกันตรง ๆ จะเกินจริงทันทีและไม่มีอะไรค้าน
 *
 * และข้อที่สาม ซึ่งเป็นข้อที่ทำให้ทั้งระบบไม่มีสาขาลับ: **รวมของเดือนเดียวคือ
 * ตัวมันเอง** ทุกเราต์เดินผ่าน `mergeAccountingReports` เสมอ ถ้าข้อนี้พัง ใบที่
 * ออกทุกเดือนพังไปด้วยโดยที่ไม่มีใครขอให้มันเปลี่ยน
 *
 * ไม่มีฐานข้อมูลในไฟล์นี้ — lib/accountingCycle.js ไม่แตะ mongoose เลย ซึ่งเป็น
 * เหตุผลที่มันแยกจาก lib/accounting.js ตั้งแต่แรก
 *
 * Run with: npm test
 */

const B15W = 'ot15_weekday';
const B15H = 'ot15_holiday';
const B3H = 'ot3_holiday';

const zeroBuckets = () => ({ [B15W]: 0, [B15H]: 0, [B3H]: 0 });

/** แถวคนหนึ่งของเดือนหนึ่ง ตามรูปที่ `accountingReport` ส่งออกมา */
function row({
  id, code, name = 'ทดสอบ', dept = { id: 'd1', code: 'D1', name: 'ผลิต', otMode: 'normal' },
  w15 = 0, h15 = 0, h3 = 0, entries = 0, pendingCount = 0, pendingHours = 0,
  birthday = 0, over = 0,
}) {
  const ot15 = w15 + h15;
  return {
    employee: { id, code, name, position: '' },
    department: dept,
    company: 'PM',
    companyLabel: 'ไพรมัส',
    buckets: { [B15W]: w15, [B15H]: h15, [B3H]: h3 },
    ot15Hours: ot15,
    ot3Hours: h3,
    otHours: ot15 + h3,
    weightedHours: ot15 * 1.5 + h3 * 3,
    entryCount: entries,
    pendingCount,
    pendingHours,
    birthdayHours: birthday,
    overCeiling: {
      count: over,
      hours: over ? 4 : 0,
      notes: over ? [{ workDate: '2026-11-03', hours: 4, reason: 'ปิดงาน', waivedReason: null, waived: false }] : [],
    },
  };
}

const totalsOf = (rows) => ({
  buckets: rows.reduce((acc, r) => ({
    [B15W]: acc[B15W] + r.buckets[B15W],
    [B15H]: acc[B15H] + r.buckets[B15H],
    [B3H]: acc[B3H] + r.buckets[B3H],
  }), zeroBuckets()),
  ot15Hours: rows.reduce((n, r) => n + r.ot15Hours, 0),
  ot3Hours: rows.reduce((n, r) => n + r.ot3Hours, 0),
  otHours: rows.reduce((n, r) => n + r.otHours, 0),
  weightedHours: rows.reduce((n, r) => n + r.weightedHours, 0),
  birthdayHours: rows.reduce((n, r) => n + r.birthdayHours, 0),
  entryCount: rows.reduce((n, r) => n + r.entryCount, 0),
  rowCount: rows.length,
  headcount: rows.filter((r) => r.otHours > 0).length,
});

/** รายงานของหนึ่งเดือน ตามรูปที่ `accountingReport` คืน */
function report(period, rows, { pendingIds = [], pendingCount = 0, pendingHours = 0, superseded = 0 } = {}) {
  const pending = {
    count: pendingCount,
    hours: pendingHours,
    employees: pendingIds.length,
    ids: pendingIds,
  };
  const totals = totalsOf(rows);
  return {
    period,
    company: 'all',
    includeZero: true,
    statuses: ['approved'],
    companies: [{
      key: 'PM',
      nameTh: 'บริษัท ไพรมัส จำกัด',
      nameEn: 'Primus',
      shortTh: 'ไพรมัส',
      shortEn: 'PM',
      accountingCode: 'PM',
      rows,
      totals,
      pending,
      departments: [{ department: rows[0]?.department ?? null, totals }],
    }],
    supersededCount: superseded,
    unaccounted: { count: 0, hours: 0, entries: [] },
    reconciliation: {
      filed: totals.otHours,
      reported: totals.otHours,
      unaccounted: 0,
      balanced: true,
      entriesFiled: totals.entryCount,
      entriesReported: totals.entryCount,
      entriesUnaccounted: 0,
    },
    grandTotal: totals,
    pending,
  };
}

// ── เดือนของงวด ─────────────────────────────────────────────────────────────

test('เดือนของงวดเรียงปฏิทินเสมอ ไม่ว่าผู้ใช้จะเลือกทางไหนก่อน', () => {
  assert.deepEqual(cyclePeriods('2026-12', '2026-11'), ['2026-11', '2026-12']);
  assert.deepEqual(cyclePeriods('2026-11', '2026-12'), ['2026-11', '2026-12']);
});

test('เดือนซ้ำ ว่าง และเกินสองเดือน ถูกตัดทิ้ง', () => {
  assert.deepEqual(cyclePeriods('2026-11', ''), ['2026-11']);
  assert.deepEqual(cyclePeriods('2026-11', '2026-11'), ['2026-11']);
  assert.equal(cyclePeriods('2026-10', '2026-11', '2026-12').length, MAX_CYCLE_MONTHS);
});

test('ชื่อไฟล์ของเดือนเดียวไม่ขยับสักตัวอักษร', () => {
  assert.equal(cycleTag(['2026-09']), '2026-09');
  assert.equal(cycleTag(['2026-11', '2026-12']), '2026-11+2026-12');
});

test('ชื่อเดือนย่อพา ปี พ.ศ. สองหลักมาด้วยเสมอ — งวดข้ามปีมีจริง', () => {
  assert.equal(shortMonth('2026-11'), 'พ.ย. 69');
  assert.equal(shortMonth('2027-01'), 'ม.ค. 70');
});

// ── รวมของเดือนเดียวคือตัวมันเอง ────────────────────────────────────────────

test('รวมรายงานเดือนเดียวแล้วได้ตัวเลขชุดเดิมทุกช่อง', () => {
  const rows = [row({ id: 'e1', code: 'PM00002', w15: 3, h3: 3, entries: 2 })];
  const one = report('2026-09', rows);
  const merged = mergeAccountingReports([one]);

  assert.deepEqual(merged.periods, ['2026-09']);
  assert.equal(merged.period, '2026-09');

  const before = one.companies[0];
  const after = merged.companies[0];
  assert.equal(after.totals.otHours, before.totals.otHours);
  assert.equal(after.totals.headcount, before.totals.headcount);
  assert.equal(after.totals.rowCount, before.totals.rowCount);
  assert.deepEqual(after.totals.buckets, before.totals.buckets);
  assert.equal(after.rows.length, 1);

  // `months[0]` ของงวดเดือนเดียวคือยอดของทั้งแถว — ใบพิมพ์กับ CSV อ่านช่องนี้
  // ทางเดียวกันทั้งสองโหมด ถ้าข้อนี้พัง ใบที่ออกทุกเดือนพังด้วย
  assert.equal(after.rows[0].months.length, 1);
  assert.equal(after.rows[0].months[0].ot15Hours, after.rows[0].ot15Hours);
  assert.equal(after.rows[0].months[0].ot3Hours, after.rows[0].ot3Hours);
});

// ── สองเดือน: ยอดรวมคือผลบวกจริง ────────────────────────────────────────────

test('ยอดของแถวคือผลบวกของสองเดือน ทุกช่อง', () => {
  const nov = report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 6, h15: 2, h3: 3, entries: 3, birthday: 2 })]);
  const dec = report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 4, h15: 0, h3: 1, entries: 2 })]);

  const merged = mergeAccountingReports([dec, nov]); // สลับลำดับมาโดยตั้งใจ
  assert.deepEqual(merged.periods, ['2026-11', '2026-12']);

  const [r] = merged.companies[0].rows;
  assert.deepEqual(r.months.map((m) => m.period), ['2026-11', '2026-12']);
  assert.equal(r.months[0].ot15Hours, 8);
  assert.equal(r.months[1].ot15Hours, 4);
  assert.equal(r.ot15Hours, 12, 'รวม 1.50 ต้องเป็น พ.ย. + ธ.ค.');
  assert.equal(r.ot3Hours, 4, 'รวม 3.00 ต้องเป็น พ.ย. + ธ.ค.');
  assert.equal(r.otHours, 16);
  assert.equal(r.entryCount, 5);
  assert.equal(r.birthdayHours, 2, 'วันเกิดของเดือนใดเดือนหนึ่งยังติดมาที่แถว');
  assert.deepEqual(r.buckets, { [B15W]: 10, [B15H]: 2, [B3H]: 4 });
});

test('คนที่มี OT เดือนเดียวได้แถวเดียว อีกเดือนเป็นศูนย์ ไม่ใช่แถวที่สอง', () => {
  const nov = report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 8, entries: 4 })]);
  const dec = report('2026-12', [row({ id: 'e2', code: 'PM00012', w15: 5, entries: 2 })]);

  const { rows } = mergeAccountingReports([nov, dec]).companies[0];
  assert.equal(rows.length, 2);

  const first = rows.find((r) => r.employee.code === 'PM00002');
  assert.equal(first.months[0].ot15Hours, 8);
  assert.equal(first.months[1].ot15Hours, 0, 'เดือนที่ไม่มีต้องเป็นศูนย์ — ใบพิมพ์แปลงเป็นช่องว่างเอง');
  assert.equal(first.ot15Hours, 8);
});

test('จำนวนคนไม่ถูกนับสองรอบ — คนที่ทำ OT ทั้งสองเดือนคือคนคนเดียว', () => {
  const both = { id: 'e1', code: 'PM00002', w15: 4, entries: 1 };
  const merged = mergeAccountingReports([
    report('2026-11', [row(both), row({ id: 'e2', code: 'PM00012', w15: 2, entries: 1 })]),
    report('2026-12', [row(both)]),
  ]);

  const { totals } = merged.companies[0];
  assert.equal(totals.rowCount, 2, 'สองคน ไม่ใช่สามแถว');
  assert.equal(totals.headcount, 2, 'ไม่ใช่ 3 — คนที่ทำทั้งสองเดือนถูกนับรอบเดียว');
  assert.equal(totals.otHours, 10);
  assert.equal(merged.grandTotal.headcount, 2);
});

test('บรรทัดรวมแผนกและรวมทั้งหมด มีตัวเลขรายเดือนให้ลงคอลัมน์ของตัวเอง', () => {
  const merged = mergeAccountingReports([
    report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 6, h3: 2, entries: 2 })]),
    report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 4, entries: 1 })]),
  ]);

  const [dept] = merged.companies[0].departments;
  assert.deepEqual(dept.totals.months.map((m) => m.period), ['2026-11', '2026-12']);
  assert.equal(dept.totals.months[0].ot15Hours, 6);
  assert.equal(dept.totals.months[1].ot15Hours, 4);
  // บวกตามแนวนอนแล้วต้องได้ยอดรวมที่พิมพ์อยู่คอลัมน์สุดท้ายพอดี
  assert.equal(
    dept.totals.months.reduce((n, m) => n + m.ot15Hours, 0),
    dept.totals.ot15Hours,
  );
  assert.equal(merged.companies[0].totals.months[0].otHours, 8);
});

test('ชั่วโมงเกินเพดานของแต่ละเดือนอยู่กับเดือนของมัน และรวมกันที่แถว', () => {
  const merged = mergeAccountingReports([
    report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 9, entries: 3, over: 1 })]),
    report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 4, entries: 1 })]),
  ]);

  const [r] = merged.companies[0].rows;
  assert.equal(r.months[0].overCeiling.count, 1, 'พฤศจิกายนเป็นเดือนที่มีคนเซ็นเกิน');
  assert.equal(r.months[1].overCeiling.count, 0, 'ธันวาคมไม่ใช่ — ตัวเลขเดือนนั้นต้องไม่แดง');
  assert.equal(r.overCeiling.count, 1);
  assert.equal(r.overCeiling.notes.length, 1, 'เหตุผลของผู้อนุมัติต้องไม่หายไปตอนรวม');
});

test('ลำดับแถวยังเป็นลำดับตัวเลขของรหัสพนักงานหลังรวม', () => {
  const merged = mergeAccountingReports([
    report('2026-11', [
      row({ id: 'e3', code: 'PM00416', w15: 1, entries: 1 }),
      row({ id: 'e2', code: 'PM-0412', w15: 1, entries: 1 }),
    ]),
    report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 1, entries: 1 })]),
  ]);

  assert.deepEqual(
    merged.companies[0].rows.map((r) => r.employee.code),
    ['PM00002', 'PM-0412', 'PM00416'],
    'PM-0412 ต้องมาก่อน PM00416 — เลข 412 น้อยกว่า 416 ไม่ใช่การเทียบตัวอักษร',
  );
});

// ── ของที่ต้องไม่ถูกนับสองรอบเหมือนกัน ──────────────────────────────────────

test('ค้างอนุมัติ: ใบกับชั่วโมงบวกกัน แต่จำนวนคนนับจากยูเนียน', () => {
  const merged = mergeAccountingReports([
    report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 1, entries: 1 })], {
      pendingIds: ['e1', 'e2'], pendingCount: 3, pendingHours: 9,
    }),
    report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 1, entries: 1 })], {
      pendingIds: ['e1'], pendingCount: 2, pendingHours: 6,
    }),
  ]);

  assert.equal(merged.pending.count, 5);
  assert.equal(merged.pending.hours, 15);
  assert.equal(merged.pending.employees, 2, 'e1 ค้างทั้งสองเดือน แต่เป็นคนเดียว');
  assert.deepEqual(
    merged.pending.months.map((m) => [m.period, m.count]),
    [['2026-11', 3], ['2026-12', 2]],
    'ประโยคเตือนต้องบอกได้ว่าต้องไปปิดคิวเดือนไหน',
  );
});

test('ใบซ้ำช่วงเวลาเดิมของทั้งสองเดือนถูกรายงานรวมกัน', () => {
  const merged = mergeAccountingReports([
    report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 1, entries: 1 })], { superseded: 2 }),
    report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 1, entries: 1 })], { superseded: 1 }),
  ]);
  assert.equal(merged.supersededCount, 3);
});

test('เดือนที่กระทบยอดไม่ลงทำให้ทั้งงวดไม่ลง — ขาดคนละทางแล้วบวกลงตัวไม่นับว่าผ่าน', () => {
  const nov = report('2026-11', [row({ id: 'e1', code: 'PM00002', w15: 4, entries: 1 })]);
  nov.reconciliation.balanced = false;
  nov.reconciliation.unaccounted = 3.5;
  nov.unaccounted = {
    count: 1,
    hours: 3.5,
    entries: [{ id: 'x1', workDate: '2026-11-04', department: 'ผลิต', otHours: 3.5, employeeId: null, filedBy: null }],
  };

  const merged = mergeAccountingReports([
    nov,
    report('2026-12', [row({ id: 'e1', code: 'PM00002', w15: 4, entries: 1 })]),
  ]);

  assert.equal(merged.reconciliation.balanced, false);
  assert.deepEqual(
    merged.reconciliation.months.map((m) => [m.period, m.balanced]),
    [['2026-11', false], ['2026-12', true]],
  );
  assert.equal(merged.unaccounted.count, 1);
  assert.equal(
    merged.unaccounted.entries[0].period,
    '2026-11',
    'ใบที่ไม่ถูกนับต้องบอกเดือนของตัวเอง — บนใบสองเดือนมันไม่ใช่เรื่องที่รู้กันอยู่แล้ว',
  );
});
