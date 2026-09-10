import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  overCeilingApproveHead, OVER_CEILING_REASON_APPROVE,
} from '../lib/caps.js';

/**
 * ยืนยันหลายคนจากหน้า ตรวจสอบประจำเดือน — THE DAY THIS SCREEN LEARNED TO SIGN.
 *
 * Asked for on 2026-09-10, in these words: *"เพิ่มปุ่มให้สามารถกดอนุมัติสำหรับ
 * คนที่ผลเทียบไม่ติดปัญหาได้เลย และสามารถเลือกอนุมัติได้หลายคนหลายรายการ …
 * เพื่อไม่ให้เสียเวลาสลับหน้าไปมา"*.
 *
 * ── THE THREE THINGS THAT MAKE THIS DIFFERENT FROM คิวรออนุมัติ ─────────────
 *
 * They look like the same feature and they are not, and every one of the
 * differences is a decision somebody made on purpose (the numbers are sections
 * of docs/plan-monthly-review-approve-inline.md, settled that day):
 *
 *   **§5.1 — ONE TICK IS A PERSON'S WHOLE MONTH.** That queue's tick is one ใบ;
 *   this screen is one row per person and the ask named the unit. It is a much
 *   heavier press, and it is paid for in two places that this file pins: the
 *   bar says BOTH units always (`3 คน · 17 ใบ`), and there is NO single-row
 *   fast path — the dialog opens even for one person, because "one person" here
 *   is six signatures.
 *
 *   **§5.2 — A FLAGGED ROW CANNOT BE TICKED AT ALL.** Not warned: `disabled`.
 *   It is `actionable`'s rule from that queue turned to a new purpose — *a row
 *   that breaks when pressed should not be tickable in the first place* — where
 *   "breaks" does not mean the server refuses it (it would take it) but that
 *   NOBODY HAS LOOKED YET, which is the one thing this screen was asked to stop.
 *   That is also why ก้อน B had to ship first: the only way through such a row
 *   is to open the person, and the row itself is now what opens.
 *
 *   **§5.4 — เลือกทั้งหมด CROSSES THE PAGER.** That queue's rule is the
 *   opposite (*ติ๊กอยู่ได้เท่าที่แถวยังอยู่บนจอ*) because its pager is a real
 *   filter. Here it is a phone-only CSS window over a list the desktop draws
 *   whole, and `CARD_PAGE` says so in capitals: **A PAGE IS NOT A FILTER**.
 *
 * ── AND ONE THING THAT DID NOT GO AS PLANNED ────────────────────────────────
 *
 * §5.5 said to LIFT `ConfirmModal` out of components/ApprovalQueue.jsx into
 * common.jsx and share it. That was reversed once both shapes were on the table
 * — see the header of components/MonthConfirm.jsx for the reasoning — because
 * the two dialogs are about different nouns: ใบ there, PEOPLE here, and this
 * screen has never held an entry to preview.
 *
 * What §5.5 was actually protecting is the ceiling WORDING, and the last test
 * in this file is that protection, made explicit: both dialogs read those
 * sentences out of lib/caps.js rather than keeping copies. That is a stronger
 * guarantee than sharing a component, because it survives either dialog being
 * restyled and would have caught the drift even inside the shared version.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const hrView = read('components/HrView.jsx');
const confirm = read('components/MonthConfirm.jsx');
const queue = read('components/ApprovalQueue.jsx');
const css = read('app/styles.css');
const printCss = read('app/print.css');
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));

// ── 0. the order of declarations, which is not a style question ─────────────

test('every derived value is declared after the one it reads', () => {
  /**
   * ── ⚠ THIS FILE'S ONLY TEST THAT IS ABOUT JAVASCRIPT AND NOT ABOUT OT ────
   *
   * It exists because the first draft of this round shipped a
   * `ReferenceError` to the browser — *Cannot access 'canPick' before
   * initialization* — and every other test in this suite passed.
   *
   * `showPickCol` was written beside `showScanCol`, which is where it belongs
   * BY SUBJECT: they are the two questions "is this column drawn". But it
   * reads `canPick`, `canPick` filters `shown`, and `shown` is built a hundred
   * lines further down. `const` is not hoisted the way a file's paragraph
   * headings read, so the component threw on its first paint.
   *
   * ── WHY NOTHING CAUGHT IT ────────────────────────────────────────────────
   *
   * Every assertion in this suite reads the SOURCE as text. That is the right
   * tool for "does this screen state the rule it is supposed to state", and it
   * is blind by construction to "does this file run". Nothing in this repo
   * renders a component, so a TDZ error is invisible to all 2569 of them.
   *
   * This is the cheapest guard that is not blind to it: the chain is short,
   * every link is named, and a link added in the wrong place fails here rather
   * than in front of HR. It is not a substitute for opening the app, and it
   * does not pretend to be — it is a substitute for opening the app TWICE.
   */
  const at = (decl) => {
    const i = hrView.indexOf(decl);
    assert.notEqual(i, -1, `HrView no longer declares: ${decl}`);
    return i;
  };

  // Each pair is [declared first, reads it]. Read down: the month's rows, then
  // who may be ticked out of them, then how wide that makes the table.
  const chain = [
    ['const flaggedBy = React.useMemo', 'const pickable = (row) =>'],
    ['const pickable = (row) =>', 'const shown = React.useMemo'],
    ['const shown = React.useMemo', 'const canPick = React.useMemo'],
    ['const canPick = React.useMemo', 'const chosen = React.useMemo'],
    ['const chosen = React.useMemo', 'const tally = React.useMemo'],
    // ⚠ THE ONE THAT ACTUALLY BROKE. `showPickCol` sits below `canPick` and
    // above nothing that would rather have it higher; the comment over it in
    // components/HrView.jsx says why it is not beside `showScanCol`.
    ['const canPick = React.useMemo', 'const showPickCol = mayCorrect'],
    ['const showPickCol = mayCorrect', 'const colCount = 10 +'],
  ];
  for (const [first, second] of chain) {
    assert.ok(
      at(first) < at(second),
      `\`${second}…\` reads something declared below it — that is a ReferenceError on first paint, not a style nit`,
    );
  }
});

// ── 1. who may be ticked ────────────────────────────────────────────────────

test('the tick rule is one function, and it asks the server’s answer first', () => {
  // `approvable.count` is `approvalPermission`'s verdict, computed per reader on
  // the route. §6 lives inside it and nothing here could reproduce it.
  assert.match(
    hrView,
    /const pickable = \(row\) => Boolean\(row\.approvable\?\.count\)\s*\n\s*&& !flaggedBy\.has\(String\(row\.employee\?\._id\)\);/,
  );
  // การเงิน and the three signers get `approvable: null` from the route, so
  // `Boolean(null?.count)` is false and they need no rule of their own here.
  assert.match(hrView, /const showPickCol = mayCorrect && canPick\.length > 0;/);
});

test('§5.2 — a row the scan comparison flagged is disabled, and says why', () => {
  assert.match(hrView, /disabled=\{!pickable\(row\)\}/);
  // ⚠ THE `title` IS NOT A COURTESY. A greyed box with no explanation is the
  // exact failure `actionable` was written to fix on the other screen: press,
  // nothing happens, no idea what to do instead. Each branch names the way
  // forward, and for a flagged row the way forward is the row, which opens.
  assert.match(hrView, /const whyNotPickable = \(row\) => \{/);
  assert.match(hrView, /กดที่แถวเพื่อเปิดดูรายละเอียดและยืนยันทีละใบ/);
  // …and the §6 case gets its own sentence rather than the generic one, because
  // "you signed this at the manager's step" is not something a reader can
  // deduce from a disabled box.
  assert.match(hrView, /คุณเป็นผู้เซ็นขั้นหัวหน้าไปแล้ว ต้องให้อีกคนเป็นผู้ตรวจ/);
});

test('§5.3 — a month with no scan file ticks normally', () => {
  // The comparison points at rows; it does not hold a gate. `flaggedBy` is
  // built from `scan.compare.people`, which is empty on a month with no import,
  // so `pickable` is unaffected — there is deliberately no `punchCount` term in
  // it. The card at the top is what says the month was never checked.
  const rule = hrView.slice(hrView.indexOf('const pickable = (row)'));
  assert.ok(!rule.slice(0, 200).includes('punchCount'), 'the comparison became a gate');
});

// ── 2. §5.4, and the two units ──────────────────────────────────────────────

test('§5.4 — เลือกทั้งหมด takes every row the FILTERS left, pager or not', () => {
  // `shown`, not the page slice. One button on two screen sizes has to mean one
  // thing, and the desktop draws every row anyway.
  assert.match(hrView, /const canPick = React\.useMemo\(\(\) => shown\.filter\(pickable\), \[shown, flaggedBy\]\);/);
  // The count is on the label, so a phone reader seeing five rows knows they
  // are about to tick twenty-four.
  assert.match(hrView, /`เลือกทั้งหมด \(\$\{canPick\.length\} คน\)`/);
  // The header box draws the third state honestly. React has no attribute for
  // it, hence the ref — a box that showed empty while three rows were ticked
  // would be the control lying about the state it controls.
  assert.match(hrView, /el\.indeterminate = chosen\.length > 0 && chosen\.length < canPick\.length;/);
});

test('§5.1 — both units are said everywhere a count appears', () => {
  // THE BAR, while ticking…
  assert.match(hrView, /เลือกไว้ <strong>\{tally\.persons\}<\/strong> คน/);
  assert.match(hrView, /<strong>\{tally\.entries\}<\/strong> รายการ/);
  // …THE DIALOG, before pressing — three boxes, and the button counts ใบ
  // because that is the unit that reaches payroll.
  assert.match(confirm, /<div className="k">พนักงาน<\/div>/);
  assert.match(confirm, /<div className="k">จำนวนรายการ<\/div>/);
  assert.match(confirm, /\{`ยืนยัน \$\{tally\.entries\} รายการ`\}/);
  // …and the resting bar, before anything is ticked at all, which is what tells
  // a reader of a report that this screen can now be signed from.
  assert.match(hrView, /ยืนยันได้ <strong>\{canPick\.length\}<\/strong> คน/);
  assert.match(hrView, /ติ๊กหนึ่งช่อง = ยืนยันรายการทั้งเดือนของคนนั้น/);
});

test('there is no single-row fast path — §5.1’s other half', () => {
  // คิวรออนุมัติ approves a clean single row without a dialog
  // (`else approve([e])`). Here one tick is a month, so the sheet that says how
  // many ใบ that is cannot be skipped.
  assert.match(hrView, /onClick=\{\(\) => setConfirming\(true\)\}/);
  const bar = hrView.slice(hrView.indexOf('<div className={`batch-bar'));
  assert.ok(!bar.slice(0, 2600).includes('signPicked('), 'the bar signs without a dialog');
  // …and the dialog will not draw over an empty selection, which is the moment
  // between clearing the ticks and the refetch landing.
  assert.match(hrView, /\{confirming && chosen\.length > 0 && \(/);
});

// ── 3. the batch itself ─────────────────────────────────────────────────────

test('one request per ใบ, and a row that fails is named by person', () => {
  // There is no bulk endpoint, and คิวรออนุมัติ's own note says why inventing
  // one is worse: a bulk call that half-succeeds beats no progress counter.
  assert.match(hrView, /await api\.post\(`\/entries\/\$\{id\}\/approve`, note \? \{ note \} : undefined\);/);
  assert.match(hrView, /กำลังยืนยัน \{progress\.done\} \/ \{progress\.total\} รายการ/);
  // ⚠ BY PERSON, NOT BY ใบ — that queue names the row because it is holding it.
  // This screen has an id and the person it belongs to and nothing else, and
  // inventing a date would mean fetching entries it was built not to fetch.
  assert.match(hrView, /ไม่สำเร็จ \$\{bad\} จาก \$\{row\.approvable\.count\} รายการ/);
  // One reason for the whole batch — one decision, one sentence.
  assert.match(hrView, /async function signPicked\(note\)/);
});

test('both readings of the month are re-asked afterwards', () => {
  // `load()` brings back totals, statuses and a fresh `approvable`.
  // `loadScan()` brings back the comparison — whose `entryCount` is counted over
  // สถานะที่นับ and therefore MOVED when these rows changed status. Leaving it
  // stale would put a card reading `7 ใบ` over a table holding a different seven.
  assert.match(hrView, /await load\(\);\s*\n\s*await loadScan\(\);/);
  assert.match(hrView, /setPicked\(new Set\(\)\);\s*\n\s*\/\*\*/);
});

test('a tick does not survive the row being replaced', () => {
  // All five rebuild `shown`. ⚠ `query` is in the list and the PAGER is not,
  // which is §5.4 written as code: a search narrows the month, a page is a
  // window onto it.
  assert.match(
    hrView,
    /useEffect\(\(\) => \{ setPicked\(new Set\(\)\); \}, \[period, statusFilter, dept, query, onlyFlagged\]\);/,
  );
});

// ── 4. the layout ───────────────────────────────────────────────────────────

test('the bar is drawn at both widths here, and on a phone it is the only way in', () => {
  // `.batch-bar { display: none }` in the phone block is คิวรออนุมัติ's rule:
  // down there it uses `.queue-mobile-bar` instead, and two toolbars on one
  // short screen is the duplication that rule prevents. This screen has no
  // second toolbar, and below 860px `thead` is gone — which takes the header
  // tick-box with it — so the bar is the only place เลือกทั้งหมด can live.
  assert.match(phone, /\.month-panel \.batch-bar \{\s*display: flex; position: static;/);
  assert.match(phone, /\.batch-bar \{ display: none; \}/, 'the queue rule went missing');
  // The tick column collapses when it is not drawn, so a month with nothing to
  // confirm is exactly the card it was before ticks existed.
  assert.match(phone, /grid-template-columns: auto minmax\(0, 1fr\) 108px;/);
  assert.match(phone, /\.hr-table tbody td\.check \{\s*grid-area: check;/);
  // รวมทั้งหมด keeps its empty cell on a desktop for alignment and drops it on
  // a phone, where the total row is a two-area grid with no `check` in it.
  assert.match(phone, /\.hr-table tbody tr\.total-row td\.check \{ display: none; \}/);
});

test('none of it reaches paper', () => {
  // `.check` and `.btn` are already in the print sheet's hide list, which is
  // what takes the boxes and the bar's buttons off a document going to payroll.
  assert.match(printCss, /\.box, \.alert, \.chip, \.hint, \.kicker-sm, \.seg, \.btn, \.check,/);
  // …and the bar itself carries `no-print` rather than relying on that list.
  assert.match(hrView, /className=\{`batch-bar no-print\$\{chosen\.length \? ' picking' : ''\}`\}/);
  assert.match(hrView, /<div className="batch-progress no-print">/);
});

// ── 5. §5.5, kept in the form that actually protects something ──────────────

test('both confirm dialogs read the ceiling wording from lib/caps.js', () => {
  // ⚠ THIS IS WHAT §5.5 WAS FOR. It asked for one shared component; what it was
  // protecting was one shared SENTENCE, and that is what is pinned. Neither
  // dialog may keep a copy or a paraphrase.
  for (const [name, src] of [['MonthConfirm', confirm], ['ApprovalQueue', queue]]) {
    assert.ok(
      /import \{[^}]*overCeilingApproveHead/s.test(src),
      `${name} stopped importing overCeilingApproveHead`,
    );
    assert.ok(src.includes('overCeilingApproveHead('), `${name} does not call it`);
  }
  // The head of one row IS the server's own refusal, so the screen and a 400
  // cannot read as two different rules.
  assert.equal(overCeilingApproveHead(1), OVER_CEILING_REASON_APPROVE);
  // And nothing in the new dialog spells a ceiling sentence out by hand.
  assert.ok(!confirm.includes('เกินเพดาน OT ที่กำหนด'), 'the wording was copied instead of imported');

  // The rows are NAMED, not counted: a reason is being demanded for exactly
  // them. คิวรออนุมัติ builds those lines in the browser from entries it holds;
  // this screen gets them from the route, which holds them instead.
  assert.match(confirm, /items=\{tally\.capped\}/);
  assert.match(confirm, /\{row\.name\} · \{thaiDate\(row\.date\)\} · \{row\.text\}/);
  // One textarea, one reason, for the same rule that queue states: one person
  // making one decision does not say the same thing twice.
  assert.equal((confirm.match(/<textarea/g) || []).length, 1);
  assert.match(confirm, /const ready = !mustExplain \|\| why\.trim\(\)\.length > 0;/);
});

test('the preview is people, which is the whole reason this dialog is its own', () => {
  // `EntryPeek` on คิวรออนุมัติ draws one line per ใบ. Here each line is a
  // person and their month — the line that makes §5.1 survivable, because a
  // reader who ticked four names can see which of them is carrying most of it.
  assert.match(confirm, /function PeoplePeek\(\{ people, collapsed \}\)/);
  assert.match(confirm, /\{row\.approvable\.count\} ใบ/);
  assert.match(confirm, /ดูรายชื่อทั้ง \$\{people\.length\} คน/);
  // It reuses `.peek-list`, so the two previews are the same object drawn with
  // different nouns rather than two lists that drifted apart.
  assert.match(confirm, /<ul className="peek-list">/);
  assert.match(queue, /<ul className="peek-list">/);
});
