import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ผลเทียบกับไฟล์สแกนนิ้วมือ — THE CARD, THE COLUMN, AND THE THREE STATES.
 *
 * ── WHAT WENT WRONG AND WHY THIS FILE EXISTS ────────────────────────────────
 *
 * The comparison shipped on 2026-09-07 inside components/ScanImport.jsx, which
 * was the right home for it right up until 2026-09-10, when that card was made
 * to fold shut on every visit. The fold was a good change for นำเข้าไฟล์ — a
 * deed done once a month — and it took the comparison down with it, which is
 * not a deed at all. It is the answer to *"is this month safe to sign"*, and a
 * screen that hides that answer behind two presses is a screen that does not
 * state it.
 *
 * So the two were split, and the three things below are what the split has to
 * keep true:
 *
 *   1. **The card is drawn above everything pressable**, not inside a fold.
 *   2. **A month with no scan file says so LOUDLY**, and does not look like a
 *      month that came back clean. These are opposite answers that a table with
 *      no marks on it renders identically, and it is the failure this whole
 *      round is guarding against.
 *   3. **The comparison is narrowed by the same three controls the table is.**
 *      A card reading `17 แถวต้องตรวจ` standing over a table narrowed to ผลิต3
 *      is two questions answered in one place with nothing saying so.
 *
 * ── AND ONE RULE THAT IS NOT ABOUT LAYOUT AT ALL ────────────────────────────
 *
 * Decided 2026-09-10 (docs/plan-monthly-review-approve-inline.md §5.3): a month
 * with no scan file is still a month that can be signed. lib/scanMatch.js says
 * of itself that it is *"a WARNING, not an arithmetic"* — it points at rows, it
 * does not hold a gate — and turning the comparison into a precondition would
 * promote it to a rule nobody asked for, and make a month whose file arrives
 * late a month that cannot be closed.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const card = read('components/ScanCompareCard.jsx');
const hrView = read('components/HrView.jsx');
const scanImport = read('components/ScanImport.jsx');
const scansRoute = read('app/api/scans/route.js');
const matchQuery = read('lib/scanMatchQuery.js');
const css = read('app/styles.css');
const printCss = read('app/print.css');
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));

// ── 1. one request, and the screen owns it ──────────────────────────────────

test('HrView asks for the scans; the import card is handed the answer', () => {
  // TWO CARDS ON ONE SCREEN READ ONE ANSWER. Left as it was, the summary would
  // ask on mount and the panel would ask again the moment somebody unfolded it
  // — two readings seconds apart, over a collection an import is writing to.
  // A card saying `17 แถวต้องตรวจ` above a panel saying something else is a
  // screen a reader cannot trust about either figure.
  assert.match(hrView, /const \[scan, setScan\] = useState\(null\);/);
  assert.match(hrView, /async function loadScan\(\)/);
  assert.ok(!scanImport.includes('api.get('), 'ScanImport is fetching the month again');

  // The panel reads them off the prop rather than out of state of its own.
  assert.match(scanImport, /const batches = scan\?\.batches \?\? null;/);
  assert.match(scanImport, /const punchCount = scan\?\.punchCount \?\? null;/);
  assert.match(scanImport, /scan = null,/);

  // An import moves no figure in the table — a punch is not an hour — so there
  // is no `load()`. What it DOES move is the comparison, and that is the whole
  // of what `onImported` re-reads.
  assert.match(scanImport, /onImported\?\.\(\);/);
  assert.match(hrView, /<ScanImport period=\{period\} scan=\{scan\} onImported=\{loadScan\} \/>/);
});

test('the expensive half is asked for only when there is something to compare', () => {
  // `punchCount` is on the cheap half. Paying for the comparison to be told all
  // zeroes is what the two-step ask avoids — the reasoning is ScanImport's own,
  // moved here with the request.
  assert.match(hrView, /const first = await api\.get\(base\);/);
  assert.match(hrView, /first\.punchCount\s*\?\s*await api\.get\(`\$\{base\}&compare=1/);
});

// ── 2. the same three narrowings as the table ───────────────────────────────

test('the comparison is counted over the month the table is showing', () => {
  // ประจำเดือน and สถานะที่นับ were always forwarded. `department` arrived with
  // this round and closes the last gap in the rule the แผนก filter states about
  // itself: every figure on this screen is that department's.
  assert.match(hrView, /const base = `\/scans\?period=\$\{period\}\$\{deptParam\}`;/);
  assert.match(hrView, /status=\$\{encodeURIComponent\(statusFilter\)\}/);
  assert.match(hrView, /\}, \[period, statusFilter, dept, scope, readsScans\]\);/);

  // …and the route honours it through the one function that decides this for
  // every monthly document, rather than reading `q.department` raw. That
  // function refuses a แผนก that cannot exist (`{ $in: [] }`), which a raw
  // string does not.
  assert.match(scansRoute, /import \{ reportStatuses, departmentScope \} from '@\/lib\/reports\.js';/);
  assert.match(scansRoute, /department: departmentScope\(user, q\)\.department,/);
  assert.match(matchQuery, /export async function compareMonthAgainstScans\(\{ period, statuses, department = null \}\)/);
  assert.match(matchQuery, /if \(department\) filter\.department = department;/);
});

test('a stale month never sits under a heading that has moved on', () => {
  // August's comparison left on screen under a September heading is the mistake
  // the import card's own month-change effect was written to prevent, arriving
  // through a different door.
  assert.match(hrView, /setScan\(null\);\s*\n\s*loadScan\(\);/);
  // …and the card draws NOTHING while the answer is in flight, so the gap is
  // not a flash of ยังไม่ได้เทียบ on a month that is fine.
  assert.match(card, /if \(loading\) return null;/);
});

// ── 3. who may see it at all ────────────────────────────────────────────────

test('the punch log is ฝ่ายบุคคล’s, on the screen as well as at the route', () => {
  // A record of when people were at the door is a different fact about a person
  // from the OT they filed. การเงิน read every แผนก's month and a หัวหน้า reads
  // their own team's; neither is offered this, whatever their บทบาท.
  assert.match(hrView, /const readsScans = mayCorrect && scope !== 'team';/);
  assert.match(hrView, /if \(!readsScans\) return;/);
  assert.match(hrView, /\{readsScans && \(\s*<ScanCompareCard/);
  assert.match(scansRoute, /requireRole\(user, 'admin', 'hr'\);/);
});

// ── 4. the three states, and the loud one ───────────────────────────────────

test('a month with no scan file says so, and does not look like a clean month', () => {
  // ⚠ THE WHOLE POINT OF THE CARD. "No marks on any row" is what both states
  // look like from the table, and one of them means the month reconciles while
  // the other means nobody has imported the file. Only this sentence separates
  // them.
  assert.match(card, /if \(!punchCount\) \{/);
  assert.match(card, /<strong>ยังไม่ได้เทียบกับไฟล์สแกนนิ้วมือ<\/strong>/);
  // The one clause that could not be cut when the block became a row: it is the
  // misreading the card exists to prevent, and the only part of the sentence
  // that is not a restatement of the headline.
  assert.match(card, /<strong>ไม่ได้แปลว่าทุกแถวตรง<\/strong>/);

  /* ⚠ IT WAS FOUR LINES AND A 16px HEADLINE UNTIL 2026-09-11 — this asserted
     `<div className="scan-none">…` and `.scan-none { font: 600 16px/1.35 … }`.
     Asked for in three words: *"ปรับอีกครับ กระชับให้เป็นแถวเดียว"*.

     THE REQUIREMENT DID NOT CHANGE, only what satisfies it. The size was picked
     while this card floated on the page as a block of its own; inside
     `.month-notices` it is one line among งวด…ยังเปิดอยู่ and MonthAlerts, and a
     16px shout there is not louder than its neighbours — it is a different size
     from them, which reads as the thing that does not belong. What separates the
     two states is that the sentence is drawn at all, in bold, beside the button
     that fixes it. */
  assert.ok(!/className="scan-none"/.test(card), 'the headline block came back');
  // ⚠ ANCHORED AT THE START OF A LINE. Both dead rules are quoted in the notes
  // that explain them — in this file and in the stylesheet — and an unanchored
  // match finds the explanation instead of the code. AGENTS.md counts five of
  // those. `.chip.scan-none` further down the stylesheet is a different thing
  // and is deliberately not matched by this.
  assert.ok(!/^\s*\.scan-none \{/m.test(css), 'a bare .scan-none rule came back');
  assert.match(card, /<div className="scan-line">/);
  assert.match(css, /^\.scan-line \{\r?\n  display: flex; align-items: center; justify-content: space-between;/m);
  // The button never shrinks under its own label on a wide screen, and takes a
  // 44px line of its own below 640px rather than being squeezed beside a wrapped
  // sentence.
  assert.match(css, /^\.scan-line \.btn \{ flex: none; \}/m);
  const narrow = css.slice(css.indexOf('@media (max-width: 640px) {', css.indexOf('.scan-line {')));
  assert.match(narrow.slice(0, narrow.indexOf('\n}')), /\.scan-line \.btn \{ flex: 1 1 100%; min-height: 44px; \}/);

  // AND IT DOES NOT BLOCK ANYTHING — §5.3. The comparison points at rows; it
  // does not hold a gate. A month whose file arrives late is not a month that
  // may not be signed, and the card says so rather than leaving a reader to
  // discover it by finding the controls still work.
  //
  // ⚠ IN FOUR WORDS SINCE 2026-09-11, and this asserted the full sentence
  // (`การเทียบสแกนเป็นการชี้ให้ดู ไม่ใช่เงื่อนไขการอนุมัติ`). The RULE is what is
  // pinned, not the doctrine behind it: what a reader needs from that clause is
  // permission, and `ยืนยันได้ตามปกติ` is the permission.
  assert.match(card, /ยืนยันได้ตามปกติ/);

  // One press from the sentence to the thing that answers it.
  assert.match(hrView, /onOpenImport=\{\(\) => setScanOpen\(true\)\}/);
});

test('the tally is HR’s own words, and the facts are told apart from the errands', () => {
  // The four badges are read from `SCAN_BADGE` rather than written out, so the
  // card and the row chip cannot come to name one finding two ways.
  assert.match(card, /import \{ SCAN_BADGE \} from '@\/lib\/scanMatch\.js';/);
  for (const key of ['SHORT', 'START_OFF', 'NO_SCAN', 'OVER']) {
    assert.ok(card.includes(`SCAN_BADGE.${key}`), `the card stopped reading SCAN_BADGE.${key}`);
  }

  // ไม่ครบ AND เวลาเริ่มไม่ตรง ARE PRINTED APART. `mismatch` holds both, and a
  // card printing `2 แถวไม่ครบ` over one of each names the pile after half of
  // itself — a mistake this comparison has already made once and paid for.
  assert.match(card, /counts\.short/);
  assert.match(card, /counts\.startOff/);

  // เกินเวลา · เหมารายวัน · ตรง are facts, counted outside the pile that needs a
  // person (*ข้อเท็จจริง ป้ายเทา ไม่นับกองที่ต้องตรวจ*, 2026-09-07). Said in
  // grey AND in words, because a colour is not a sentence.
  assert.match(card, /className="quiet"/);
  assert.match(css, /\.scan-tally \.quiet \{ color: var\(--muted\); \}/);
  assert.match(card, /เป็นข้อเท็จจริง/);
  assert.match(card, /ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน/);
});

// ── 5. the column on the row ────────────────────────────────────────────────

test('คอลัมน์สแกน is drawn only on a month that has a file behind it', () => {
  // Sixty cells of `—` read as sixty people the machine disagrees with, or as
  // sixty rows nobody checked, and a reader cannot tell which. The card says
  // the true thing once instead and the table stays out of it.
  assert.match(hrView, /const showScanCol = readsScans && Boolean\(scan\?\.punchCount\);/);
  assert.match(hrView, /\{showScanCol && <th className="scan-col">สแกน<\/th>\}/);
  assert.match(hrView, /\{showScanCol && \(\s*<td className="scan-col">/);

  // ⚠ TWO OPTIONAL COLUMNS SINCE THE TICK-BOXES LANDED, so the count is a sum
  // rather than a ternary — ten, eleven or twelve. `padCols` deliberately does
  // NOT follow it: รวมทั้งหมด draws its own empty `.check` cell, so the pad
  // covers only the tail after รวม ชม. and `colCount - 6` would double-count.
  assert.match(hrView, /const colCount = 10 \+ \(showScanCol \? 1 : 0\) \+ \(showPickCol \? 1 : 0\);/);
  assert.match(hrView, /const padCols = showScanCol \? 5 : 4;/);
  assert.ok(!hrView.includes('colSpan={10}'), 'a full-width row still assumes ten columns');
});

test('a row the machine agrees with says so — green, and never left blank', () => {
  // `flaggedBy` holds ONLY the people with something to look at, so absence has
  // to be spoken. On a month that WAS compared, a blank cell is
  // indistinguishable from a month that was not — and those are opposite
  // answers, which is the same trap the card's own first state is about.
  assert.match(hrView, /return <span className="scan-ok">ตรง<\/span>;/);

  // ── ⚠ RED AND GREEN, AND IT WAS AMBER AND GREY FOR A FEW HOURS ──────────
  //
  // The first version drew `ตรง` in `--muted-2` and the flag in `--amber-ink`,
  // arguing that the comparison is a WARNING and should not shout. Reported
  // the same day — *"ที่ติดปัญหาควรเป็นสีแดง ที่ไม่ผ่านควรเป็นสีเขียว"* — and
  // the argument was about the wrong thing: what the comparison may not do is
  // move an hour, and a colour does not. What this column IS, is a verdict per
  // row, and a verdict read down sixty rows has two useful states. Two dim inks
  // make the reader compare them to find out which is which.
  //
  // The app's OWN pair, the two the approve and refuse controls wear
  // everywhere else — not a red and a green chosen for this column.
  assert.match(css, /\.hr-table td\.scan-col \.scan-ok \{[^}]*color: var\(--green-dark\); \}/);
  assert.match(css, /\.hr-table td\.scan-col \.scan-flag \.n \{[\s\S]{0,80}?color: var\(--reject-ink\);/);

  // The flagged cell carries the two counts `groupScanChecksByPerson` keeps,
  // in the words the card used before it became a filter.
  assert.match(hrView, /เวลาไม่ตรง \{flag\.mismatch\}/);
  assert.match(hrView, /ไม่มีสแกน \{flag\.noScan\}/);

  // ใบเหมารายวัน is NOT on this cell: `groupScanChecksByPerson` has already
  // dropped the people whose only marked rows are flat days. A flat day is a
  // fact, not an errand.
  assert.ok(!hrView.includes('flag.flatDaily'), 'flat days are back in the errand column');
});

test('the phone card shows the warning too, and the paper shows none of it', () => {
  // ⚠ IT IS NOT IN THE HIDDEN-BY-NAME LIST, and it is the first column added to
  // this table in a long while that is not. The five hidden there are figures
  // the card repeats elsewhere or can do without; this is a WARNING, and one
  // that appears on a desktop but not on a phone is a warning half the readers
  // never see.
  const hidden = phone.slice(phone.indexOf('.hr-table tbody td.dept-col,'));
  assert.ok(!hidden.slice(0, 400).includes('td.scan-col'), 'the warning is hidden on a phone');
  // The tick sits BESIDE the name — it is a handle on the person, not a fourth
  // fact about them — and `scan` still takes a full row of its own.
  assert.match(phone, /grid-template-areas:\s+'check who cap'\s+'scan {2}scan scan'\s+'act {3}act {2}act';/);
  assert.match(phone, /\.hr-table tbody td\.scan-col \{\s*grid-area: scan;/);

  // ON PAPER IT IS GONE. Nothing in that column moves an hour, a bucket or a
  // ceiling — lib/scanMatch.js is a warning, not an arithmetic — so it has no
  // business on a document that goes to payroll, where a `เวลาไม่ตรง 2` beside
  // a figure invites a reader to believe the figure was adjusted for it.
  assert.match(printCss, /\.hr-table th\.scan-col, \.hr-table td\.scan-col \{ display: none; \}/);
});

// ── 6. the filter the card owns ─────────────────────────────────────────────

test('ดูเฉพาะคนที่ต้องตรวจ narrows the table, and ล้างตัวกรอง lets it go', () => {
  // It is on the CARD and not in `.queue-tools` because what it narrows by
  // exists only while a comparison does, and a control that vanishes out of a
  // bar of four is a bar that changes shape by itself.
  assert.match(card, /onToggleFlagged && flagged > 0/);
  assert.match(card, /ดูเฉพาะคนที่ต้องตรวจ \(\$\{flagged\} คน\)/);
  assert.match(card, /aria-pressed=\{onlyFlagged\}/);

  // ⚠ AND THAT IS PAID FOR HERE. A filter that hides rows while the filter bar
  // shows nothing amiss is how somebody comes to believe this month has eleven
  // employees in it. Decided 2026-09-10, plan §5.7.
  assert.match(hrView, /\{\(find \|\| dept \|\| onlyFlagged \|\| statusFilter !== DEFAULT_STATUS\) && \(/);
  assert.match(hrView, /setOnlyFlagged\(false\);\s*\n\s*\}\}/);

  // A screen filter, applied after ค้นหา over a month already fetched — so it
  // moves no total and costs no request, exactly like the search box.
  assert.match(hrView, /return matched\.filter\(\(row\) => flaggedBy\.has\(String\(row\.employee\?\._id\)\)\);/);
});
