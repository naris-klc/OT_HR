import test from 'node:test';
import assert from 'node:assert/strict';

import { BUCKETS, BUCKET_MULTIPLIER, summariseEntries } from '../src/lib/otEngine.js';
import { groupByDepartment, sumRows } from '../lib/departmentSummary.js';

/**
 * Three buckets in the engine, two columns on the paper — and nothing lost
 * between them.
 *
 * สรุป OT ส่งบัญชี and สรุป OT แยกแผนก are both ruled for 1.50 and 3.00, while
 * the engine keeps ot15_weekday, ot15_holiday and ot3_holiday apart because
 * F-HR-027 prints them as three separate lines. The flattening happens in
 * `summariseEntries`:
 *
 *   ot15_weekday + ot15_holiday → 1.50
 *   ot3_holiday                 → 3.00
 *
 * A bucket dropped on the way across is the one error neither sheet can show.
 * Both columns still add up, both subtotals still agree with the rows above
 * them, and both reports agree with each other — because they are built from
 * the same flattening. The month is simply short, and the first person to
 * notice is whoever is owed the hours.
 *
 * So the invariant is checked against BUCKETS itself rather than against a list
 * written out here: a fourth bucket added to the engine and forgotten in the
 * mapping fails these tests on the day it is added, which is the only day
 * anybody could act on it cheaply.
 *
 * Run with: npm test
 */

const BUCKET_KEYS = Object.values(BUCKETS);

/** An entry as the reports see one: buckets in hours, plus the session total. */
function entry(buckets) {
  const filled = Object.fromEntries(BUCKET_KEYS.map((k) => [k, buckets[k] || 0]));
  const otHours = Object.values(filled).reduce((a, b) => a + b, 0);
  return { buckets: filled, totals: { otHours } };
}

const sumOf = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

// ── the flattening ──────────────────────────────────────────────────────────

test('every bucket the engine has lands in exactly one printed column', () => {
  for (const bucket of BUCKET_KEYS) {
    const summary = summariseEntries([entry({ [bucket]: 1 })]);
    const inColumns = [summary.ot15Hours, summary.ot3Hours].filter((h) => h > 0);

    assert.equal(
      inColumns.length,
      1,
      `${bucket} ไม่ได้ลงคอลัมน์ใดคอลัมน์หนึ่งพอดี — `
      + `1.50 = ${summary.ot15Hours}, 3.00 = ${summary.ot3Hours} `
      + '(ดู summariseEntries ใน src/lib/otEngine.js)',
    );
    assert.equal(inColumns[0], 1, `${bucket} เข้าคอลัมน์แล้วชั่วโมงไม่ครบ`);
  }
});

test('the two columns and the three buckets always add up to the same number', () => {
  // Deliberately lopsided, including a bucket left empty — the case where a
  // mapping that silently drops one still looks right on most months.
  const entries = [
    entry({ [BUCKETS.OT15_WEEKDAY]: 12.5 }),
    entry({ [BUCKETS.OT15_HOLIDAY]: 8, [BUCKETS.OT3_HOLIDAY]: 3.5 }),
    entry({ [BUCKETS.OT3_HOLIDAY]: 4 }),
    entry({ [BUCKETS.OT15_WEEKDAY]: 2, [BUCKETS.OT15_HOLIDAY]: 1, [BUCKETS.OT3_HOLIDAY]: 0.5 }),
  ];

  const summary = summariseEntries(entries);

  assert.equal(summary.ot15Hours + summary.ot3Hours, sumOf(summary.buckets));
  assert.equal(summary.ot15Hours + summary.ot3Hours, 31.5);
});

test('the 1.50 column is both ×1.5 buckets, not just the weekday one', () => {
  const summary = summariseEntries([
    entry({ [BUCKETS.OT15_WEEKDAY]: 3 }),
    entry({ [BUCKETS.OT15_HOLIDAY]: 5 }),
  ]);
  assert.equal(summary.ot15Hours, 8);
  assert.equal(summary.ot3Hours, 0);
});

test('the split is by multiplier — anything ×1.5 is column 1.50, anything ×3 is column 3.00', () => {
  // Ties the mapping to the thing the columns are NAMED after, so a bucket
  // added at a new rate cannot quietly be folded into an existing column.
  for (const bucket of BUCKET_KEYS) {
    const summary = summariseEntries([entry({ [bucket]: 1 })]);
    const column = BUCKET_MULTIPLIER[bucket] === 3 ? summary.ot3Hours : summary.ot15Hours;
    assert.equal(column, 1, `${bucket} (×${BUCKET_MULTIPLIER[bucket]}) ลงผิดคอลัมน์`);
  }
});

// ── the department sheet's รวมชั่วโมงทำOT row ────────────────────────────────

/** A row as `accountingReport()` builds one, reduced to what the sheets read. */
function row(code, ot15Hours, ot3Hours, departmentId = 'd1', departmentName = 'ผลิต 1') {
  return {
    employee: { id: `e-${code}`, code, name: `พนักงาน ${code}` },
    department: { id: departmentId, code: departmentId, name: departmentName },
    ot15Hours,
    ot3Hours,
    otHours: ot15Hours + ot3Hours,
  };
}

test('รวม is the two columns added, never weighted by 1.5 or 3', () => {
  // The check against the June paper: had the total been weighted, 10 and 10
  // would print 45.00 rather than 20.00, and แผนกผลิต 1's 644.00 would not
  // have matched.
  const totals = sumRows([row('PM0001', 10, 10)]);

  assert.equal(totals.ot15Hours, 10);
  assert.equal(totals.ot3Hours, 10);
  assert.equal(totals.otHours, 20);
  assert.notEqual(totals.otHours, 10 * 1.5 + 10 * 3);
});

test('รวม equals 1.50 + 3.00 exactly as printed, to the last hundredth', () => {
  // Two decimals is what the sheet is signed against, so the total has to be
  // the sum of the printed figures rather than a separately rounded quantity.
  const rows = [row('PM0001', 12.25, 0.5), row('PM0002', 7.75, 1.25), row('PM0003', 0, 0)];
  const totals = sumRows(rows);

  const printed = (n) => Number(n.toFixed(2));
  assert.equal(printed(totals.otHours), printed(totals.ot15Hours + totals.ot3Hours));
  assert.equal(totals.otHours, 21.75);
});

test('a department total is every bucket its people worked, both companies together', () => {
  // The regrouping สรุป OT แยกแผนก does: the same person's hours must arrive
  // whole whichever payroll they are on, and the three buckets must still add
  // up to the two columns after the merge.
  const companies = [
    { key: 'primus', rows: [row('PM0001', 4, 1), row('PM0002', 2, 0)] },
    { key: 'themtech', rows: [row('THT0001', 3, 2)] },
  ];

  const [department] = groupByDepartment(companies);

  assert.equal(department.rows.length, 3);
  assert.equal(department.totals.ot15Hours, 9);
  assert.equal(department.totals.ot3Hours, 3);
  assert.equal(department.totals.otHours, 12);
  assert.equal(
    department.totals.otHours,
    companies.flatMap((c) => c.rows).reduce((n, r) => n + r.otHours, 0),
  );
});

test('somebody with no OT is counted as a row but not as a head', () => {
  // Why the sheets can list the whole roster and still report a headcount
  // accounting can pay against: a blank line is evidence the person was
  // checked, not evidence they worked.
  const totals = sumRows([row('PM0001', 8, 0), row('PM0002', 0, 0)]);
  assert.equal(totals.rowCount, 2);
  assert.equal(totals.headcount, 1);
  assert.equal(totals.otHours, 8);
});
