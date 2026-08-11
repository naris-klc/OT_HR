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
import {
  normalizeCode, sameCode, compareCodes, codeMatcher, codeCollisions, CODE_LOCALE,
} from '../src/lib/employeeCode.js';
import { groupByDepartment } from '../lib/departmentSummary.js';
import { companyFromCode } from '../src/config/companies.js';

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

test('groupByDepartment orders rows by normalised code', () => {
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

  assert.deepEqual(
    group.rows.map((r) => r.employee.code),
    ['PM00511', 'pm0412', 'PM-0620'],
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
