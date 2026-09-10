import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { departmentScope, teamScoped } from '../lib/reports.js';

/**
 * แผนก บน ตรวจสอบประจำเดือน — the dropdown asked for on 2026-09-10, in those
 * words: "หน้า ตรวจสอบประจำเดือน เพิ่มตัวกรองให้กรองเป็นแผนกได้".
 *
 * ── WHAT MAKES IT DIFFERENT FROM THE SEARCH BOX BESIDE IT ───────────────────
 *
 * ค้นหา is a SCREEN filter: it narrows what is drawn out of a month already
 * fetched, so รวมทั้งหมด and both CSVs stay the month's and the screen says so
 * in a hint (test/monthSearch.test.js pins that sentence). This one goes in the
 * URL. The month comes back already cut, which means every figure on the screen
 * is that department's — the total, the ceiling column, the birthday list, the
 * policy banner and both exported files. That is the whole reason it is not
 * three lines of `.filter()` in the component, and it is what this file is for.
 *
 * ── AND WHAT MAKES IT SAFE ──────────────────────────────────────────────────
 *
 * A parameter that decides which rows a report prints is a parameter somebody
 * can type into a URL. `departmentScope` is where that is answered, for all
 * three documents at once, and the property it holds is the one `teamScoped`
 * already held for `?scope=`: **it can only ever narrow**. Half of this file is
 * that sentence, checked from both ends.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const hrView = read('components/HrView.jsx');
const css = read('app/styles.css');

/**
 * REAL-SHAPED IDS, because one of the rules under test is about their shape:
 * `departmentScope` answers anything that is not 24 hex characters as a
 * department that does not exist, so a fixture reading 'd-prod1' would take
 * every whole-company case down that branch and prove nothing about the rest.
 * These are the ids of แผนกผลิต1, แผนกผลิต3 and แผนกบัญชีและการเงิน on the
 * development database, read 2026-09-10.
 */
const PROD1 = '6a993b3aeace7dac6cea36bd';
const PROD3 = '6a993b3aeace7dac6cea36c1';
const ACCOUNTING = '6a993b3aeace7dac6cea36d7';

/** A signer holding their own แผนก plus one ticked on top. */
const supervisor = {
  role: 'supervisor',
  department: { _id: PROD1 },
  approvesDepartments: [PROD3],
};
/** ฝ่ายบุคคล: no แผนก signed, the whole company read. */
const hr = { role: 'hr' };

// ── it can only ever narrow ─────────────────────────────────────────────────

test('a whole-company reader gets the one แผนก they asked for, or all of them', () => {
  assert.deepEqual(departmentScope(hr, {}), { teamOnly: false, department: null });
  assert.deepEqual(
    departmentScope(hr, { department: PROD1 }),
    { teamOnly: false, department: PROD1 },
  );
  // `null` and not `{}` — the routes write the clause only when there is one,
  // so an unnarrowed month is a query with no `department` key at all rather
  // than one carrying an empty object that matches nothing.
  assert.equal(departmentScope(hr, { department: '' }).department, null);
});

test('a value that is not an id is a department that is not there, not a 500', () => {
  // `?department=not-an-id` WAS a 500 until 2026-09-10 — mongoose casts the
  // clause on its way into the query and throws, and `route()` turns that into
  // เกิดข้อผิดพลาดภายในระบบ. Latent for as long as the parameter existed,
  // because no screen had ever sent one; the dropdown is what made it reachable
  // from a stale tab or a typed URL.
  //
  // `{ $in: [] }` matches nothing WITHOUT being cast, which is the throw
  // itself — and nothing is the same answer a well-formed id for a department
  // that does not exist already gave.
  for (const junk of ['not-an-id', 'abc', 'แผนกผลิต1ก', '0'.repeat(23), '0'.repeat(25)]) {
    assert.deepEqual(
      departmentScope(hr, { department: junk }).department,
      { $in: [] },
      junk,
    );
  }
  // A well-formed id is passed through whether or not a department wears it —
  // "narrow to a แผนก that is not there" is a question with an answer, and the
  // answer is nought rows.
  assert.equal(
    departmentScope(hr, { department: 'a'.repeat(24) }).department,
    'a'.repeat(24),
  );
  // A 24-hex test and NOT `mongoose.Types.ObjectId.isValid`, which accepts any
  // 12-character string and would let 'แผนกผลิต1ก' through to throw further
  // down. lib/reports.js is also deliberately free of the database layer — its
  // own header says so, and the retired Express form route imports it under
  // plain node.
  const src = read('lib/reports.js');
  assert.match(src, /const OBJECT_ID_RE = \/\^\[0-9a-fA-F\]\{24\}\$\//);
  // THE IMPORTS, NOT THE PROSE. The first draft of this asserted
  // `!/mongoose/.test(src)` and went red on the two COMMENTS above that
  // function explaining why mongoose is not used — which is the same way the
  // `<select>` assertion in this file died an hour earlier, and the failure
  // AGENTS.md names outright. Only `import` lines are read.
  const imports = (src.match(/^import .+$/gm) || []).join(' ');
  assert.ok(!/mongoose/.test(imports), 'lib/reports.js imports the database layer');
  // …and every one of them is relative, which is the property that lets a
  // plain-node caller resolve this file at all.
  assert.ok(!/from '@\//.test(imports), 'lib/reports.js grew an aliased import');
});

test('a team-scoped reader is narrowed to one of THEIRS, and never to anybody else’s', () => {
  // Their own list, when nothing is asked for — unchanged behaviour, and the
  // reason the report may not simply honour whatever the URL says.
  assert.deepEqual(
    departmentScope(supervisor, { scope: 'team' }).department,
    { $in: [PROD1, PROD3] },
  );
  // One of theirs: honoured, because it narrows.
  assert.equal(
    departmentScope(supervisor, { scope: 'team', department: PROD3 }).department,
    PROD3,
  );
  // NOT ONE OF THEIRS: ignored, and this is the case the whole function exists
  // for. Honouring it would hand a หัวหน้า the hours of a แผนก they do not sign
  // for — the one thing a report may not do — and refusing it would turn a
  // stale tab into an error page. They get their own list, which is what they
  // would have had without the parameter.
  assert.deepEqual(
    departmentScope(supervisor, { scope: 'team', department: ACCOUNTING }).department,
    { $in: [PROD1, PROD3] },
  );
  // Neither can it be widened by asking for nothing in a way that looks like
  // something.
  for (const junk of ['', null, undefined, 0]) {
    assert.deepEqual(
      departmentScope(supervisor, { scope: 'team', department: junk }).department,
      { $in: [PROD1, PROD3] },
      String(junk),
    );
  }
});

test('a หัวหน้างาน on the company tab is still narrowed to their own แผนก', () => {
  // `?scope=` is not what makes them team-scoped — their บทบาท is. So the
  // department parameter is checked against their list on BOTH tabs, and a
  // company-scoped request from them is not a way round it.
  assert.equal(teamScoped('supervisor', undefined), true);
  assert.deepEqual(
    departmentScope(supervisor, { department: ACCOUNTING }).department,
    { $in: [PROD1, PROD3] },
  );
});

test('การเงิน narrow on their team tab and not on their wide one', () => {
  // The one บทบาท that holds both readings — see lib/roles.js. On the wide tab
  // any แผนก is theirs to read; on the narrow one only the แผนก they sign for.
  const finance = { role: 'finance', department: { _id: ACCOUNTING } };
  assert.equal(departmentScope(finance, { department: PROD1 }).department, PROD1);
  assert.deepEqual(
    departmentScope(finance, { scope: 'team', department: PROD1 }).department,
    { $in: [ACCOUNTING] },
  );
  assert.equal(
    departmentScope(finance, { scope: 'team', department: ACCOUNTING }).department,
    ACCOUNTING,
  );
});

test('somebody who signs for nothing cannot be narrowed into somebody’s แผนก', () => {
  // A พนักงาน and a demoted signer are not team-scoped at all — `teamScoped` is
  // false for them — so they fall down the whole-company branch and the report
  // route refuses them at the door instead. This pins WHICH lock stops them, so
  // that a future reading of `approvalDepartments` here does not quietly become
  // the only one.
  const demoted = { role: 'employee', department: { _id: PROD1 } };
  assert.equal(teamScoped('employee', 'team'), false);
  assert.deepEqual(
    departmentScope(demoted, { scope: 'team' }),
    { teamOnly: false, department: null },
  );
  const guard = read('app/api/reports/monthly/[period]/route.js');
  assert.match(guard, /if \(!\['hr', 'admin', \.\.\.SIGNER_ROLES\]\.includes\(user\.role\)\)/);
});

// ── the three documents ask it, and none of them asks anything else ─────────

test('the table and both CSVs carry the same department parameter', () => {
  // The export button's one promise is that it is the table it sits under. The
  // search box beside it is NOT in any of these — it never has been, and the
  // hint over the table says so.
  assert.match(
    hrView,
    /const deptParam = dept \? `&department=\$\{encodeURIComponent\(dept\)\}` : '';/,
  );
  for (const url of [
    /\/reports\/monthly\/\$\{period\}\?status=\$\{statusFilter\}\$\{scopeParam\}\$\{deptParam\}/,
    /\/exports\/entries\.csv\?period=\$\{period\}&status=\$\{statusFilter\}\$\{scopeParam\}\$\{deptParam\}/,
    /\/exports\/monthly\.csv\?period=\$\{period\}&status=\$\{statusFilter\}\$\{scopeParam\}\$\{deptParam\}/,
  ]) {
    assert.match(hrView, url);
  }
  // And the month is refetched when it changes, which is what makes it a
  // request rather than a filter over rows already in hand.
  assert.match(hrView, /useEffect\(\(\) => \{ load\(\); \}, \[period, statusFilter, scope, dept\]\);/);
});

test('the rows it is NOT a filter over', () => {
  // `shown` is the search's, and พิมพ์รวม still follows it — the department
  // filter changed what came back, not what is drawn out of it. Two mechanisms
  // over one list is what this screen has already been repaired for once.
  assert.match(hrView, /setPrinting\(\{ employees: shown\.map\(\(r\) => r\.employee\) \}\)/);
  assert.ok(
    !/employees.*\.filter\([\s\S]{0,80}department/.test(hrView),
    'the department filter is being applied a second time in the browser',
  );
});

// ── the list of departments ─────────────────────────────────────────────────

test('the options come from the roster, not from the rows', () => {
  // A list built from the rows EMPTIES on first use: pick ผลิต3, get ผลิต3's
  // month, and the dropdown now offers one department — its own choice. There
  // would be no way back to ผลิต1 except ทุกแผนก first. คิวรออนุมัติ found this
  // on 2026-09-04 and this screen is not going to find it again.
  assert.match(hrView, /api\.get\('\/departments'\)/);
  assert.match(hrView, /setRoster\(res\.departments \|\| \[\]\)/);
  // Refused or slow: the control draws with ทุกแผนก and nothing under it, and
  // the table is untouched.
  assert.match(hrView, /\.catch\(\(\) => \{ if \(live\) setRoster\(\[\]\); \}\)/);
  // Narrowed to what this reader may actually be given — the same list the
  // server will honour and nothing wider.
  assert.match(hrView, /const mine = \(user\?\.coversDepartments \|\| \[\]\)\.map\(String\);/);
  assert.match(hrView, /\.filter\(\(d\) => !mine\.length \|\| mine\.includes\(String\(d\._id\)\)\)/);
});

test('ทุกแผนก is a row of the list, because "" is a setting this screen can hold', () => {
  // Unlike สถานะที่นับ two lines above it, whose widest setting is a real value
  // and which therefore has no `allLabel` — see the note over STATUS_FILTERS.
  const control = hrView.slice(hrView.indexOf('label="แผนก"'));
  const end = control.indexOf('/>');
  assert.match(control.slice(0, end), /allLabel="ทุกแผนก"/);
  assert.match(control.slice(0, end), /options=\{departments\}/);
  // `className="dept-pick"` WAS ASSERTED HERE UNTIL 2026-09-10 and is not any
  // more: the control took a 190px basis of its own beside a month at 170 and a
  // สถานะ at 220, three numbers on one screen. Every field on `.queue-tools` is
  // one width now — `.queue-tools .field`, shared with รออนุมัติ OT — and
  // test/monthSearch.test.js is where that is pinned, including that the three
  // dead rules stay dead.
  // NOT ASSERTED HERE: that this is a `PickOne` rather than a `<select>`. The
  // first draft of this test did — `assert.ok(!/<select/.test(hrView))` — and it
  // went red on the four COMMENTS in that file explaining why the last native
  // dropdown was removed on 2026-09-01. It is a real rule and it already has a
  // file that asks it of the whole tree without grepping prose:
  // test/noNativeSelect.test.js.
});

test('it sits on the filter bar, third, where รออนุมัติ OT puts its own', () => {
  /* ค้นหา · สถานะ · แผนก · เดือน — the queue's order, and this screen's since
     2026-09-10. It sat between ประจำเดือน and ค้นหา for one afternoon on an
     argument of this screen's own ("which month, whose month, then find one
     person in it") which was sound and was simply not the other screen's. See
     test/monthSearch.test.js, where that reversal is written out.

     WHAT HAS NOT CHANGED is that it is on the BAR and not on the heading line.
     สถานะที่นับ hung off the heading until the same afternoon; both are filters,
     both are on the bar, and no heading in this app shares a line with a
     control any more. */
  const from = hrView.indexOf('<div className="queue-tools">');
  const row = hrView.slice(from, hrView.indexOf('<div className="month-card">', from));
  assert.ok(row.includes('label="แผนก"'), 'แผนก is not on the filter bar');
  assert.ok(
    row.indexOf('className="searchbox"') < row.indexOf('label="แผนก"'),
    'แผนก is drawn above the search box',
  );
  assert.ok(
    row.indexOf('label="สถานะที่นับ"') < row.indexOf('label="แผนก"'),
    'แผนก overtook สถานะที่นับ on the bar',
  );
  assert.ok(
    row.indexOf('label="แผนก"') < row.indexOf('<PickMonth'),
    'ประจำเดือน is drawn above แผนก',
  );
});

// ── and the screen says which แผนก it is showing ────────────────────────────

test('every sentence that could be read as the whole company names the แผนก', () => {
  // THE HEADING. The dropdown is two rows down and scrolls away; this line does
  // not, and a total read without knowing whose it is is the figure this screen
  // exists to get right.
  assert.match(hrView, /\{deptName && ` · \$\{deptName\}`\}/);
  // THE EMPTY MONTH. "ไม่มีรายการในเดือนนี้" with ผลิต2 chosen is very nearly a
  // lie — the month may be full and this is one department out of eighteen that
  // filed nothing — so the narrowed case says which, with the way out under it.
  assert.match(hrView, /ไม่มีรายการของ “\{deptName\}” ในเดือนนี้/);
  assert.match(hrView, /onClick=\{\(\) => setDept\(''\)\}/);
  assert.match(hrView, /ดูทุกแผนก/);
  // …and the unnarrowed case keeps the sentence it always had.
  assert.match(hrView, /<Empty>ไม่มีรายการในเดือนนี้<\/Empty>/);
  // THE TOTAL ROW, in the แผนก column of the row that totals the แผนก column.
  assert.match(hrView, /<td className="dept-col">\{deptName \|\| ''\}<\/td>/);
  // And `deptName` is resolved from the list, not from a row — a month with no
  // rows in it still has to be able to say whose month it is empty of.
  assert.match(
    hrView,
    /const deptName = departments\.find\(\(d\) => d\.value === dept\)\?\.label \|\| '';/,
  );
});

test('the notices cannot outlive the department they were counted over', () => {
  // Every count `MonthAlerts` draws is the server's, over the narrowed month.
  assert.match(hrView, /key=\{`\$\{period\}\|\$\{statusFilter\}\|\$\{dept\}`\}/);
  // The page and the fold are claims about a list this replaces wholesale.
  assert.match(
    hrView,
    /setPage\(1\);\s*setShowAllCards\(false\);\s*\}, \[period, statusFilter, dept, query, onlyFlagged\]\);/,
  );
  // AND SO IS ดูเฉพาะคนที่ต้องตรวจ, which is why it is released by the same
  // three. It narrows by `compare.people` — a list the server rebuilds for
  // every one of them — so a press made against สิงหาคม's findings, still held
  // while กันยายน loads, empties a table the card above has just called clean.
  assert.match(
    hrView,
    /useEffect\(\(\) => \{ setOnlyFlagged\(false\); \}, \[period, statusFilter, dept\]\);/,
  );
});
