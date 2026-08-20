import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FORM_PRINT_SCOPES, REPORTABLE_STATUSES, formPrintStatuses, formPendingStatuses,
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

// ── which of those rows the paper marks ─────────────────────────────────────

/**
 * The second half of the table. `formPrintStatuses` says which rows reach the
 * paper; this says which of them the paper calls ยังไม่อนุมัติ, and the two are
 * not the same question.
 *
 * รอ HR means the หัวหน้า has signed. The step still open is the one the sheet
 * itself carries — the เฉพาะฝ่ายบุคคล box at the foot, filled in by whoever
 * pressed print. Marking those rows told ฝ่ายบุคคล that ฝ่ายบุคคล had not
 * decided yet, and spent two lines of a millimetre-measured form explaining it.
 */

test('อนุมัติแล้ว + รอ HR prints a sheet somebody can sign — no mark, no legend', () => {
  assert.deepEqual(formPendingStatuses(['approved', 'pending_hr']), []);
});

test('รอ HR is marked again as soon as รอหัวหน้า can reach the same sheet', () => {
  // Under ใบร่างเดินเรื่อง both queues print together. A mark on one and
  // silence on the other would read as "these are the unapproved rows", which
  // on a sheet carrying both would be false.
  assert.deepEqual(
    formPendingStatuses(formPrintStatuses({ formPrintScope: 'draft' }).statuses),
    ['pending_hr', 'pending_mgr'],
  );
});

test('the strict answer has nothing to mark, and asking is not an error', () => {
  assert.deepEqual(formPendingStatuses(['approved']), []);
  assert.deepEqual(formPendingStatuses([]), []);
  assert.deepEqual(formPendingStatuses(undefined), []);
});

test('a sheet of รอหัวหน้า rows alone still marks every one of them', () => {
  assert.deepEqual(formPendingStatuses(['pending_mgr']), ['pending_mgr']);
});

test('it knows one thing about รอ HR and nothing about any other status', () => {
  // A status added later is unapproved until somebody decides otherwise here.
  assert.deepEqual(formPendingStatuses(['approved', 'pending_audit']), ['pending_audit']);
  assert.deepEqual(
    formPendingStatuses(['approved', 'pending_hr', 'pending_audit']),
    ['pending_audit'],
  );
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
  assert.match(
    code,
    /const pendingStatuses = formPendingStatuses\(statuses\)/,
    'the route must ask which statuses the paper marks — not assume every unapproved one',
  );
  assert.match(
    code,
    /pending: shown\.filter\(\(e\) => onSheet\(e\) && pendingStatuses\.includes\(e\.status\)\)/,
    'pending must be the rows that are ON the paper and that the paper marks',
  );
  // …and the ones it is silent about are still handed to the screen.
  assert.match(code, /^\s*unmarked: shown$/m);
  assert.match(code, /!pendingStatuses\.includes\(e\.status\)/);
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
  assert.match(cell, /s && pendingIds\.has\(s\.entryId\) \? ' \(รออนุมัติ\)' : ''/);
  // Off the server’s list, never off the status a second time: the mark and the
  // legend that explains it are one decision, so neither can outlive the other on
  // a document somebody signs.
  assert.match(
    code,
    /const pendingIds = new Set\(\(form\.pending \|\| \[\]\)\.map\(\(p\) => p\.id\)\)/,
  );
  assert.match(cell, /filedByProxy/, 'this is still the cell that carries per-row remarks');
});

test('the paper carries the mark and no legend under the grid', () => {
  // HR asked the หมายเหตุ block off F-HR-027 (2026-08-20). The mark stays —
  // (รออนุมัติ) is the word itself, in the cell beside the work it belongs to,
  // and it is the one remark there that bears on whether a row may be signed.
  // What the block added over it was a count and a warning about สรุปรวม, and
  // both of those are on the screen, in front of whoever pressed print.
  const code = sourceOf(SHEET);
  assert.ok(!code.includes('PendingNote'), 'the legend block is back on the paper');

  // Nothing under the grid but the acting note, which has its own flag.
  const grid = code.slice(code.indexOf('</table>'), code.indexOf('<div className="f027-foot">'));
  assert.doesNotMatch(grid, /หมายเหตุ · รายการที่ยังไม่อนุมัติ/);
  assert.match(grid, /<ActingNote form=\{form\} \/>/);

  // And the count the block used to print is still said, on the screen.
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  assert.match(notices, /\{form\.pending\.length\} รายการที่ยังไม่อนุมัติ/);
  assert.match(notices, /\(รออนุมัติ\)/);
});

test('the rows the paper is silent about are named on the screen, with their dates', () => {
  // A count says how much of the sheet is unconfirmed; it does not say where
  // to look, and looking is the only thing left to do about these rows.
  const code = sourceOf(SHEET);
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  assert.match(notices, /\{form\.unmarked\.length\} รายการที่สถานะยังเป็น/);
  assert.match(notices, /\{unmarkedDates\}/);

  // One entry per date, in date order — ISO strings sort chronologically, and
  // a date carried twice is one day to look at, not two.
  assert.match(
    code,
    /const unmarkedDates = \[\.\.\.new Set\(\(form\.unmarked \|\| \[\]\)\.map\(\(u\) => u\.workDate\)\)\]\s*\.sort\(\)\s*\.map\(thaiDate\)/,
  );
  // The long form: an overnight session started on the 31st puts a workDate
  // from the month before on this sheet, and a bare day number would name the
  // wrong day exactly there.
  assert.doesNotMatch(notices, /thaiDateShort/);
});

test('whoever pressed print is told what the paper cannot say', () => {
  const code = sourceOf(SHEET);
  // Hours that ARE on the sheet and are not settled…
  assert.match(code, /form\.pending\?\.length > 0 && \(/);
  // …and the opposite surprise: a strict policy quietly narrowing a wide filter.
  assert.match(code, /const narrowed = narrowedByPolicy\(form, asked\)/);
  // One reading of it, exported, because the bundle asks the same question of
  // forty sheets at once and answers for the document rather than the page.
  assert.match(code, /export function narrowedByPolicy\(form, asked = ''\)/);
  assert.match(sourceOf(BUNDLE), /forms\.some\(\(form\) => narrowedByPolicy\(form, asked\)\)/);
  // Both belong to the screen — the paper cannot carry either.
  const notices = code.slice(
    code.indexOf('export function FormNotices'),
    code.indexOf('export function F027Sheet'),
  );
  assert.equal(
    (notices.match(/className="no-print"/g) || []).length,
    5,
    'every notice block above the sheet must be marked no-print',
  );
});

test('forty sheets raise one notice box, not forty — and it names its counts first', () => {
  // FormNotices is right for one sheet and wrong for forty: each person can
  // raise four blocks, so a department filled the screen above the preview it
  // was printed to look at — and none of those boxes could say how many
  // sheets were affected, because each knew only about its own page.
  const bundle = sourceOf(BUNDLE);
  assert.ok(!bundle.includes('FormNotices'), 'the bundle is back to one box per person');
  assert.match(bundle, /<NoticeDigest forms=\{forms \|\| \[\]\} asked=\{status\} \/>/);

  // Every kind the per-sheet block can raise is counted by the digest, or a
  // whole class of notice goes silent the moment there is more than one sheet.
  const kinds = bundle.slice(bundle.indexOf('const DIGEST_KINDS'), bundle.indexOf('const datesOf'));
  for (const key of ['pending', 'hidden', 'unmarked', 'acting']) {
    assert.match(kinds, new RegExp(`key: '${key}'`), `the digest drops ${key} on a bundle`);
  }

  // Counts always visible; names behind the toggle. `<details>` and not state:
  // the list is rebuilt whenever the month or สถานะที่นับ changes.
  assert.match(bundle, /<details className="notice-fold">\s*<summary>ดูรายละเอียด<\/summary>/);

  // And the box takes the loudest tone in it — an amber notice may not be
  // quietened to blue by being counted beside one.
  assert.match(bundle, /groups\.some\(\(\{ kind \}\) => kind\.level === 'warn'\) \? 'warn' : 'info'/);
});

test('the notice box is capped so it cannot push the sheets off the screen', () => {
  // The preview below it is what somebody came to this screen to look at.
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  const rule = css.slice(css.indexOf('.notice-digest {'), css.indexOf('.notice-digest > .alert'));
  assert.match(rule, /max-height: 120px/);
  assert.match(rule, /overflow-y: auto/);
  assert.match(sourceOf(BUNDLE), /className="no-print notice-digest"/);
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
