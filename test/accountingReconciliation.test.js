import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  groupEntriesByEmployee,
  reconcile,
  unaccountedFor,
} from '../lib/accountingRows.js';
import { sumRows } from '../lib/departmentSummary.js';

/**
 * Every approved hour in the month is either printed on a row or reported as
 * missing. There is no third place for one to go.
 *
 * test/reportColumns.test.js is the same rule down the other axis: that no rate
 * bucket is lost on the way from the engine to the two printed columns. This
 * one is the people axis — that no PERSON's hours are lost on the way from the
 * entry collection to the roster the sheet prints.
 *
 * The failure it guards is specific and quiet. สรุป OT ส่งบัญชี lists the whole
 * roster, and the roster query is filtered — `active: true, role: 'employee'`.
 * Read quickly that looks like the sheet's population, and if it were, then
 * every manager's OT and every leaver's OT would be missing from the totals
 * with nothing anywhere saying so: the rows would still agree with the
 * subtotals, the subtotals with the grand total, and สรุป OT แยกแผนก with both,
 * because all of them are built from the same short list.
 *
 * It is not the population. The sheet is built entries-first and the roster
 * only adds blank lines — so the filter decides whose EMPTY row is printed and
 * nothing else. That is a property of the order two loops run in, which is
 * exactly the kind of thing a later edit reverses while making a screen behave,
 * so it is pinned here rather than left to the comment above it.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** An approved entry as `accountingReport` has it: employee and department populated. */
function entry(employee, otHours, { ot15 = otHours, ot3 = 0, id = null } = {}) {
  return {
    _id: id || `entry-${employee?._id}-${otHours}-${ot3}`,
    employee,
    department: { _id: 'd1', code: 'D1', nameTh: 'ผลิต 1' },
    buckets: { ot15_weekday: ot15, ot15_holiday: 0, ot3_holiday: ot3 },
    totals: { otHours },
  };
}

const person = (id, code, role = 'employee', active = true) => ({
  _id: id, code, name: `พนักงาน ${code}`, role, active,
});

/** What accountingReport builds off each group, reduced to what balances. */
const rowsFrom = (groups) => [...groups.values()].map((g) => ({
  employee: { code: g.employee.code },
  otHours: Math.round(g.entries.reduce((n, e) => n + e.totals.otHours, 0) * 100) / 100,
  entryCount: g.entries.length,
}));

// ── the roster filter cannot lose an hour ───────────────────────────────────

test('a manager who worked OT is on the sheet with their hours', () => {
  // §2 says managers do not submit OT, so they are not in the roster query
  // that adds blank lines. If one has an approved entry anyway, the entry is
  // what puts them on the sheet — and it must, or the month is short.
  const boss = person('m1', 'PM-0001', 'manager');
  const entries = [entry(boss, 16.5)];

  const { groups, unaccounted } = groupEntriesByEmployee(entries);
  const rows = rowsFrom(groups);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].otHours, 16.5);
  assert.equal(unaccounted.count, 0);
  assert.equal(reconcile(entries, rows, unaccounted).balanced, true);
});

test('somebody who has left keeps the hours they worked before they left', () => {
  const leaver = person('e9', 'PM-0412', 'employee', false);
  const entries = [entry(leaver, 8), entry(leaver, 3.5)];

  const { groups, unaccounted } = groupEntriesByEmployee(entries);
  const rows = rowsFrom(groups);

  assert.equal(rows.length, 1, 'active:false must not remove a row that entries created');
  assert.equal(rows[0].otHours, 11.5);
  assert.equal(reconcile(entries, rows, unaccounted).balanced, true);
});

test('the whole month balances with managers, leavers and ordinary staff mixed', () => {
  const entries = [
    entry(person('e1', 'PM-0002'), 12.5),
    entry(person('m1', 'PM-0001', 'manager'), 16.5),
    entry(person('e9', 'PM-0412', 'employee', false), 8),
    entry(person('e1', 'PM-0002'), 3, { ot15: 0, ot3: 3 }),
    entry(person('h1', 'HR-001', 'hr'), 4),
  ];

  const { groups, unaccounted } = groupEntriesByEmployee(entries);
  const rows = rowsFrom(groups);
  const balance = reconcile(entries, rows, unaccounted);

  assert.equal(balance.filed, 44);
  assert.equal(balance.reported, 44);
  assert.equal(balance.unaccounted, 0);
  assert.equal(balance.balanced, true);
  assert.equal(balance.entriesFiled, 5);
  assert.equal(balance.entriesReported, 5);
  assert.equal(rows.length, 4, 'the two entries from PM-0002 share one row');
});

test('adding blank roster rows afterwards changes no total', () => {
  // The second pass, modelled: it may only ADD people who have no entries.
  const worked = person('e1', 'PM-0002');
  const entries = [entry(worked, 12.5)];
  const { groups, unaccounted } = groupEntriesByEmployee(entries);

  for (const idle of [person('e2', 'PM-0003'), person('e3', 'PM-0004')]) {
    const key = String(idle._id);
    if (groups.has(key)) continue;
    groups.set(key, { employee: idle, department: null, company: null, entries: [] });
  }

  const rows = rowsFrom(groups);
  assert.equal(rows.length, 3);
  assert.equal(reconcile(entries, rows, unaccounted).reported, 12.5);
  assert.equal(reconcile(entries, rows, unaccounted).balanced, true);
});

test('a roster member with no entries is a row but not an hour', () => {
  // Why the sheet can list everybody and still be signed against a total.
  const rows = [
    { employee: { code: 'PM-0002' }, ot15Hours: 12.5, ot3Hours: 0, otHours: 12.5 },
    { employee: { code: 'PM-0003' }, ot15Hours: 0, ot3Hours: 0, otHours: 0 },
  ];
  const totals = sumRows(rows);
  assert.equal(totals.rowCount, 2);
  assert.equal(totals.headcount, 1);
  assert.equal(totals.otHours, 12.5);
});

// ── the one hour that can go missing is counted ─────────────────────────────

test('an entry whose employee no longer resolves is reported, not skipped', () => {
  // The path that used to be a bare `continue`. No route hard-deletes an
  // employee, so this arrives from a restore or a database fix — and an hour
  // that is neither printed nor reported is the only error this sheet cannot
  // show, because everything else on it is a total of something visible.
  const entries = [
    entry(person('e1', 'PM-0002'), 12.5),
    entry(null, 3.5, { id: 'orphan-1' }),
  ];

  const { groups, unaccounted } = groupEntriesByEmployee(entries);
  const rows = rowsFrom(groups);

  assert.equal(rows.length, 1);
  assert.deepEqual(unaccounted, { count: 1, hours: 3.5, entryIds: ['orphan-1'] });

  const balance = reconcile(entries, rows, unaccounted);
  assert.equal(balance.filed, 16);
  assert.equal(balance.reported, 12.5);
  assert.equal(balance.unaccounted, 3.5);
  assert.equal(balance.balanced, true, 'reported + unaccounted must still equal filed');
});

test('hours that vanish without being counted make the sheet unbalanced', () => {
  // The test's own control: if `unaccounted` ever stopped counting, this is
  // what the reconciliation would say. It must say it.
  const entries = [entry(person('e1', 'PM-0002'), 12.5), entry(null, 3.5)];
  const rows = rowsFrom(groupEntriesByEmployee(entries).groups);

  const blind = reconcile(entries, rows, { count: 0, hours: 0 });
  assert.equal(blind.balanced, false);
  assert.equal(blind.filed - blind.reported, 3.5);
});

test('an employee reference with no _id counts as unresolved, not as a person', () => {
  // populate() gives back the id when the document is gone in some driver
  // versions and undefined in others. Either way there is no employee, and
  // grouping on `String(undefined)` would invent a row called "undefined".
  const entries = [entry({}, 2), entry(undefined, 1)];
  const { groups, unaccounted } = groupEntriesByEmployee(entries);

  assert.equal(groups.size, 0);
  assert.equal(unaccounted.count, 2);
  assert.equal(unaccounted.hours, 3);
});

test('an empty month balances', () => {
  const { groups, unaccounted } = groupEntriesByEmployee([]);
  assert.equal(groups.size, 0);
  assert.deepEqual(reconcile([], [], unaccounted), {
    filed: 0,
    reported: 0,
    unaccounted: 0,
    balanced: true,
    entriesFiled: 0,
    entriesReported: 0,
    entriesUnaccounted: 0,
  });
});

test('two decimals, so a float artefact is not read as a missing entry', () => {
  const staff = person('e1', 'PM-0002');
  const entries = [entry(staff, 0.1), entry(staff, 0.2)];
  const rows = rowsFrom(groupEntriesByEmployee(entries).groups);
  assert.equal(reconcile(entries, rows, { count: 0, hours: 0 }).balanced, true);
});

test('the company an entry is filed under comes from the employee on the entry', () => {
  const staff = person('e1', 'THT0056');
  const { groups } = groupEntriesByEmployee([entry(staff, 3)], {
    companyOf: (e) => (String(e.code).startsWith('THT') ? 'themtech' : 'primus'),
  });
  assert.equal([...groups.values()][0].company, 'themtech');
});

// ── the order the sheet is built in ─────────────────────────────────────────

test('the report builds rows from entries before it touches the roster', () => {
  // The property every test above depends on, checked where it actually lives.
  // lib/accounting.js resolves `@/…` through the Next alias and cannot be
  // imported by node --test, so this reads it as text — the same approach
  // rejectedNeverCounted takes, and for the same reason.
  const src = readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const grouped = code.indexOf('groupEntriesByEmployee');
  const roster = code.indexOf('Employee.find({ active: true');

  assert.ok(grouped > 0, 'lib/accounting.js no longer groups entries through the shared helper');
  assert.ok(roster > 0, 'the roster query moved — check it still only ADDS rows');
  assert.ok(
    grouped < roster,
    'ทะเบียนถูกอ่านก่อนใบ OT — ถ้าสร้างแถวจากทะเบียนแล้วค่อยแปะชั่วโมง '
    + 'ตัวกรอง active/role จะทำให้ชั่วโมงของหัวหน้าและคนที่ลาออกหายเงียบ',
  );

  // The roster pass may only add people who are not already there.
  assert.match(code, /if \(groups\.has\(key\)\) continue;/);
});

test('the sheet reports what it could not account for', () => {
  const src = readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /\bunaccounted,/, 'accountingReport ไม่ได้ส่ง unaccounted ออกมา');
  assert.match(code, /reconciliation: reconcile\(/);
  // Against every row the month produced, not the ones this company's view
  // happens to show — otherwise picking one company reads as a shortfall.
  assert.match(code, /reconcile\(entries, everyRow, unaccounted\)/);
});

test('unaccountedFor survives an entry with no totals at all', () => {
  assert.deepEqual(unaccountedFor([{ _id: 'x' }]), { count: 1, hours: 0, entryIds: ['x'] });
  assert.deepEqual(unaccountedFor(), { count: 0, hours: 0, entryIds: [] });
});
