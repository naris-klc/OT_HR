import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  birthdayHoursOf,
  groupEntriesByEmployee,
  reconcile,
  unaccountedCsvRow,
  unaccountedFor,
} from '../lib/accountingRows.js';
import { sumRows } from '../lib/departmentSummary.js';
import { toCsv, parseCsv } from '../src/lib/csv.js';
import {
  computeSession, makeIsHoliday, resolveDayTypes, sessionDates, summariseEntries,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

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
 * roster, and the roster query is filtered — `active: true` and every บทบาท
 * but the ADMIN account since 2026-09-08, `active: true, role: 'employee'`
 * before that.
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
  // §2 says managers do not submit OT. They DO get a blank line since
  // 2026-09-08 — but if one has an approved entry anyway, it is the entry
  // that puts them on the sheet with hours on it, not the roster pass.
  // what puts them on the sheet — and it must, or the month is short.
  const boss = person('m1', 'PM-0001', 'supervisor');
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
    entry(person('m1', 'PM-0001', 'supervisor'), 16.5),
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
  assert.equal(unaccounted.count, 1);
  assert.equal(unaccounted.hours, 3.5);
  assert.deepEqual(unaccounted.entries, [{
    id: 'orphan-1',
    workDate: null,
    department: 'ผลิต 1',
    otHours: 3.5,
    // Never resolvable from the populated rows — populate() replaces a
    // reference to a missing document with null and discards the id. The
    // report fills this in from a second, unpopulated read; see the test
    // below that pins it.
    employeeId: null,
    filedBy: null,
  }]);

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

test('every active บทบาท gets a blank line, and the ADMIN account does not', () => {
  /**
   * WHAT THE ROSTER FILTER IS ALLOWED TO DECIDE, checked where it lives.
   *
   * It read `active: true, role: 'employee'` until 2026-09-08, which left 21 of
   * 164 active people off both sheets — 10 ผู้จัดการแผนก, 7 หัวหน้างาน, and one
   * each of การเงิน, ฝ่ายบุคคล and ผู้จัดการฝ่าย. A person who is not on the
   * sheet at all is indistinguishable from one who was missed, and the blank
   * line exists precisely to tell those two apart.
   *
   * The ADMIN account is the one exclusion and it is not about permissions: it
   * is the system escalation login (ผู้ดูแลระบบ), not somebody on a payroll.
   * If it ever files OT the entries put it on the sheet anyway — which is the
   * property every test above this one holds.
   */
  const src = readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(
    code.includes('Employee.find({ active: true, role: { $ne: ADMIN_ROLE } })'),
    'the roster pass is not the widened one — check whose blank line it prints',
  );
  assert.ok(code.includes("const ADMIN_ROLE = 'admin';"), 'ADMIN_ROLE is gone or renamed');
  assert.ok(
    !code.includes("active: true, role: 'employee'"),
    'the roster pass is back to พนักงาน only — 21 of 164 people lose their line',
  );
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
  assert.deepEqual(unaccountedFor([{ _id: 'x' }]), {
    count: 1,
    hours: 0,
    entries: [{
      id: 'x', workDate: null, department: null, otHours: 0, employeeId: null, filedBy: null,
    }],
  });
  assert.deepEqual(unaccountedFor(), { count: 0, hours: 0, entries: [] });
});

test('an orphaned entry still knows who filed it, by name', () => {
  // The thing that makes this flag usable by a person instead of by a DBA.
  // `employee` is a bare reference and dies with the document; `history[0]`
  // records the submission and denormalises the filer's NAME into `byName` —
  // put there so a deleted employee could not erase an audit trail, which is
  // exactly the case here. Verified against the real database: an entry
  // orphaned during development was traced back to its owner this way and
  // nothing else on the row could have done it.
  const [item] = unaccountedFor([{
    _id: 'orphan-1',
    workDate: '2026-08-05',
    totals: { otHours: 3.5 },
    history: [
      { action: 'submit', by: 'e-somchai', byName: 'สมชาย ใจดี' },
      { action: 'approve_hr', by: 'hr-1', byName: 'มาลี บุญมาก' },
    ],
  }]).entries;

  assert.deepEqual(item.filedBy, { id: 'e-somchai', name: 'สมชาย ใจดี' });
});

test('the filer is the first person on the history, not the last to touch it', () => {
  // Every record after the submission is a manager, HR or the recompute job.
  // Taking any match rather than the earliest would name whoever approved it.
  const [item] = unaccountedFor([{
    _id: 'x',
    history: [
      { action: 'submit', by: 'e1', byName: 'พนักงาน' },
      { action: 'hr_edit', by: 'hr1', byName: 'ฝ่ายบุคคล' },
      { action: 'recompute', by: null, byName: null },
    ],
  }]).entries;

  assert.equal(item.filedBy.name, 'พนักงาน');
});

test('an entry with no usable history reports no filer rather than a blank one', () => {
  // `{ id: null, name: null }` would print as an empty row on the banner and
  // read as "we know, and it is nobody".
  for (const history of [[], [{ action: 'recompute' }], undefined]) {
    assert.equal(unaccountedFor([{ _id: 'x', history }]).entries[0].filedBy, null);
  }
});

test('the report re-reads the dangling reference populate threw away', () => {
  // The single most useful thing to search a backup with is the id the entry
  // still points at, and `populate('employee')` destroys it: a reference to a
  // missing document comes back as null, id and all. So accountingReport reads
  // those few entries again unpopulated. Verified against a real database
  // during development; pinned here because losing it would leave a flag that
  // names a problem nobody can trace.
  const src = readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /unaccounted\.count > 0/, 'the second read is unconditional — it must not be');
  assert.match(code, /unaccounted\.entries\.map\(\(e\) => e\.id\)/);
  assert.match(code, /item\.employeeId = refOf\.get\(item\.id\)/);
  // Unpopulated, or the id is thrown away a second time. Scoped to the re-read
  // itself — the roster query further down populates, legitimately.
  const start = code.indexOf('unaccounted.count > 0');
  const reread = code.slice(start, code.indexOf('if (includeZero)', start));
  assert.ok(reread.length > 0 && reread.length < 800, 'could not isolate the re-read block');
  assert.doesNotMatch(
    reread,
    /\.populate\(/,
    'the re-read populates, which is what loses the id in the first place',
  );
});

// ── the birthday split: a part of the 1.50 column, never a change to it ─────

/**
 * “วันเกิด” beside a row on สรุป OT ส่งบัญชี, and the hours behind it.
 *
 * Accounting asked for it because the paper they work from has it in HR's
 * handwriting: ×1.5 วันหยุด hours against somebody who worked an ordinary
 * Tuesday reads as an error, and a sheet that does not explain it comes back.
 *
 * The number is a SPLIT of a figure the sheet already prints, not a new figure,
 * and these tests are about that distinction. Built from real engine output
 * rather than hand-written buckets, because the whole mechanism is that
 * `dayReason` was written onto the segments when the entry was filed — a
 * hand-made fixture would prove only that the sum function adds.
 */
const HOLIDAYS = ['2026-08-12'];
const isHoliday = makeIsHoliday(HOLIDAYS);
const BIRTHDAY_ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
const BIRTHDAY_OFF = { ...DEFAULT_POLICY, birthdayHolidayEnabled: false };

/** One filed session, computed the way `otService` computes it. */
function filed(session, { birthDate = null, policy = BIRTHDAY_ON } = {}) {
  const result = computeSession(session, {
    policy,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy }),
  });
  return {
    _id: `e-${session.workDate}`,
    employee: person('emp-1', 'THT0018'),
    department: { _id: 'd1', code: 'D1', nameTh: 'ผลิต 1' },
    segments: result.segments,
    buckets: result.buckets,
    totals: result.totals,
  };
}

const DAY = { startTime: '08:00', endTime: '17:00' };

test('เดือนเดียวมีทั้งวันเกิดและวันหยุดปกติ — แยกถูก และยอด 1.50 ไม่ขยับ', () => {
  // 4 Aug 2026 is this person's birthday and a Tuesday; 8 Aug is a Saturday.
  // Both land 8 hours in ot15_holiday, by different rules, and the paper shows
  // one 1.50 column of 16.00 — which is exactly why `birthdayHours` has to say
  // how much of it the birthday accounts for, in the CSV column accounting sums.
  const entries = [
    filed({ workDate: '2026-08-04', ...DAY }, { birthDate: '1977-08-04' }),
    filed({ workDate: '2026-08-08', ...DAY }, { birthDate: '1977-08-04' }),
  ];

  const summary = summariseEntries(entries);
  assert.equal(summary.ot15Hours, 16, 'the 1.50 column is the sum of both, as before');
  assert.equal(summary.ot3Hours, 0);
  assert.equal(birthdayHoursOf(entries), 8, 'and 8 of those 16 are the birthday');

  // The other 8 are a Saturday and must not be claimed by the remark.
  assert.equal(birthdayHoursOf([entries[1]]), 0);

  // Adding the split changed no figure the sheet was already printing.
  const before = summariseEntries([entries[1]]);
  assert.equal(before.ot15Hours, 8);
});

test('วันเกิดที่ล้นแปดชั่วโมง ก็ยังนับเป็นชั่วโมงวันเกิด แม้ส่วนที่ล้นจะอยู่คอลัมน์ ×3', () => {
  // The remark is about WHY the day was a holiday, not about which column the
  // hours landed in, and accounting reading a ×3 figure for a Tuesday asks the
  // same question.
  //
  // IT TAKES A LONG DAY TO REACH ×3 NOW. This case was an 18:00–21:00 evening
  // until 2026-09-08, when a birthday was an ordinary วันหยุด split on the
  // clock; three hours after five was ×3 and is now the first three hours of the
  // day, at ×1.5. Thirteen hours is what it takes to land in both columns —
  // eight at ×1.5 and the rest at ×3 — which is the shape of the row this
  // remark exists for.
  const long = filed(
    { workDate: '2026-08-04', startTime: '07:00', endTime: '21:00' },
    { birthDate: '1977-08-04' },
  );
  assert.equal(long.buckets.ot15_holiday, 8);
  assert.equal(long.buckets.ot3_holiday, 5);
  assert.equal(birthdayHoursOf([long]), 13);
});

test('คนที่ไม่มีชั่วโมงวันเกิด — ไม่มีหมายเหตุ และไม่มีอะไรบนใบเปลี่ยน', () => {
  const ordinary = [
    filed({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' }),  // Wednesday
    filed({ workDate: '2026-08-08', ...DAY }),                                // Saturday
    filed({ workDate: '2026-08-12', ...DAY }),                                // company holiday
  ];
  assert.equal(birthdayHoursOf(ordinary), 0);

  // Which is what the sheet reads to decide whether to print anything at all.
  const print = readFileSync(join(ROOT, 'components/AccountingPrint.jsx'), 'utf8');
  assert.match(print, /if \(!\(row\.birthdayHours > 0\)\) return '';/);
});

test('กฎวันเกิดปิดอยู่ — ไม่มีชั่วโมงวันเกิดในเดือนนั้นเลย', () => {
  // With the rule off the same session on the same date is an ordinary
  // Tuesday: the hours are ×1.5 วันปกติ and no segment claims a birthday, so
  // nothing on the sheet has anything to explain.
  const entries = [filed({ workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: '1977-08-04', policy: BIRTHDAY_OFF })];

  assert.equal(entries[0].buckets.ot15_weekday, 3);
  assert.equal(entries[0].buckets.ot15_holiday, 0);
  assert.equal(birthdayHoursOf(entries), 0);
});

test('ชั่วโมงวันเกิดไม่ถูกบวกเพิ่มเข้ายอดรวมของใบ', () => {
  // The one arithmetic error this feature could introduce: a reader — or a
  // subtotal — treating the split as a fourth bucket. `reconcile` is what would
  // catch it, so it is asserted against the same rows.
  const entries = [filed({ workDate: '2026-08-04', ...DAY }, { birthDate: '1977-08-04' })];
  const { groups, unaccounted } = groupEntriesByEmployee(entries, { companyOf: () => 'themtech' });
  const rows = [...groups.values()].map((g) => ({
    employee: { code: g.employee.code },
    otHours: summariseEntries(g.entries).otHours,
    entryCount: g.entries.length,
    birthdayHours: birthdayHoursOf(g.entries),
  }));

  assert.equal(rows[0].birthdayHours, 8);
  assert.equal(rows[0].otHours, 8, 'the row total is the hours worked, not hours + birthday hours');
  assert.deepEqual(reconcile(entries, rows, unaccounted), {
    filed: 8,
    reported: 8,
    unaccounted: 0,
    balanced: true,
    entriesFiled: 1,
    entriesReported: 1,
    entriesUnaccounted: 0,
  });
});

test('รายงานส่งบัญชีบอกได้แค่จำนวนชั่วโมง ไม่บอกว่าวันไหน', () => {
  // The rule this replaced an older one with: the month may be disclosed, the
  // DATE may not. `birthdayHoursOf` returns a number and has no other shape to
  // return — there is no date on it to leak, by construction.
  const entries = [filed({ workDate: '2026-08-04', ...DAY }, { birthDate: '1977-08-04' })];
  const answer = birthdayHoursOf(entries);
  assert.equal(typeof answer, 'number');
  assert.equal(answer, 8);
});

// ── the CSV line cannot break the file ──────────────────────────────────────

/**
 * The two exports' real header rows, copied so a drift shows up as a failure.
 *
 * The accounting file ended `'รวมชั่วโมง', 'หมายเหตุ', 'birthday_hours'` until
 * **2026-09-09**, when HR asked for the layout it has now: the printed form's
 * two rate totals, then a หมายเหตุ that says วันเกิด and nothing else. Both of
 * the columns this line used to write into went in that change, which is what
 * `fold` below exists for.
 */
const ACCOUNTING_HEADERS = [
  'บริษัท', 'company_code', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก',
  'OT x1.5 วันปกติ', 'OT x1.5 วันหยุด', 'OT x3', 'รวม 1.5', 'รวม 3', 'หมายเหตุ',
];
const DEPARTMENT_HEADERS = [
  'แผนก', 'ลำดับที่', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'บริษัท',
  'OT x1.5', 'OT x3', 'รวม 1.5', 'รวม 3', 'หมายเหตุ',
];

const UNACCOUNTED = { count: 2, hours: 3.5, entries: [] };

test('the ไม่ถูกนับ line has exactly as many cells as the file has columns', () => {
  // A row one cell short opens with every column after it shifted, which is a
  // far worse outcome than the missing hours it reports.
  for (const headers of [ACCOUNTING_HEADERS, DEPARTMENT_HEADERS]) {
    assert.equal(unaccountedCsvRow(headers, UNACCOUNTED).length, headers.length);
  }
});

test('the whole warning is in ชื่อ-สกุล — label, hours, count and sentence', () => {
  /**
   * ── IT USED TO SPREAD ACROSS ชื่อ-สกุล, รวมชั่วโมง AND หมายเหตุ ────────────
   *
   * Neither export has either of the last two since 2026-09-09: `รวมชั่วโมง`
   * was replaced by the printed forms' `รวม 1.5` / `รวม 3` pair, and `หมายเหตุ`
   * carries the word วันเกิด and nothing else.
   *
   * The failure this guards against is not a crash — placing by NAME finds no
   * column and writes nothing, quite happily. It is a file that prints a bare
   * "ไม่ถูกนับ" beside ten blank cells: the warning with its warning removed,
   * which reads as a stray row rather than as hours the sheet could not account
   * for.
   */
  for (const headers of [ACCOUNTING_HEADERS, DEPARTMENT_HEADERS]) {
    const row = unaccountedCsvRow(headers, UNACCOUNTED);

    const name = row[headers.indexOf('ชื่อ-สกุล')];
    assert.match(name, /^ไม่ถูกนับ/);
    assert.match(name, /3\.5 ชม\./, 'จำนวนชั่วโมงที่หายต้องอยู่ในบรรทัด');
    assert.match(name, /2 รายการอ้างถึงพนักงานที่หาไม่พบ/);

    // And nothing leaks into the columns these files keep for figures.
    for (const column of ['รวม 1.5', 'รวม 3', 'หมายเหตุ', 'รหัสพนักงาน']) {
      assert.equal(row[headers.indexOf(column)], '', `${column} ต้องว่าง`);
    }
    assert.equal(row.length, headers.length);
  }
});

test('it carries no รหัสพนักงาน, so the filter that isolates people still works', () => {
  // Every existing non-person row — รวมแผนก, รวมทั้งหมด, รวมทุกบริษัท,
  // รวมทุกแผนก — is already written this way, and anything consuming these
  // files must already skip that shape or its totals would double. This line
  // adds no new case; it is one more of the same one.
  for (const headers of [ACCOUNTING_HEADERS, DEPARTMENT_HEADERS]) {
    const row = unaccountedCsvRow(headers, UNACCOUNTED);
    assert.equal(row[headers.indexOf('รหัสพนักงาน')], '');
  }
});

test('a column added to an export moves the line with it', () => {
  // The cell is still found by NAME, not by counting — which is what keeps this
  // line correct when a column is added anywhere to its left.
  const headers = ['คอลัมน์ใหม่', ...DEPARTMENT_HEADERS];
  const row = unaccountedCsvRow(headers, UNACCOUNTED);
  assert.equal(row.length, headers.length);
  assert.match(row[headers.indexOf('ชื่อ-สกุล')], /^ไม่ถูกนับ/);
  assert.equal(row[0], '', 'the new column is left blank, not overwritten');
});

test('the line survives the round trip through the CSV writer and parser', () => {
  // Quoting, the BOM and CRLF all applied by the same toCsv the exports use.
  // The employee row carries every column the file has — a fixture one cell
  // short would parse without complaint and hide exactly the shift this file
  // is afraid of.
  const employee = [
    'ไพรมัส', 'PM', 'PM-0412', 'สมชาย ใจดี', 'ผลิต 1', '8', '8', '4', '16', '4', 'วันเกิด',
  ];
  const rows = [employee, unaccountedCsvRow(ACCOUNTING_HEADERS, UNACCOUNTED, { fold: true })];

  for (const row of rows) {
    assert.equal(row.length, ACCOUNTING_HEADERS.length, 'every row is as wide as the header');
  }

  const parsed = parseCsv(toCsv(ACCOUNTING_HEADERS, rows));

  assert.equal(parsed.length, 2);
  assert.match(parsed[1]['ชื่อ-สกุล'], /^ไม่ถูกนับ/);
  assert.equal(parsed[1]['รหัสพนักงาน'], '');
  assert.equal(parsed[0]['รหัสพนักงาน'], 'PM-0412', 'the employee rows above are untouched');

  // The two rate totals read back as the paper's two columns: the ×1.5 pair
  // added, and the ×3 column repeated. They are what a person reconciling this
  // file against F-HR-027 compares, and the split to their left is unchanged
  // by their existence.
  assert.equal(parsed[0]['รวม 1.5'], '16');
  assert.equal(parsed[0]['รวม 3'], '4');
  assert.equal(parsed[0]['OT x3'], '4');
  assert.equal(parsed[0]['หมายเหตุ'], 'วันเกิด', 'คำเดียว ไม่มีจำนวนชั่วโมงต่อท้าย');
  assert.equal(parsed[1]['หมายเหตุ'], '', 'บรรทัดไม่ถูกนับไม่ใช่ของใคร จึงไม่มีวันเกิด');
});

test('nothing in the line can be read as a spreadsheet formula', () => {
  // escapeCell guards every cell, but the guard only helps if this row goes
  // through it — a row assembled and joined by hand somewhere else would not.
  const row = unaccountedCsvRow(ACCOUNTING_HEADERS, { count: 1, hours: 3.5 }, { fold: true });
  for (const cell of row) {
    assert.doesNotMatch(String(cell), /^[=+\-@]/, `cell would be read as a formula: ${cell}`);
  }

  // Nor can a name — so the whole employee row goes through the writer with a
  // hostile one in it.
  const hostile = [
    '=cmd|calc', 'PM', 'PM-0001', '@somchai', '-ผลิต', '8', '8', '4', '16', '4', '+วันเกิด',
  ];
  const parsed = parseCsv(toCsv(ACCOUNTING_HEADERS, [hostile]));
  for (const value of Object.values(parsed[0])) {
    assert.doesNotMatch(String(value), /^[=+\-@]/, `cell survived unquoted: ${value}`);
  }
  assert.equal(parsed[0]['รวม 1.5'], '16', 'and the numeric columns are untouched by the guard');

  // And the guard itself still fires for anything that could.
  const line = toCsv(['a'], [['=1+1']]).split('\r\n')[1];
  assert.equal(line, "'=1+1");
});

test('the exports write the line through the shared builder, and only when there is one', () => {
  for (const file of ['app/api/exports/accounting.csv/route.js', 'app/api/exports/departments.csv/route.js']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    assert.match(code, /if \(report\.unaccounted\?\.count > 0\)/, `${file} writes the line unconditionally`);
    // accounting.csv passes `{ fold: true }` — it is still the shared builder,
    // and the option is why its warning did not quietly empty itself when the
    // two columns it wrote into were replaced on 2026-09-09.
    assert.match(
      code,
      /rows\.push\(unaccountedCsvRow\(headers, report\.unaccounted(, \{ fold: true \})?\)\)/,
      `${file} builds the row by hand`,
    );
  }
});
