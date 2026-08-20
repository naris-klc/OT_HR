import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FORM_PRINT_SCOPES, REPORTABLE_STATUSES, formPrintStatuses,
} from '../lib/reports.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS } from '../lib/policyVersion.js';

/**
 * นโยบายการพิมพ์ใบขออนุมัติ OT — which requests reach the printed F-HR-027.
 *
 * The sheet has two signature columns on it and its สรุปรวม is read by payroll,
 * so "which rows are on it" is not a display preference. Before this flag the
 * route fetched อนุมัติแล้ว + รอ HR + รอหัวหน้า unconditionally and printed no
 * status anywhere: HR could set สถานะที่นับ to อนุมัติแล้วเท่านั้น, read a total
 * off ตรวจสอบรายเดือน, press พิมพ์, and be handed a sheet with a larger total
 * and nothing on the paper saying which rows the difference was.
 *
 * What is pinned here is the TABLE — policy answer × screen request → statuses
 * — because it is the whole rule and it is pure. The route cannot be imported
 * (it resolves `@/…` through the Next alias, which node --test does not), so the
 * wiring around the table is checked by reading the source, as
 * test/formBundle.test.js and test/printFlagLayout.test.js do.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ROUTE = 'app/api/reports/form/[period]/route.js';
const SHEET = 'components/PrintForm.jsx';
const BUNDLE = 'components/PrintFormBatch.jsx';
const SCREEN = 'components/HrView.jsx';
const SETTINGS = 'components/AdminView.jsx';

const ALL_LIVE = 'approved,pending_hr,pending_mgr';

// ── the shipped answer ───────────────────────────────────────────────────────

test('the form prints approved rows and nothing else until HR says otherwise', () => {
  assert.equal(DEFAULT_POLICY.formPrintScope, 'approved');
  const { scope, statuses } = formPrintStatuses(DEFAULT_POLICY);
  assert.equal(scope, 'approved');
  assert.deepEqual(statuses, ['approved']);
});

test('the three answers are the three the settings page offers, and no more', () => {
  assert.deepEqual([...FORM_PRINT_SCOPES], ['approved', 'screen', 'draft']);
});

// ── [a] เฉพาะรายการที่อนุมัติแล้ว ────────────────────────────────────────────

test('strict ignores the screen — a widened filter cannot put a queue row on a signed sheet', () => {
  for (const asked of [ALL_LIVE, 'approved,pending_hr', 'pending_mgr', 'approved']) {
    const { statuses } = formPrintStatuses({ formPrintScope: 'approved' }, asked);
    assert.deepEqual(
      statuses,
      ['approved'],
      `?status=${asked} widened a sheet the policy says is approved-only`,
    );
  }
});

test('strict ignores a hand-edited URL too — that is what makes it a setting', () => {
  // `?status=` reaches the route from a browser. Anybody who can open the print
  // page can type one; if it can widen the sheet, the strict answer is a
  // convention rather than a rule.
  const { statuses } = formPrintStatuses({ formPrintScope: 'approved' }, 'pending_mgr,rejected');
  assert.deepEqual(statuses, ['approved']);
});

// ── [b] อิงตามสถานะที่เลือกบนหน้าจอ ──────────────────────────────────────────

test('screen prints what สถานะที่นับ is set to, so the paper and the table agree', () => {
  const at = (asked) => formPrintStatuses({ formPrintScope: 'screen' }, asked).statuses;
  assert.deepEqual(at('approved'), ['approved']);
  assert.deepEqual(at('approved,pending_hr'), ['approved', 'pending_hr']);
  assert.deepEqual(at(ALL_LIVE), ['approved', 'pending_hr', 'pending_mgr']);
});

test('screen still refuses the two statuses no report may print', () => {
  // `reportStatuses` drops them, and it must keep doing so through this path:
  // widening what a SHEET may show can never widen what a REPORT may show.
  const { statuses } = formPrintStatuses(
    { formPrintScope: 'screen' },
    'approved,cancelled,rejected,pending_hr',
  );
  assert.deepEqual(statuses, ['approved', 'pending_hr']);
  for (const s of statuses) assert.ok(REPORTABLE_STATUSES.includes(s));
});

test('screen with nothing to follow falls back to strict, not to the wide list', () => {
  // A พนักงาน printing their own month sends no filter, and neither would a
  // screen added later that forgot. The safe reading of "follow the screen"
  // when there is no screen is the one that keeps queue rows off the paper.
  const scoped = { formPrintScope: 'screen' };
  assert.deepEqual(formPrintStatuses(scoped).statuses, ['approved']);
  assert.deepEqual(formPrintStatuses(scoped, '').statuses, ['approved']);
});

test('screen asked for closed statuses alone prints an empty sheet, not a full one', () => {
  // `reportStatuses` answers a request for nothing but ยกเลิก/ไม่อนุมัติ with an
  // empty list, everywhere, and that rule is not rewritten here: the fallback
  // covers a request that was NOT MADE, never one that was made and refused.
  // Falling back to approved-only would be this route quietly answering a
  // different question from every other report — and the empty answer is
  // harmless on this document, where a blank F-HR-027 is a page nobody signs.
  const { statuses } = formPrintStatuses({ formPrintScope: 'screen' }, 'cancelled,rejected');
  assert.deepEqual(statuses, []);
});

// ── [c] รวมรายการรออนุมัติด้วยเสมอ ───────────────────────────────────────────

test('draft is the behaviour the route shipped with — all three live statuses', () => {
  const { statuses } = formPrintStatuses({ formPrintScope: 'draft' });
  assert.deepEqual(statuses, ['approved', 'pending_hr', 'pending_mgr']);
});

test('draft ignores the screen in the other direction — one document, one meaning', () => {
  // HR has said the sheet is a working copy. Narrowing it per print would make
  // two different documents that are both called ใบร่าง.
  const { statuses } = formPrintStatuses({ formPrintScope: 'draft' }, 'approved');
  assert.deepEqual(statuses, ['approved', 'pending_hr', 'pending_mgr']);
});

// ── an unset or damaged answer ───────────────────────────────────────────────

test('a missing or unrecognised answer reads as the strict one', () => {
  // Setting.policy can hold a value from a retired option, a seed can be old,
  // and `policy` is undefined in any caller that forgot it. Every one of those
  // must fail towards the sheet that is safe to sign.
  const bad = [undefined, null, {}, { formPrintScope: '' },
    { formPrintScope: 'all' }, { formPrintScope: true }];
  for (const policy of bad) {
    const { scope, statuses } = formPrintStatuses(policy, ALL_LIVE);
    assert.equal(scope, 'approved', `${JSON.stringify(policy)} did not fall back to strict`);
    assert.deepEqual(statuses, ['approved']);
  }
});

test('the scope comes back with the list, so a sheet can say why it holds what it holds', () => {
  assert.equal(formPrintStatuses({ formPrintScope: 'draft' }).scope, 'draft');
  assert.equal(formPrintStatuses({ formPrintScope: 'screen' }, 'approved').scope, 'screen');
});

// ── the classification ───────────────────────────────────────────────────────

test('the print policy moves no hour — it must never replay a month', () => {
  // It decides WHICH ENTRIES ARE FETCHED, never what any of them is worth: the
  // hours come from stored `segments`, computed when the entry was filed.
  // Classified arithmetic, `savePolicy` would recompute several thousand
  // entries and rewrite not one minute of them.
  assert.ok(COSMETIC_KEYS.includes('formPrintScope'));
  assert.ok(!ARITHMETIC_KEYS.includes('formPrintScope'));
});

// ── the wiring ───────────────────────────────────────────────────────────────

test('the route decides, and it decides with the policy in hand', () => {
  const code = sourceOf(ROUTE);
  assert.match(
    code,
    /const \{ scope: printScope, statuses \} = formPrintStatuses\(policy, q\.status\)/,
    'the route must weigh ?status= against the policy rather than trusting it',
  );
  assert.ok(
    !/reportStatuses\(q\.status\)/.test(code),
    'the route reads the request directly again — the policy is bypassed',
  );
  // The query that fetches the entries must be the one this produced.
  assert.match(code, /status: \{ \$in: statuses \}/);
});

test('the sheet is told which answer produced it, and which of its rows are unsettled', () => {
  const code = sourceOf(ROUTE);
  assert.match(code, /^\s*printScope,$/m, 'the screen cannot explain a narrowed print');
  assert.match(code, /pending: shown$/m);
  assert.match(
    code,
    /\.filter\(\(e\) => e\.status !== 'approved'/,
    'pending must be the rows that are ON the paper and not approved',
  );
});

test('both print paths pass สถานะที่นับ through, and neither invents its own', () => {
  const single = sourceOf(SHEET);
  const bundle = sourceOf(BUNDLE);
  const screen = sourceOf(SCREEN);

  assert.match(single, /export function sheetQuery/);
  assert.match(single, /parts\.push\(`status=\$\{encodeURIComponent\(status\)\}`\)/);
  assert.match(bundle, /sheetQuery\(\{ employeeId: employee\._id, status \}\)/);

  // ตรวจสอบรายเดือน holds the filter; both buttons on it must hand it over, or
  // the two documents disagree with the table they were printed from.
  assert.match(screen, /<PrintFormBatch[\s\S]{0,400}?status=\{statusFilter\}/);
  assert.match(screen, /<PrintForm\b[\s\S]{0,300}?status=\{statusFilter\}/);
});

test('an unapproved row says so on the paper, in the cell that carries the other remarks', () => {
  // Not a column and not a row: F-HR-027 Rev.4 is measured in millimetres
  // against A4 (see app/print.css), and a fourth remark beside three existing
  // ones is not a revision of the form.
  const code = sourceOf(SHEET);
  const open = code.indexOf('<td className="desc"');
  const cell = code.slice(open, code.indexOf('</td>', open));
  assert.match(cell, /s && s\.status !== 'approved' \? ' \(รออนุมัติ\)' : ''/);
  assert.match(cell, /filedByProxy/, 'this is still the cell that carries per-row remarks');
});

test('the mark is explained under the grid, and only on a sheet that carries one', () => {
  // An unexplained abbreviation on a signature document cannot do the job the
  // mark exists for. A sheet with nothing pending renders no element at all, so
  // an ordinary form is unchanged.
  const code = sourceOf(SHEET);
  assert.match(
    code,
    /function PendingNote\(\{ form \}\) \{\s*if \(!form\.pending\?\.length\) return null;/,
  );
  const paper = code.slice(code.indexOf('function PendingNote'), code.indexOf('function ActingNote'));
  assert.doesNotMatch(paper, /no-print/, 'the legend is hidden from the paper it explains');
  assert.match(paper, /\(รออนุมัติ\)/);
});

test('whoever pressed print is told what the paper cannot say', () => {
  const code = sourceOf(SHEET);
  // Hours that ARE on the sheet and are not settled…
  assert.match(code, /form\.pending\?\.length > 0 && \(/);
  // …and the opposite surprise: a strict policy quietly narrowing a wide filter.
  assert.match(code, /const narrowed = form\.printScope === 'approved'/);
  // Both belong to the screen — the paper cannot carry either.
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  assert.equal(
    (notices.match(/className="no-print"/g) || []).length,
    4,
    'every notice block above the sheet must be marked no-print',
  );
});

test('HR can set the answer from ตั้งค่าระบบ, and the loose ones warn', () => {
  const code = sourceOf(SETTINGS);
  const row = code.slice(code.indexOf("key: 'formPrintScope'"));
  const field = row.slice(0, row.indexOf('\n  },'));

  assert.match(field, /label: 'นโยบายการพิมพ์ใบขออนุมัติ OT'/);
  for (const value of FORM_PRINT_SCOPES) {
    assert.match(field, new RegExp(`\\['${value}',`), `ไม่มีตัวเลือก ${value} บนหน้าตั้งค่า`);
  }
  // Strict first: the first option in a list reads as the recommended one.
  assert.match(field, /options: \[\s*\['approved',/);
  // And the two that put unapproved hours under a signature say what that costs.
  // Both halves, because either alone is the half that raises the question
  // rather than answering it: what the sheet will carry, and what goes wrong
  // when it is signed and the row is refused afterwards.
  assert.match(field, /warn: \(value\) => \(value === 'approved'/);
  assert.match(field, /รวมรายการที่ยังไม่อนุมัติ/);
  assert.match(field, /ไม่ตรงกับยอดจ่ายจริง/);
});

test('the row says what is being asked once, and what each answer is for', () => {
  const code = sourceOf(SETTINGS);
  const row = code.slice(code.indexOf("key: 'formPrintScope'"));
  const field = row.slice(0, row.indexOf('\n  },'));

  // One sentence, not the whole rule — see the note over `hint` in AdminView.
  assert.match(
    field,
    /hint: 'กำหนดข้อมูลที่จะนำมาแสดงในใบขออนุมัติ OT \(F-HR-027\) เมื่อสั่งพิมพ์เอกสาร'/,
  );

  // Every answer the dropdown offers is glossed. A fourth option added without
  // one would render a dropdown line with no explanation beside it.
  for (const value of FORM_PRINT_SCOPES) {
    assert.ok(field.includes(`${value}: '`), `ไม่มีคำอธิบายของตัวเลือก ${value}`);
  }
  assert.match(field, /เหมาะสำหรับเป็นเอกสารจริงส่งฝ่ายบัญชี/);
  assert.match(field, /เหมาะสำหรับพิมพ์เป็นใบร่างเดินเรื่อง/);
});

test('the glosses are drawn from the same strings the dropdown shows', () => {
  // The term in the <dl> is the option label itself, read off `options`. A
  // paraphrase typed out beside it would be a fourth answer to look for in a
  // list of three, and would drift the first time a label was reworded.
  const code = sourceOf(SETTINGS);
  assert.match(code, /f\.optionHints && \(/);
  assert.match(code, /\.filter\(\(\[v\]\) => f\.optionHints\[String\(v\)\]\)/);
  assert.match(code, /<dt>\{l\}<\/dt>/);
  assert.match(code, /<dd>\{f\.optionHints\[String\(v\)\]\}<\/dd>/);
  // Optional per field: every other row on the page declares none and draws
  // nothing. If this ever renders unconditionally it grows twenty blank blocks.
  assert.match(code, /\{f\.hint && <div className="hint policy-help">\{f\.hint\}<\/div>\}/);
});
