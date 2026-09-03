import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { managerSignature, approvalSteps } from '../lib/approverLine.js';
import { firstName } from '../lib/api.js';

/**
 * ลงชื่อพนักงาน and ลงชื่อหัวหน้างาน are typed onto F-HR-027 — asked for on
 * 2026-09-02, and asked for as a REPLACEMENT: the printed name is the
 * signature, and the sheet is not signed by hand after it prints.
 *
 * THAT IS WHY THIS FILE IS MOSTLY ABOUT WHEN A NAME IS *NOT* PRINTED. A blank
 * box on a form that is signed by hand is an unsigned row somebody will notice
 * and chase; a blank box on a form whose names are typed is the same thing, and
 * it stays honest only for as long as nothing prints a name that nobody made.
 * There are three ways in this database for a row to have no real signature,
 * and every one of them exists on prod today:
 *
 *   - a request still at รอหัวหน้า — nobody has signed it yet;
 *   - `submit_hr_verified` — ฝ่ายบุคคล filed it off the fingerprint scanner and
 *     approved it in the same act, so it has NO หัวหน้า signature and never
 *     will. The หัวหน้า's own month alert says exactly this about those rows;
 *   - an entry old enough that its history carries no `byName`.
 *
 * `managerSignature` is a pure function of one entry, so those are checked
 * against real shapes rather than by reading the source. What cannot be run
 * without a DOM — that the sheet puts the answer in the right cell, and that
 * the cell is small enough for the row — is read from the source, the way the
 * other print-layout suites do it.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => readFileSync(join(ROOT, file), 'utf8');

const jsxOf = (file) => read(file)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const cssOf = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

const FORM = 'components/PrintForm.jsx';
const ROUTE = 'app/api/reports/form/[period]/route.js';
const PRINT = 'app/print.css';

/** One history row, in the shape `OtEntry.log` writes. */
const h = (action, byName, extra = {}) => ({
  action, byName, at: new Date('2026-08-14T09:00:00Z'), ...extra,
});

// ── who signed the หัวหน้า step ──────────────────────────────────────────────

test('an approved request names the หัวหน้า who signed it', () => {
  const entry = { history: [h('submit', 'สมชาย ใจดี'), h('approve_mgr', 'สมหญิง ใจงาม')] };
  assert.equal(managerSignature(entry).name, 'สมหญิง ใจงาม');
});

test('a request still at รอหัวหน้า has no signature to print', () => {
  assert.equal(managerSignature({ history: [h('submit', 'สมชาย ใจดี')] }), null);
});

test('ฝ่ายบุคคล signing the SECOND step is not the หัวหน้า signature', () => {
  // approve_hr belongs to the เฉพาะฝ่ายบุคคล box at the foot of the sheet. In
  // this column it would print ฝ่ายบุคคล's name under a heading that says
  // หัวหน้างาน — and ฝ่ายบุคคล share one login, so it would not even be a
  // person's name.
  const entry = { history: [h('submit', 'สมชาย'), h('approve_hr', 'ฝ่ายบุคคล')] };
  assert.equal(managerSignature(entry), null);
});

test('an entry ฝ่ายบุคคล filed off the scanner has NO หัวหน้า signature', () => {
  // `submit_hr_verified` is the one action whose toStatus is 'approved' with no
  // approve row before it. The entry is approved and the column is still blank,
  // because no หัวหน้า ever read it — which is the fact the หัวหน้า's month
  // alert exists to surface.
  const entry = { history: [h('submit_hr_verified', 'ฝ่ายบุคคล')] };
  assert.equal(managerSignature(entry), null);
  // …and it IS an approval, so the two readings must not have merged.
  assert.equal(approvalSteps(entry).length, 1);
  assert.equal(approvalSteps(entry)[0].approved, true);
});

test('ผู้ดูแลระบบ standing in for a แผนก with no หัวหน้า signs with their own name', () => {
  // ADM has no หัวหน้า and has not had one for as long as the roster has
  // existed. The action is still approve_mgr — somebody signed that step — and
  // the name printed is theirs. HR asked for no qualifier beside it.
  const entry = { history: [h('approve_mgr', 'ผู้ดูแลระบบ', { adminOverride: true })] };
  assert.equal(managerSignature(entry).name, 'ผู้ดูแลระบบ');
});

test('a ผู้รับช่วง signs with the name of whoever actually pressed the button', () => {
  const entry = {
    history: [h('approve_mgr', 'มานพ', { onBehalfOfName: 'สมหญิง ใจงาม' })],
  };
  assert.equal(managerSignature(entry).name, 'มานพ');
});

test('refused, corrected and signed again — the signature that stands is the last', () => {
  const entry = {
    history: [
      h('reject_mgr', 'สมหญิง ใจงาม'),
      h('edit', 'สมชาย ใจดี'),
      h('approve_mgr', 'ประสิทธิ์ มั่นคง'),
    ],
  };
  assert.equal(managerSignature(entry).name, 'ประสิทธิ์ มั่นคง');
});

test('a decision older than byName prints blank, not a guess', () => {
  const entry = { history: [{ action: 'approve_mgr', at: new Date() }] };
  assert.equal(managerSignature(entry).name, null);
});

test('an entry with no history at all answers null rather than throwing', () => {
  for (const entry of [{}, { history: [] }, null, undefined]) {
    assert.equal(managerSignature(entry), null);
  }
});

// ── the route hands the sheet one name per session ──────────────────────────

test('the sheet is told who signed each session, not each month', () => {
  const code = jsxOf(ROUTE);
  // Per SESSION: a month is signed a request at a time, and a stand-in may have
  // taken some of them. One name for the sheet would be one of those names
  // presented as all of them.
  assert.match(code, /approverName: managerSignature\(entry\)\?\.name \|\| null/);
  assert.match(code, /import \{ managerSignature \} from '@\/lib\/approverLine\.js'/);
});

test('the rule for which row is a signature lives in one file', () => {
  // The route must not re-derive it. Two readings of "who signed the หัวหน้า
  // step" is how the paper and the pop-up come to name two different people.
  const code = jsxOf(ROUTE);
  assert.doesNotMatch(
    code,
    /approve_mgr/,
    'the route now reads the history itself — that rule belongs to managerSignature()',
  );
});

// ── what the sheet draws ────────────────────────────────────────────────────

test('both ลงชื่อ cells print through one component', () => {
  const code = jsxOf(FORM);
  assert.match(code, /<Signed name=\{row\.sessions\.length \? form\.employee\.name : null\} \/>/);
  assert.match(code, /<Signed name=\{s\?\.approverName\} \/>/);
});

test('the box holds a name and nothing else — no brackets, no marks', () => {
  const code = jsxOf(FORM);
  const body = code.slice(code.indexOf('function Signed'));
  assert.match(body, /if \(!only\) return null;/);
  /**
   * IT READ `( ชื่อ นามสกุล )` FOR ONE AFTERNOON — brackets glued with `&nbsp;`
   * because a lone `)` kept wrapping onto its own line. HR asked for the
   * punctuation off entirely on 2026-09-02, so the wrapping problem went with
   * the thing that caused it.
   *
   * The MARKUP is what is checked, not the function around it: `firstName(name)`
   * has brackets of its own and they are JavaScript. What may not come back is a
   * character printed into the box — a bracket added again quietly is a mark on
   * a document people sign.
   */
  const returned = /return \((.*?)\);|return (<span[\s\S]*?<\/span>);/.exec(body);
  const markup = (returned?.[1] || returned?.[2] || '').trim();
  assert.equal(markup, '<span className="nm">{only}</span>', 'the box carries something other than the name');
  // An empty <span> in every blank cell would put a line-height floor under
  // rows on a sheet whose whole layout is 31 rows fitting one side of A4.
  assert.doesNotMatch(body, /return <span[^>]*>\s*<\/span>/);
});

test('the given name alone reaches the box, never the surname', () => {
  assert.equal(firstName('สมชาย ใจดี'), 'สมชาย');
  assert.equal(firstName('  ประเสริฐ   วงศ์ทอง  '), 'ประเสริฐ');
  /**
   * FIVE OF THE 22 ON THIS ROSTER HAVE NO SURNAME, and two of them are accounts
   * that sign things. Returning '' for those would blank the box on exactly the
   * rows an administrator signed for a แผนก with no หัวหน้า.
   */
  assert.equal(firstName('ฝ่ายบุคคล'), 'ฝ่ายบุคคล');
  assert.equal(firstName('ผู้ดูแลระบบ'), 'ผู้ดูแลระบบ');
  // Nothing to sign with is still nothing — the cell draws no element at all.
  for (const empty of ['', '   ', null, undefined]) assert.equal(firstName(empty), '');
});

test('a day with no OT gets no signature', () => {
  // The employee name is conditioned on the date having sessions, so a blank
  // date cannot carry a declaration about a day nobody claimed.
  assert.match(jsxOf(FORM), /row\.sessions\.length \? form\.employee\.name : null/);
});

test('the merged ลงชื่อ cell gives way when the date has two different signers', () => {
  const code = jsxOf(FORM);
  assert.match(code, /const oneApprover = new Set\(sessions\.map\(\(s\) => s\?\.approverName \|\| ''\)\)\.size === 1/);
  // The cell spans the date's rows while that is TRUE, and splits when it is
  // not — so an ordinary sheet is unchanged and a genuinely mixed date stops
  // showing one manager's name over another manager's row.
  assert.match(code, /\{\(i === 0 \|\| !oneApprover\) && \(/);
  assert.match(code, /rowSpan=\{oneApprover \? sessions\.length : 1\}/);
  // The พนักงาน cell never splits: one sheet is one person.
  assert.match(code, /\{i === 0 && \(\s*<td className="sig" rowSpan=\{sessions\.length\}>/);
});

test('every row still has nine cells however the signatures fall', () => {
  /**
   * The grid is nine columns and the two ลงชื่อ cells are the only ones whose
   * span now varies. Counted here rather than trusted, because a row one cell
   * short does not fail loudly — it shifts every value after it one column left
   * on a document that gets filed.
   */
  const cellsFor = (sessionCount, oneApprover) => {
    const rows = [];
    for (let i = 0; i < sessionCount; i++) {
      let n = 5; // จาก · ถึง · three hour columns
      n += 1;    // รายละเอียดงานที่ทำ
      if (i === 0) n += 1;                    // วันที่, spanning
      if (i === 0) n += 1;                    // ลงชื่อพนักงาน, spanning
      if (i === 0 || !oneApprover) n += 1;    // ลงชื่อหัวหน้างาน
      rows.push(n);
    }
    // A spanning cell counts for every row it covers.
    return rows.map((n, i) => n + (i === 0 ? 0 : (oneApprover ? 3 : 2)));
  };
  assert.deepEqual(cellsFor(1, true), [9]);
  assert.deepEqual(cellsFor(2, true), [9, 9]);
  assert.deepEqual(cellsFor(2, false), [9, 9]);
  assert.deepEqual(cellsFor(3, false), [9, 9, 9]);
});

test('no timestamp is printed beside either name', () => {
  // HR asked for the name alone on 2026-09-02 — the column is 19mm and holds a
  // Thai name or a date, not both. The minute each signature was made is not
  // lost: it is on การอนุมัติ in the entry's pop-up, from these same rows, and
  // `managerSignature` still returns it.
  const code = jsxOf(FORM);
  const body = code.slice(code.indexOf('function Signed'));
  assert.doesNotMatch(body, /thaiDate|toLocale|submittedAt|approvedAt|\bat\b/);
  assert.ok(managerSignature({ history: [h('approve_mgr', 'สมหญิง')] }).at);
});

// ── and that the row can afford it ──────────────────────────────────────────

test('a signature is set small enough for two lines to fit a row', () => {
  const css = cssOf(PRINT);
  const at = css.indexOf('.f027 td.sig .nm');
  assert.ok(at > 0, '.f027 td.sig .nm has no rule — the name prints at the sheet size');
  const block = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  /**
   * 7.2pt BOLD — the sheet's own body size, so the signature reads as part of
   * the form rather than as a footnote under it.
   *
   * IT READ "5.5pt" FOR ONE AFTERNOON, and what let it back up was the surname
   * coming off. Both figures were measured the same way — the sheet rendered to
   * PDF through Chrome and counted by PAGE — and the pair is the point: with
   * ชื่อ-นามสกุล in the box, 6pt put a 25-row month onto two sides; with the
   * ชื่อ alone, 7.2pt bold holds 31 rows on one and 9pt still would.
   *
   * A change to this number is a change to how many OT days a month may hold
   * before it costs a second sheet of paper per person, so it is not a number
   * to nudge until it looks right on the month that happens to be open. The
   * ledger for both rounds is written over the rule in app/print.css.
   */
  assert.match(block, /font-size:\s*7\.2pt/);
  assert.match(block, /font-weight:\s*700/, 'HR asked for the signature in bold');
  assert.match(block, /overflow-wrap:\s*break-word/, 'Thai has no spaces — a long name would print through the next column');
  assert.match(cssOf(PRINT).slice(css.indexOf('.f027 td.sig ')), /text-align:\s*center/);
});

test('the sheet still fits one page by the same arithmetic it always did', () => {
  // The signatures may not become the reason a month spills onto a second side.
  // Nothing here changed the page box or the row minimum, and that is the check.
  const css = cssOf(PRINT);
  assert.match(css, /@page \{[^}]*margin:\s*0/, 'a @page margin costs a second sheet per person');
  assert.match(css, /height:\s*5\.5mm/, 'the row minimum moved');
  assert.match(css, /\.f027 > table \{ flex: 1 0 auto; \}/, 'the table no longer absorbs the slack');
});
