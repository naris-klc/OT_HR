/**
 * รหัสพนักงาน comparison — the rule that PM-0620 and PM0620 are one code.
 *
 * The four callers this module exists for are exercised end to end against a
 * real Mongo elsewhere; what is pinned here is the rule itself, including the
 * property the MongoDB matcher is only correct because of: that it matches
 * exactly the strings `normalizeCode()` maps to the same key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeCode, sameCode, compareCodes, codeMatcher, codeCollisions, CODE_LOCALE,
} from '../src/lib/employeeCode.js';
import { groupByDepartment } from '../lib/departmentSummary.js';
import { companyFromCode } from '../src/config/companies.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(ROOT, f), 'utf8');

/**
 * The same file with its comments taken out — for the bans below, which look
 * for a spelling that must not RUN.
 *
 * Both of them would otherwise be failed by the notes that record what they
 * replaced: the routes quote the old `localeCompare` and the dead mongo sort in
 * so many words, which is exactly the history worth keeping and exactly what a
 * naive search cannot tell from the real thing. The same stripper
 * test/permissionRouteGuards.test.js uses, for the same reason.
 */
const code = (f) => src(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the comment stripper actually strips — the two bans below prove nothing otherwise', () => {
  const text = code('app/api/exports/entries.csv/route.js');
  assert.ok(!text.includes('ObjectId reference'), 'a block comment survived');
  assert.match(text, /export const GET/, 'the stripper ate the code as well');
});

test('both roster shapes normalise to a comparable key', () => {
  assert.equal(normalizeCode('PM-0620'), 'PM0620');
  assert.equal(normalizeCode('pm0620'), 'PM0620');
  assert.equal(normalizeCode('pm-0620'), 'PM0620');
  assert.equal(normalizeCode(' PM 0620 '), 'PM0620');
  assert.equal(normalizeCode('PM_0620'), 'PM0620');
  assert.equal(normalizeCode('PM00511'), 'PM00511');
});

test('normalising never merges two codes that differ in a character', () => {
  assert.notEqual(normalizeCode('PM-0620'), normalizeCode('PM-06200'));
  assert.notEqual(normalizeCode('PM0412'), normalizeCode('PM00412'));
});

test('nothing to compare is not a match for everything', () => {
  assert.equal(normalizeCode(''), '');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode('---'), '');
  assert.equal(sameCode('', ''), false);
  assert.equal(sameCode('---', '-'), false);
  assert.equal(codeMatcher('---'), null);
  assert.equal(codeMatcher(''), null);
});

test('sameCode is the decision the three call sites make', () => {
  assert.ok(sameCode('PM-0620', 'pm0620'));
  assert.ok(sameCode('THT0018', 'tht-0018'));
  assert.equal(sameCode('PM-0620', 'PM-0621'), false);
  assert.equal(sameCode('PM-0620', 'PM06200'), false);
});

/**
 * The property the login and the import both lean on: the regex handed to
 * MongoDB selects exactly the rows JS would then accept. A matcher that let
 * anything else through would hand `sameCode` the wrong row and fail a valid
 * login; one that missed a spelling would mint a duplicate employee.
 */
test('the matcher accepts exactly the strings that normalise the same', () => {
  const stored = ['PM-0620', 'PM0620', 'pm 0620', 'PM_0620', '--PM0620--', 'p-m-0-6-2-0'];
  const other = ['PM-0621', 'PM06200', 'PM062', 'XPM0620', 'PM0620X', ''];

  for (const query of ['PM-0620', 'pm0620', 'PM_0620']) {
    const re = codeMatcher(query);
    for (const s of stored) {
      assert.ok(re.test(s), `${query} should match ${s}`);
      assert.ok(sameCode(s, query), `${query} should equal ${s}`);
    }
    for (const s of other) {
      assert.equal(re.test(s), false, `${query} must not match ${s}`);
    }
  }
});

test('a code cannot smuggle a regex metacharacter into the matcher', () => {
  // normalizeCode() leaves only [A-Z0-9], so '.*' is separators around nothing.
  assert.equal(codeMatcher('.*'), null);
  assert.equal(codeMatcher('PM.*0620').test('PMX0620'), false);
  assert.ok(codeMatcher('PM.*0620').test('PM-0620'));
});

// ── the import's file-level refusal ──────────────────────────────────────────

test('two spellings of one code in one file are a collision', () => {
  const found = codeCollisions([
    { line: 2, code: 'PM-0620' },
    { line: 3, code: 'PM-0412' },
    { line: 4, code: 'pm0620' },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].key, 'PM0620');
  assert.deepEqual(found[0].rows.map((r) => r.line), [2, 4]);
});

test('the same code written identically twice is the same clash', () => {
  const found = codeCollisions([
    { line: 2, code: 'PM-0620' },
    { line: 3, code: 'PM-0620' },
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].rows.map((r) => r.line), [2, 3]);
});

test('a clean file collides with nothing, and empty codes are left to their own error', () => {
  assert.deepEqual(codeCollisions([
    { line: 2, code: 'PM-0620' },
    { line: 3, code: 'PM00511' },
    { line: 4, code: 'THT0018' },
  ]), []);
  assert.deepEqual(codeCollisions([{ line: 2, code: '' }, { line: 3, code: '' }]), []);
  assert.deepEqual(codeCollisions([]), []);
});

test('collisions are reported in the order HR reads the file', () => {
  const found = codeCollisions([
    { line: 2, code: 'THT-0018' },
    { line: 3, code: 'PM-0620' },
    { line: 4, code: 'PM0620' },
    { line: 5, code: 'tht0018' },
  ]);
  assert.deepEqual(found.map((c) => c.key), ['THT0018', 'PM0620']);
});

// ── ordering ─────────────────────────────────────────────────────────────────

test('the sort locale is named, not the host default', () => {
  assert.equal(CODE_LOCALE, 'en');
  // Same answer whichever spelling arrives, which the raw localeCompare the
  // report used did not give: ICU weights the hyphen below the digits.
  assert.equal(compareCodes('PM-0620', 'pm0620'), 0);
  assert.ok(compareCodes('PM00511', 'PM-0620') < 0);
  assert.ok(compareCodes('PM-0620', 'PM00511') > 0);
});

test('the digits are compared as a number, not read left to right', () => {
  /**
   * ASKED FOR ON 2026-09-03 — *"ใบต้องเรียงตามลำดับตัวเลข"* — about the two
   * report screens, and this is the case that shows why the old comparator
   * could not give it.
   *
   * `PM-0412` normalises to PM0412 and `PM00416` to PM00416. Character by
   * character they part at the fourth: `4` against `0`, so the five-digit
   * spelling wins and 416 sorts ABOVE 412. Every PM004xx and PM005xx on this
   * register therefore sat above every four-digit code, and a reader looking
   * for 0412 found it below 00416 with nothing to explain the order.
   */
  assert.ok(compareCodes('PM-0412', 'PM00416') < 0, '412 must come before 416');
  assert.ok(compareCodes('PM00416', 'PM-0412') > 0);
  assert.ok(compareCodes('PM-0100', 'PM00416') < 0, '100 must come before 416');
  // …and the whole register in one go, mixing both spellings and both prefixes.
  const roster = ['THT0012', 'PM00511', 'PM-0620', 'PM-0100', 'PM00416', 'PM-0412', 'THT00111'];
  assert.deepEqual(
    [...roster].sort(compareCodes),
    ['PM-0100', 'PM-0412', 'PM00416', 'PM00511', 'PM-0620', 'THT0012', 'THT00111'],
  );
});

test('two codes that are the same number but spelled apart still have an order', () => {
  // PM-0620 and PM620 are two people on this roster and compare equal on every
  // run — `0620` and `620` are one number. Left there, `.sort()` may return
  // them either way round, and a sheet that reorders itself between two exports
  // of an unchanged month is worse than one in an order somebody disagrees
  // with. The tie-break is the normalised string, reached only here.
  assert.notEqual(compareCodes('PM-0620', 'PM620'), 0);
  assert.equal(compareCodes('PM-0620', 'PM620'), -compareCodes('PM620', 'PM-0620'));
  // Two spellings of the SAME code are still one code — this may not disagree
  // with `sameCode`, which is what decides that they are one person.
  assert.equal(compareCodes('PM-0620', 'pm0620'), 0);
  assert.equal(sameCode('PM-0620', 'pm0620'), true);
});

test('letters order before digits run out, and a shorter code comes first', () => {
  assert.ok(compareCodes('PM-0001', 'THT0001') < 0, 'PM before THT');
  assert.ok(compareCodes('PM', 'PM0001') < 0, 'the shorter code first');
  assert.ok(compareCodes('PM1', 'PMA') < 0, 'a digit run sorts above a letter run');
  // ADMIN has no digits at all and must still land somewhere fixed.
  assert.ok(compareCodes('ADMIN', 'HR-001') < 0);
  assert.equal(compareCodes('ADMIN', 'ADMIN'), 0);
});

test('groupByDepartment orders rows by numeric code', () => {
  const row = (code, department) => ({
    employee: { code },
    department,
    ot15Hours: 1,
    ot3Hours: 0,
    otHours: 1,
  });
  const eng = { id: 'd1', code: 'ENG', name: 'วิศวกรรม' };

  const [group] = groupByDepartment([
    { key: 'primus', rows: [row('PM-0620', eng), row('PM00511', eng)] },
    { key: 'themtech', rows: [row('pm0412', eng)] },
  ]);

  // It read `['PM00511', 'pm0412', 'PM-0620']` until 2026-09-03 — 412 sitting
  // between 511 and 620, which is what a character-by-character sort does to a
  // register that spells one shape two ways. See the case above.
  assert.deepEqual(
    group.rows.map((r) => r.employee.code),
    ['pm0412', 'PM00511', 'PM-0620'],
  );
});

test('the unnamed department still sorts last', () => {
  const row = (code, department) => ({
    employee: { code }, department, ot15Hours: 1, ot3Hours: 0, otHours: 1,
  });
  const groups = groupByDepartment([{
    key: 'primus',
    rows: [
      row('PM-0001', null),
      row('PM-0002', { id: 'd2', code: 'QC', name: 'ควบคุมคุณภาพ' }),
      row('PM-0003', { id: 'd1', code: 'ENG', name: 'วิศวกรรม' }),
    ],
  }]);
  assert.deepEqual(groups.map((g) => g.code), ['ENG', 'QC', '￿']);
  assert.equal(groups.at(-1).name, 'ไม่ระบุแผนก');
});

// ── every document of a month is in ONE order ────────────────────────────────

test('all four monthly documents order people by compareCodes, none by localeCompare', () => {
  /**
   * FIVE DOCUMENTS DESCRIBE ONE MONTH and they are read against each other —
   * the table on ตรวจสอบประจำเดือน, its two CSVs, รายงาน OT ฝ่ายบัญชี (screen,
   * print and CSV alike, all off `lib/accounting.js`) and รายงาน OT แยกแผนก.
   * Somebody reconciling the signed sheet against the file goes down both with
   * a finger; two of them in different orders is that job done twice.
   *
   * `lib/departmentSummary.js` has asked `compareCodes` since it was written.
   * The other three were each spelling their own `localeCompare` — with no
   * locale named, so the host's ICU decided, and on the raw code, so a hyphen
   * moved a person. They ask the one comparator now.
   */
  const files = [
    'app/api/reports/monthly/[period]/route.js',
    'app/api/exports/monthly.csv/route.js',
    'app/api/exports/entries.csv/route.js',
    'lib/accounting.js',
    'lib/departmentSummary.js',
  ];
  for (const file of files) {
    const text = code(file);
    assert.match(text, /compareCodes\(/, `${file} does not order by compareCodes`);
    assert.ok(
      !/localeCompare\(\s*String\(\w+\.employee/.test(text)
      && !/employee\??\.code\)?\.localeCompare/.test(text),
      `${file} still sorts employee codes with a bare localeCompare`,
    );
  }
});

test('the entries CSV no longer asks mongo to sort by a path no document has', () => {
  /**
   * `.sort({ 'employee.code': 1, workDate: 1 })` was on the query, and
   * `employee` is an ObjectId reference — `populate` fills it in long after the
   * database has ordered the rows. Mongo does not refuse a path that is not
   * there; it orders by nothing, so `workDate` was the only clause that ever
   * ran and the file came out in date order with the people interleaved,
   * claiming a column it was not sorted by.
   */
  const text = code('app/api/exports/entries.csv/route.js');
  assert.ok(!/\.sort\(\{[^}]*'employee\.code'/.test(text), 'the dead mongo sort is back');
  // Sorted where the populated code exists, with a third key so two rows on one
  // date for one person cannot come back either way round.
  assert.match(text, /compareCodes\(a\.employee\?\.code, b\.employee\?\.code\)/);
  assert.match(text, /String\(a\.startTime\)\.localeCompare\(String\(b\.startTime\)\)/);
});

test('the list of ใบ every บทบาท reads is ordered by the same comparator', () => {
  /**
   * 2026-09-07, and it is the sixth document rather than a sixth rule: the five
   * above describe a month for the people who close it, and this is the screen
   * everybody else spends their day on — รายการรออนุมัติ, รออนุมัติ OT,
   * รออนุมัติแทน, ไม่มีหัวหน้าเซ็น, คำขอถอนใบ and บันทึกและประวัติ OT are all
   * one endpoint. Somebody checking a queue against a printed sheet was the
   * only reader whose two documents were still in different orders.
   *
   * The comparator is in `lib/entries.js` rather than in the route, because the
   * route resolves `@/…` and `node --test` does not — the same reason
   * lib/accountingRows.js was split out of lib/accounting.js. It is behaviour,
   * so it is tested as behaviour in test/entryListCap.test.js; what is checked
   * here is only that the route still uses it and that nothing has quietly
   * spelled a second comparison beside it.
   */
  const lib = code('lib/entries.js');
  assert.match(lib, /compareCodes\(a\?\.employee\?\.code, b\?\.employee\?\.code\)/);

  const route = code('app/api/entries/route.js');
  assert.match(route, /\.sort\(byEmployeeThenLatest\)/, 'the list no longer orders by code');
  /**
   * AND THE MONGO SORT STAYS. It decides which rows survive the 500-row cap,
   * and dropping the oldest is the trade-off `capFor` documents and the banner
   * over the table reports. Ordering by code in the database is not available
   * (`employee` is an ObjectId until `populate` runs) and faking it would drop
   * everybody past the middle of the register instead.
   */
  assert.match(route, /\.sort\(\{ workDate: -1, createdAt: -1 \}\)/, 'the cap has lost its order');
});

// ── the copy that used to live in src/config/companies.js ────────────────────

test('companyFromCode still reads both shapes, now through the shared rule', () => {
  assert.equal(companyFromCode('PM-0412'), 'primus');
  assert.equal(companyFromCode('PM00511'), 'primus');
  assert.equal(companyFromCode('pm 0620'), 'primus');
  assert.equal(companyFromCode('THT0018'), 'themtech');
  assert.equal(companyFromCode('tht-0018'), 'themtech');
  assert.equal(companyFromCode('HR-001'), null);
  assert.equal(companyFromCode(''), null);
  assert.equal(companyFromCode(null), null);
});
