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
  // The signature gained `notImported` on 2026-09-11 and wrapped onto two lines
  // with it; `department` is still the argument this test is about.
  assert.match(matchQuery, /export async function compareMonthAgainstScans\(\{\s+period, statuses, department = null, notImported = \[\],\s+\}\)/);
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

test('ปุ่ม นำเข้าไฟล์สแกน ไม่ซ้ำกับลิ้นชักที่เปิดอยู่แล้ว', () => {
  /*
   * 11 ก.ย. 2569 — *"ปุ่มนำเข้าไฟล์สแกน ซ้ำซ้อนหลายที่เยอะจัง"*, over a screenshot
   * with three of them stacked inside 150px: `ไฟล์สแกน ▲` on the card head,
   * `นำเข้าไฟล์สแกน` in this card's blue row, and the drawer's own
   * `นำเข้าไฟล์สแกน (.txt)`. Only the last opens a file dialog; the other
   * two open a drawer — and in that screenshot the drawer was already open, so
   * two of the three did nothing at all when pressed.
   *
   * THE FIX IS NOT FEWER DOORS, IT IS NO DOOR ONTO A ROOM YOU ARE STANDING IN.
   * While the drawer is open this card's state 1 draws nothing (the drawer says
   * `นำเข้าแล้ว 0 จาก 4 ไฟล์` one line below, with the picker beside it) and
   * the ยังไม่ได้นำเข้าของบริษัท… row keeps its sentence and loses its
   * button. Shut, both are back: one press from the problem to the thing that
   * answers it, which is what the block above `onOpenImport` is for.
   */
  assert.match(hrView, /importOpen=\{scanOpen\}/);
  assert.match(card, /importOpen = false,/);
  assert.match(card, /if \(importOpen\) return null;/);
  assert.match(card, /\{onOpenImport && !importOpen && \(/);
  // ชิปบนหัวการ์ดยังอยู่ — มันคือทางเข้าที่มีทุกสถานะ รวมถึงเดือนที่ทุกแถวตรง
  // และเป็นทางเดียวที่ ปิด ลิ้นชักได้
  assert.match(hrView, /className="btn ghost sm scan-toggle"/);
  assert.match(hrView, /onClick=\{\(\) => setScanOpen\(\(v\) => !v\)\}/);
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

test('คอลัมน์สแกน is drawn as soon as this screen knows about the month’s files', () => {
  /* ⚠ IT READ `Boolean(scan?.punchCount)` — "drawn only on a month that has a
     file behind it" — UNTIL 2026-09-11, on this argument: *sixty cells of `—`
     read as sixty people the machine disagrees with, or as sixty rows nobody
     checked, and a reader cannot tell which; the card says the true thing once
     instead and the table stays out of it.*

     THAT ARGUMENT IS ABOUT A COLUMN OF `—` AND IT IS STILL RIGHT. What changed
     is that the cell no longer draws one: *"หากรายการไหนยังไม่ได้นำเข้าไฟล์สแกน
     เวลา ให้แสดงข้อความตรงคอลัมน์ สแกน ว่า ยังไม่นำเข้า เป็นสีเทา"*. `ยังไม่นำเข้า`
     IS the sentence that resolves the ambiguity the blank created, printed where
     the reader is looking instead of only in the notice above the table.

     `slots` AND NOT `punchCount`: the four-slot grid comes back for any named
     งวด, so it is present the moment the first request lands and absent only
     while it is in flight or after it failed — the two states where the column
     would be a claim this screen cannot back. */
  assert.match(hrView, /const showScanCol = readsScans && Boolean\(scan\?\.slots\);/);
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

test('a month with no file says รอนำเข้า on every row, in grey', () => {
  // Asked for on 2026-09-11 with the table in the picture: *"…ให้แสดงข้อความ
  // ตรงคอลัมน์ สแกน ว่า ยังไม่นำเข้า เป็นสีเทา เหมือนคำว่า ไม่ตรง"* — and the
  // word became `รอนำเข้า` later the same day: *"เปลี่ยนคำว่า ยังไม่นำเข้า เป็น
  // คำว่า รอนำเข้า ทั้งหมด"*.
  assert.match(hrView, /if \(!scan\.punchCount\) \{/);
  assert.match(hrView, /<span\s+className="chip scan-wait"/);
  assert.match(hrView, /รอนำเข้า/);
  assert.ok(!hrView.includes('>ยังไม่นำเข้า'), 'คำเก่ายังถูกวาดอยู่บนจอ');

  // ⚠ GREY IS THE STATEMENT, NOT THE STYLING. `ตรง` is green because the machine
  // agreed and `เวลาไม่ตรง` is red because it did not; this row has had no
  // verdict at all, and a third colour ON that scale would place it between
  // agreeing and disagreeing — the one thing it is not. `--muted` on
  // `--neutral-wash` is `.chip.scan-none` exactly — the grey `ไม่ตรง` this
  // column was asked to look like — one level down.
  assert.match(css, /\.hr-table td\.scan-col \.scan-wait \{ background: var\(--neutral-wash\); color: var\(--muted\); \}/);
  const chip = css.slice(css.indexOf('.chip.scan-none {'));
  assert.match(chip.slice(0, chip.indexOf('}')), /background: var\(--neutral-wash\); color: var\(--muted\)/);

  // ⚠ AND IT CHANGES NOTHING DOWNSTREAM. `loadScan` does not ask for the
  // comparison at all without punches, so `flaggedBy` is empty by construction
  // on exactly the month this branch draws — §5.2's tick rule, the
  // ดูเฉพาะคนที่ต้องตรวจ filter and the card's counts all behave as they did
  // before the branch existed, and §5.3 still holds: this month ticks normally.
  assert.match(hrView, /const full = first\.punchCount\s+\? await api\.get\(`\$\{base\}&compare=1/);
  assert.match(hrView, /const pickable = \(row\) => Boolean\(row\.approvable\?\.count\)\s+&& !flaggedBy\.has\(String\(row\.employee\?\._id\)\);/);
});

/**
 * ── เดือนที่นำเข้าบางส่วน — 11 ก.ย. 2569 ────────────────────────────────────
 *
 * งวดหนึ่งต้องมีสี่ไฟล์ และมันมาไม่พร้อมกัน วันที่ไฟล์ ไพรมัส เข้าแต่ เดมเทค ยังไม่เข้า
 * เดือนนั้นมี punch แล้ว ผลเทียบจึงเดิน — และแถวของ เดมเทค ทุกแถวถูกเทียบกับ
 * "ไม่มีอะไรเลย" แล้วกลับมาเป็น `ไม่มีสแกน` สีแดง ซึ่งอ่านออกมาว่า *คนนี้ไม่ได้
 * สแกนนิ้ว* ทั้งที่ความจริงคือ *ไม่มีใครนำเข้าเครื่องของเขา* — พนักงานทั้งบริษัท
 * ถูกทำเครื่องหมายว่าขาดงาน และถูกห้ามติ๊กยืนยันเพราะเรื่องนั้น
 *
 * สั่งแก้ด้วยประโยคเดียว: *"ทำให้แถวคนเดมเทคขึ้นเทา ยังไม่นำเข้า และติ๊กได้ตามปกติ
 * เหมือนกรณีไม่มีไฟล์เลย"* — คือยก §5.3 จากระดับเดือนลงมาเป็นระดับบริษัท
 * (docs/plan-monthly-partial-scan-import.md)
 */
test('บริษัทที่ไฟล์ยังไม่มา ถูกตัดออกก่อนเทียบ ไม่ใช่เทียบแล้วค่อยเปลี่ยนป้าย', () => {
  // ตัดที่ต้นทาง เพราะทุกผลที่ตามมาหล่นออกมาเองโดยไม่ต้องเขียนกฎเพิ่ม: คนเหล่านั้น
  // ไม่โผล่ใน `people` → ไม่อยู่ใน `flaggedBy` → §5.2 ปล่อยให้ติ๊กได้เอง
  assert.match(matchQuery, /const skip = new Set\(notImported\);/);
  assert.match(matchQuery, /skip\.has\(e\.employee\.company\)/);
  // และ `company` ต้องถูกดึงมาด้วย ไม่งั้นการตัดจะเงียบและไม่ตัดอะไรเลย
  assert.match(matchQuery, /select: 'code name company'/);

  // ⚠ ต้องตัด **ก่อน** `scanChecksFor` ไม่ใช่หลัง — ถ้าตัดหลัง `counts` จะยังนับ
  // กอง `ไม่มีสแกน` ที่ไม่มีใครทำอะไรกับมันได้ เข้าเป็นกองที่ต้องตรวจของเดือน
  assert.ok(
    matchQuery.indexOf('const skip = new Set(notImported);')
      < matchQuery.indexOf('await scanChecksFor(entries)'),
    'ตัดหลังเทียบ = ตัวเลขบนการ์ดยังโกหกอยู่',
  );

  // เราต์ส่งลิสต์เดียวกับที่การ์ดสี่ช่องใช้ ไม่ใช่คำนวณใหม่รอบสอง
  assert.match(scansRoute, /notImported: grid\?\.notImported \|\| \[\],/);
});

test('แถวของบริษัทนั้นขึ้นเทา ยังไม่นำเข้า — และคำตัดสินมาจากเซิร์ฟเวอร์ที่เดียว', () => {
  /* ⚠ อ่านจากผลเทียบ ไม่ใช่คำนวณเองจาก `slots` ที่อยู่ในมือ
     เซิร์ฟเวอร์ใช้ลิสต์เดียวกันนี้ตัดสินไปแล้วว่าใครติดธง วันที่สองฝั่งไม่ตรงกันคือ
     วันที่แถวหนึ่งขึ้น `ยังไม่นำเข้า` พร้อมกับถูกห้ามติ๊กเพราะติดธง — ขัดกันเอง
     บนแถวเดียว */
  assert.match(hrView, /new Set\(scan\?\.compare\?\.notImported \|\| \[\]\)/);
  // ⚠ ตัดเอาเฉพาะ **ตัวโค้ด** ของ memo มาดู คอมเมนต์เหนือมันพูดถึง `scan.slots`
  // อยู่เต็ม ๆ เพราะนั่นคือทางที่จงใจไม่เดิน — เทสต์ที่กวาดทั้งย่อหน้าจะไปเจอ
  // คำอธิบายแทนที่จะเจอโค้ด
  const memo = hrView.slice(hrView.indexOf('const notImported = React.useMemo('));
  assert.ok(
    !memo.slice(0, memo.indexOf('[scan],')).includes('slots'),
    'จอคำนวณเองจาก slots = ความเห็นที่สองเรื่องเดียวกัน',
  );

  // ป้ายเดียวกับกรณีไม่มีไฟล์ทั้งเดือน — เป็นประโยคเดียวกันคนละมาตราส่วน
  assert.match(hrView, /if \(notImported\.has\(row\.employee\?\.company\)\) \{/);
  // และบอกชื่อบริษัทใน title เพราะบนจอมีทั้งสองบริษัทปนกันอยู่ในตารางเดียว
  assert.match(hrView, /ยังไม่ได้นำเข้าไฟล์สแกนนิ้วมือของ \$\{companyLabel\(row\.employee\.company\)\}/);

  // ลำดับของกิ่งคือคำพูด: ทั้งเดือน → ทั้งบริษัท → คำตัดสินรายคน
  const whole = hrView.indexOf('if (!scan.punchCount) {');
  const company = hrView.indexOf('if (notImported.has(row.employee?.company)) {');
  const verdict = hrView.indexOf('const flag = flaggedBy.get(');
  assert.ok(whole < company && company < verdict, 'กิ่งเรียงผิด — แถวจะได้คำตัดสินก่อนถูกถามว่ามีไฟล์ไหม');

  // ⚠ กฎติ๊กไม่ได้ถูกแตะเลย และนั่นคือหลักฐานว่าการตัดอยู่ถูกที่: §5.2 ไม่รู้จัก
  // คำว่าบริษัท และไม่ต้องรู้จัก
  assert.match(hrView, /const pickable = \(row\) => Boolean\(row\.approvable\?\.count\)\s+&& !flaggedBy\.has\(String\(row\.employee\?\._id\)\);/);
  assert.ok(!/pickable[\s\S]{0,200}notImported/.test(hrView), 'กฎติ๊กไปรู้เรื่องบริษัทเข้าแล้ว');
});

test('การ์ดผลเทียบต้องบอกว่าตัวเลขของมันไม่ได้พูดถึงใคร', () => {
  /* ราคาของการตัดคือการ์ดต้องพูดว่ามันตัดอะไรไป · `✓ ทุกแถวที่เทียบได้ตรงกับ
     ไฟล์สแกน` ทับอยู่บนเดือนที่อีกบริษัทไม่ได้ถูกอ่านเลย คือการอ่านผิดแบบเดียวกับ
     ที่การ์ดใบนี้มีไว้กันตั้งแต่แรก เพียงแต่กว้างเท่าบริษัทแทนที่จะเท่าเดือน */
  assert.match(card, /const notImported = compare\?\.notImported \|\| \[\];/);
  assert.match(card, /notImported\.map\(companyLabel\)\.join\(' และ '\)/);
  assert.match(card, /ยังไม่ได้นำเข้าไฟล์สแกนของ/);
  assert.match(card, /ไม่ได้นับอยู่ในตัวเลขข้างล่าง/);

  // §5.3 พูดด้วยคำเดิมที่สถานะ 1 ใช้ — ไม่ใช่ประตู แต่เป็นงานที่ยังไม่เสร็จ
  const line = card.slice(card.indexOf('notImported.length > 0 &&'));
  assert.match(line.slice(0, line.indexOf('</div>')), /ยืนยันได้ตามปกติ/);

  // เหนือรายการตัวเลข ไม่ใช่ใต้ — คนอ่านต้องรู้ขอบเขตก่อนอ่านตัวเลข
  assert.ok(
    card.indexOf('notImported.length > 0 &&') < card.indexOf('<div className="scan-tally">'),
    'คำเตือนอยู่ใต้ตัวเลขที่มันกำกับ',
  );
});

test('a row the machine agrees with says so — green, and never left blank', () => {
  // `flaggedBy` holds ONLY the people with something to look at, so absence has
  // to be spoken. On a month that WAS compared, a blank cell is
  // indistinguishable from a month that was not — and those are opposite
  // answers, which is the same trap the card's own first state is about.
  assert.match(hrView, /return <span className="chip scan-ok">ตรง<\/span>;/);

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

test('ทั้งสามสถานะเป็นป้ายมีพื้นหลัง และยืมทรงมาจาก .chip ไม่ได้วัดเอง', () => {
  /* *"ทุกสถานะในคอลัมน์ สแกน ให้เป็นรูปแบบป้ายมีพื้นหลัง เหมือนหน้า รออนุมัติ OT"*
     (11 ก.ย. 2569) · หน้านั้นวาดป้ายด้วย `StatusChip` ซึ่งก็คือ `.chip` ตัวเดียว
     กับที่ทุกป้ายในแอปใส่ */
  assert.match(hrView, /<span className="chip scan-ok">ตรง<\/span>/);
  assert.match(hrView, /<span className="chip n">เวลาไม่ตรง \{flag\.mismatch\}<\/span>/);
  assert.match(hrView, /<span className="chip n">ไม่มีสแกน \{flag\.noScan\}<\/span>/);
  assert.match(hrView, /className="chip scan-wait"/);

  /* ⚠ แต่ละกฎในคอลัมน์นี้บอก **สองสีเท่านั้น** ทรงของเม็ดยา — padding, มุม 20px,
     600/11.5 และเลขความกว้างเท่ากัน — อยู่ที่ `.chip` ที่เดียว การวัดเม็ดยาซ้ำ
     ตรงนี้คือวิธีที่เม็ดยาหนึ่งกลายเป็นสองแบบที่ค่อย ๆ ไม่เหมือนกัน */
  for (const cls of ['.scan-ok', '.scan-flag .n', '.scan-wait']) {
    const at = css.indexOf(`.hr-table td.scan-col ${cls} {`);
    assert.ok(at > 0, `หากฎของ ${cls} ไม่เจอ`);
    const body = css.slice(at, css.indexOf('}', at));
    assert.ok(!body.includes('font:'), `${cls} วัดตัวอักษรเอง แทนที่จะรับจาก .chip`);
    assert.ok(!body.includes('padding'), `${cls} วัดระยะขอบเอง`);
    assert.ok(!body.includes('border-radius'), `${cls} วัดมุมเอง`);
    assert.match(body, /background: var\(--/, `${cls} ไม่มีพื้นหลัง`);
  }

  // ทรงที่ยืมมา ต้องเป็นทรงที่มีอยู่จริง และเป็นทรงเดียวกับที่ `StatusChip` ใส่
  assert.match(css, /^\.chip \{\s*\n\s*display: inline-block; padding: 4px 10px; border-radius: 20px;/m);
  assert.match(read('components/common.jsx'), /className=\{`chip st-\$\{status\}`\}/);

  // สองเม็ดที่ซ้อนกันต้องไม่ชนกัน — ป้ายสองใบที่ติดกันอ่านเป็นป้ายใบเดียวที่ขาด
  const flagBody = css.slice(css.indexOf('.hr-table td.scan-col .scan-flag {'));
  assert.match(flagBody.slice(0, flagBody.indexOf('}')), /gap: 3px/);
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


test('ลิ้นชัก ไฟล์สแกนนิ้วมือ กระชับลง โดยไม่มีข้อเท็จจริงไหนหายไป', () => {
  /* *"ปรับการแสดงผลส่วนนี้ให้กระชับ แต่ยังได้รายละเอียดครบถ้วน และใช้พื้นที่อย่างคุ้มค่าที่สุด"* (11 ??.?. 2569) */

  // 1. หัวข้อกับบรรทัดตัวเลขอยู่บรรทัดเดียวกัน
  //    สองคำบนบรรทัดกว้างเท่าการ์ด คือบรรทัดที่จ่ายไปกับการบอกชื่อลิ้นชัก
  assert.match(scanImport, /<div className="scan-head-text">/);
  /* ⚠ THIS PINNED `.scan-head-text { flex: 1; display: flex; flex-wrap: wrap;
     align-items: baseline; }` UNTIL 11 ก.ย. 2569, when the fold's own control was
     asked onto this row as well: *"ปุ่ม อ่านต่อ สำหรับคำอธิบาย ย้ายไปอยู่แถว
     เดียวกับ หัวข้อ"*. A row nested inside the head's row cannot seat a third
     item beside its own two, so the box was dissolved (`display: contents`) and
     the head row itself is the flex.

     THE RULE DID NOT MOVE — the heading and the month's figures read as one
     line — only which element says so. */
  assert.match(scanImport, /<div className="scan-drawer-head">/);
  assert.match(css, /^\.scan-drawer-head \{\r?\n  display: flex; flex-wrap: wrap; align-items: baseline;/m);
  assert.match(css, /^\.scan-head-text \{ display: contents; \}$/m);

  /* 1ข. ปุ่ม อ่านต่อ อยู่ในแถวนั้นด้วย — แต่สิ่งที่มันกางไม่ได้อยู่
        `Disclosure` คืนกล่องเดียวที่ถือทั้งปุ่มและเนื้อความ หัวลิ้นชักต้องการมันคนละที่
        `display: contents` ส่งลูกทั้งสองเข้าแถว flex แล้ว `order` จัดที่ให้
        — ปุ่มต่อจากตัวเลข เนื้อความลงไปเต็มความกว้างข้างล่าง กลไกเดียวกับ `.manual-intro-head` */
  assert.match(css, /^\.scan-drawer-head > \.disclosure \{ display: contents; \}$/m);
  assert.match(css, /^\.scan-drawer-head \.disclosure-more \{ order: 1; \}$/m);
  assert.match(css, /^\.scan-drawer-head \.disclosure-slide \{ order: 3; flex-basis: 100%; \}$/m);
  // บนมือถือ ปุ่มที่นิ้วต้องกดจริง ๆ คือปุ่มเดียวในลิ้นชักนี้ จึงกินบรรทัดทั้งบรรทัด
  const phone = css.slice(css.indexOf('@media (max-width: 640px)', css.indexOf('.scan-drawer-head {')));
  assert.match(phone.slice(0, phone.indexOf('\n}')), /\.scan-drawer-head > \.row \.btn \{ flex: 1; min-height: 44px; \}/);

  // 2. สี่ช่องเป็นสองคอลัมน์ — สิ่งที่มันอธิบายคือตาราง
  assert.match(scanImport, /<div className="scan-slots">/);
  assert.match(css, /\.scan-slots \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); /);
  // กลับเป็นคอลัมน์เดียวบนจอแคบ
  assert.match(css.slice(css.indexOf('@media (max-width: 640px)')), /\.scan-slots \{ grid-template-columns: 1fr; \}/);

  /* 3. `(ไม่บังคับ)` พูดครั้งเดียว ไม่ใช่สี่ครั้ง — เป็นข้อเท็จจริงของ *เดือน*
        (HR 4 ก.ย. 2569: เครื่องอาจยังไม่ได้ถ่ายข้อมูล บริษัทหนึ่งอาจไม่มีใครเลย)
        การพูดซ้ำทุกแถวที่ว่างคือประโยคเดิมที่ย้ำจนคนเลิกอ่าน */
  assert.ok(!scanImport.includes('ยังไม่ได้นำเข้า (ไม่บังคับ)'), 'ยังพูดซ้ำทุกแถว');
  assert.match(scanImport, /' \(ไม่ต้องครบก็ได้\)'/);
  assert.match(scanImport, /: ' — ยังไม่ได้นำเข้า'\}/);

  // 4. แผง ตรวจก่อนนำเข้า เหลือสองบรรทัด และปุ่มมาอยู่แถวเดียวกับชื่อไฟล์
  // ตัดจากจุดเริ่มของแผง ไม่ใช่จากหัวข้อ — `.scan-line` ที่ห่อหัวข้อกับปุ่มไว้
  // อยู่เหนือหัวข้อขึ้นไปหนึ่งบรรทัด
  const panel = scanImport.slice(scanImport.indexOf('{pending && ('));
  const upto = panel.slice(0, panel.indexOf('</Alert>'));
  assert.match(upto, /<div className="scan-line">/);
  assert.match(upto, /ยืนยันนำเข้า/);
  assert.match(upto, /ยกเลิก/);
  // ปุ่มมีชุดเดียว ไม่ได้ทิ้งแถวเดิมไว้ข้างล่าง
  assert.equal((upto.match(/ยืนยันนำเข้า/g) || []).length, 1, 'มีปุ่มยืนยันสองชุด');

  /* 4ข. คำอธิบายสั้นลง แต่ยังเป็นห้าข้อ — 11 ก.ย. 2569
        *"ปรับคำอธิบายให้กระชับขึ้น แต่ได้ใจความสำคัญครบถ้วน"* — แต่ละข้อตอบคนละคำถาม
        ที่มีคนถามออกมาจริง ๆ: นำเข้าแล้วตัวเลขขยับไหม · เดือนหนึ่งกี่ไฟล์ · รู้ได้อย่างไรว่าไฟล์
        ไหนของเครื่องไหนบริษัทไหน · นำเข้าซ้ำแล้วเกิดอะไร · ทำไมไม่มีเข้า/ออก ห้าข้อนี้จึงยัง
        ครบห้า ที่หายไปคือการพูดรอบสองของแต่ละข้อ ไม่ใช่ข้อไหน */
  const fold = scanImport.slice(scanImport.indexOf('<Disclosure as="ul"'), scanImport.indexOf('</Disclosure>'));
  assert.equal((fold.match(/<li>/g) || []).length, 5, 'ข้อเท็จจริงในคำอธิบายหายไปหนึ่งข้อ');
  for (const fact of [
    'ไฟล์นี้ถูกเก็บไว้เฉย ๆ', 'เดือนหนึ่งมีได้ถึง', 'ไม่ต้องครบก็ได้',
    'ระบบดูออกเอง', 'ทะเบียนพนักงาน', 'ทับของเดิมได้', 'ไฟล์เดิมยังเก็บไว้',
    'ครั้งไหนเข้า ครั้งไหนออก',
  ]) assert.ok(fold.includes(fact), `คำอธิบายขาด: ${fact}`);
  // ตัวอย่างบรรทัดของแต่ละเครื่องยังอ่านมาจาก SCAN_FORMATS ไม่ได้พิมพ์ไว้เอง
  assert.match(fold, /SCAN_FORMATS\.map/);

  /* 5. ⚠ ข้อเท็จจริงครบเท่าเดิมทุกตัว — "กระชับ" ไม่ใช่ "ตัดออก"
        `บรรทัด` ย้ายลงไปอยู่บรรทัดที่สอง ข้าง ๆ ยอดที่ถูกข้าม ซึ่งเป็นตัวที่อธิบาย
        ว่าทำไมมันไม่เท่ากับ `รายการสแกน` — สองตัวเลขที่ต่างกันนิดเดียวอยู่ติดกัน
        บนหัวแผง คือการลบที่ไม่มีใครขอให้คนอ่านทำ */
  for (const piece of ['pending.file.name', 'summary.punchCount', 'summary.peopleCount',
    'scanDateRange(pending.summary)', 'formatLabel(pending.summary.format)', 'pending.encoding',
    'summary.lineCount', 'summary.skippedCount', 'summary.errorCount', 'summary.duplicateCount',
    '{mismatch}']) {
    assert.ok(upto.includes(piece), `${piece} หายไปจากแผงตรวจก่อนนำเข้า`);
  }
});

test('การ์ดผลเทียบเหลือสองแถว — หัวข้อกับคำตอบเป็นประโยคเดียว และคำกำกับเป็นชิ้นสุดท้ายของแถวตัวเลข', () => {
  /* *"ปรับการแจ้งเตือนตามภาพให้กระชับด้วย … ปรับให้เหลือไม่เกิน 1-2 แถวเป็นอันดับแรก"* (11 ก.ย. 2569) · เดิมเป็นห้าก้อน: แถวหัวข้อ · แถวคำตอบ · แถวตัวเลข
     · ย่อหน้าคำกำกับ · และปุ่มบนแถวของตัวเอง — ห้าก้อนสำหรับคำตอบเดียว */

  // หัวข้อกับคำตอบเป็นประโยคเดียวบน `.scan-line` แถวเดียวกับที่สถานะแรกใช้
  const body2 = card.slice(card.indexOf('if (!counts) return null;'));
  const upto = body2.slice(0, body2.indexOf('<div className="scan-tally">'));
  assert.match(upto, /<div className="scan-line">/);
  assert.match(upto, /<strong>ผลเทียบกับไฟล์สแกนนิ้วมือ · \{periodLabel\(period\)\}<\/strong>/);
  assert.match(upto, /className="scan-big warn">⚠ ต้องตรวจ \{counts\.mismatch\} แถว/);
  assert.match(upto, /className="scan-big ok">✓ ทุกแถวที่เทียบได้ตรงกับไฟล์สแกน/);
  // และปุ่มเดียวของการ์ดอยู่ท้ายประโยคที่ถือตัวเลขนั้น
  assert.match(upto, /onToggleFlagged && flagged > 0 && \(/);
  assert.ok(!css.includes('.scan-head { margin: 6px 0 0; }'), 'ก้อนหัวข้อเดิมยังอยู่ในสไตล์ชีต');

  /* ⚠ คำกำกับเป็นชิ้นสุดท้ายของแถวตัวเลข ไม่ใช่ย่อหน้าใต้แถว
     `.scan-tally` เป็นแถว flex ที่ตัดบรรทัดได้ การเป็นชิ้นหนึ่งในนั้นทำให้มันลงบรรทัด
     เดียวกันเมื่อมีที่ และกินบรรทัดของตัวเองเมื่อไม่มี ซึ่งย่อหน้าทำแบบนั้นไม่ได้ */
  const tally = card.slice(card.indexOf('<div className="scan-tally">'));
  const tallyEnd = tally.slice(0, tally.indexOf('</div>'));
  assert.match(tallyEnd, /เป็นข้อเท็จจริง ไม่นับเป็นกองที่ต้องตรวจ/);
  assert.match(tallyEnd, /ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน/);
  // เป็น `.quiet` เหมือนสองตัวเลขที่มันกำกับ ด้วยเหตุผลเดียวกัน
  assert.match(tallyEnd, /<span className="quiet">/);

  // ⚠ ตัวเลขทั้งหกตัวและจำนวนคน/ใบ ยังอยู่ครบ — "กระชับ" ไม่ใช่ "ตัดออก"
  for (const piece of ['counts.short', 'counts.startOff', 'counts.noScan',
    'counts.overTime', 'counts.flatDaily', '{agreed}', 'compare.entryCount']) {
    assert.ok(body2.includes(piece), `${piece} หายไปจากการ์ด`);
  }
});
