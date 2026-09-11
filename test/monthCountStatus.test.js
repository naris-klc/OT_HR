import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คอลัมน์ รายการ บน ตรวจสอบประจำเดือน — เลขรวม แล้วสามช่องสถานะใต้มัน.
 *
 * ── WHAT WAS ASKED, AND THE QUESTION THAT DECIDED THE SHAPE ─────────────────
 *
 * 2026-09-11: *"ตรงคอลัมน์ รายการ ให้แสดงเป็นข้อมูลสถานะ เช่น อนุมัติ 5 /
 * รอหัวหน้า 2 / รอ 3 · ช่วยออกแบบหน่อยทำยังไงให้ความสูงของแถวไม่เพิ่ม"* — and
 * then, before a line was written: *"แล้วใบที่ค้างจะแสดงยังไง"*.
 *
 * That second question is the one this file is mostly about. The obvious build
 * counts the three over `group.entries`, the rows สถานะที่นับ selected — and at
 * อนุมัติแล้วเท่านั้น that reports `รอหัวหน้า 0 · รอ HR 0` on somebody with
 * fifteen ใบ outstanding. True of the filter, a lie about the person, and
 * indistinguishable from a month that is genuinely finished.
 *
 * So the three are counted over the WHOLE month. It is the argument the เพดาน
 * column one cell over already makes for itself — *a department's remaining
 * allowance is not a display preference* — and it costs nothing: the rows are
 * the ones `capEntriesByEmployee` has already fetched for that column.
 *
 * ── THE THREE MISTAKES THIS FILE EXISTS TO PREVENT ──────────────────────────
 *
 *  1. **Counting over the filtered set.** Cheaper to write, silently wrong, and
 *     wrong in the direction that makes a month look safe to sign.
 *  2. **A SECOND read to get the unfiltered month.** This route is already two
 *     queries and the ceiling one was deliberately shared with สรุปรายเดือน
 *     (CSV) so the file and the screen cannot disagree. A third read for the
 *     same rows would undo that on both counts.
 *  3. **A third line in the cell.** The row is two lines tall today because
 *     `who-col` draws the รหัส under the name; a cell that takes a third line
 *     makes EVERY row in the table taller, which is the one thing the ask ruled
 *     out. `ค้าง n` leaving is what pays for this line.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * The source with its comments taken out — test/queueDropdown.test.js's
 * stripper verbatim, which carries that file's rule and its reason: a BAN
 * PROVES NOTHING WITHOUT IT.
 *
 * ⚠ AND THIS FILE PROVED IT ON ITS FIRST RUN, twice in one go. Two checks below
 * are bans — that `ค้าง {row.pendingCount}` is gone from the cell, and that the
 * legend's words are in the heading and not repeated in every row — and both
 * matched the PARAGRAPH IN THE CELL explaining that the line was removed and
 * where the words went. A ban read against the sentence that says the code is
 * gone passes on the strength of that sentence.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const route = read('app/api/reports/monthly/[period]/route.js');
const view = read('components/HrView.jsx');
const css = read('app/styles.css');

/** The คอลัมน์ รายการ cell, from its `<td>` to the one after it. */
const cell = (() => {
  const at = view.indexOf('<td className="num count-col">');
  assert.ok(at > 0, 'คอลัมน์ รายการ ไม่มี <td> ของตัวเองแล้ว');
  return view.slice(at, view.indexOf('</td>', at));
})();

/** The same cell with the prose gone — what the two bans below are read against. */
const cellCode = strip(cell);

// ── 1. the basis ────────────────────────────────────────────────────────────

test('สามช่องสถานะนับจากทั้งเดือน ไม่ใช่จากชุดที่ สถานะที่นับ กรองมา', () => {
  const at = route.indexOf('monthStatus: {');
  assert.ok(at > 0, 'เราต์เลิกส่ง monthStatus แล้ว');
  const tally = route.slice(at, route.indexOf('},', at));

  // ⚠ `live`, NEVER `group.entries`. The whole point of the field.
  for (const [key, status] of [
    ['approved', 'approved'],
    ['pendingMgr', 'pending_mgr'],
    ['pendingHr', 'pending_hr'],
  ]) {
    assert.match(
      tally,
      new RegExp(`${key}: live\\.filter\\(\\(e\\) => e\\.status === '${status}'\\)\\.length`),
      `${key} ไม่ได้นับจาก live — ถ้ามันนับจากชุดที่กรองแล้ว ที่ อนุมัติแล้วเท่านั้น จะรายงานว่าไม่มีใบค้าง`,
    );
  }
  assert.doesNotMatch(
    tally,
    /group\.entries/,
    'สามช่องสถานะกลับไปนับจากชุดที่ตัวกรองเลือกแล้ว',
  );
});

test('ไม่มีการอ่านฐานข้อมูลเพิ่ม — ใช้แถวชุดเดียวกับที่คอลัมน์ เพดาน ดึงมาแล้ว', () => {
  // `live` is bound once, from the map the ceiling column already awaited, and
  // `capColumn` is handed that same binding rather than a second `.get()`.
  assert.match(
    route,
    /const live = capByEmployee\.get\(String\(group\.employee\?\._id\)\) \|\| \[\];\r?\n\s*const cap = capColumn\(\{\r?\n\s*shown: group\.entries,\r?\n\s*live,/,
    'live ไม่ได้มาจาก capByEmployee แล้ว — อาจมีการอ่านฐานรอบที่สองแอบเข้ามา',
  );
  // One `await` for the ceiling rows, as before. A second would be a new read.
  assert.equal(
    (route.match(/await capEntriesByEmployee\(/g) || []).length,
    1,
    'เราต์เรียก capEntriesByEmployee มากกว่าหนึ่งครั้ง',
  );
});

// ── 2. the cell, and the height budget ──────────────────────────────────────

test('เซลล์เป็นสองบรรทัด — เลขรวม แล้วสามช่อง และ ค้าง n ถูกแทนที่ไปแล้ว', () => {
  assert.match(cell, /\{row\.entryCount\}/);
  assert.match(cell, /<div\r?\n?\s*className="count-status"/);

  /* ⚠ THE LINE THAT PAID FOR THE NEW ONE. `ค้าง n` was `pendingCount` — one
     amber number for "not approved", which lumped a ใบ waiting on a หัวหน้า in
     with one waiting on this very reader. Its replacement says both, in the
     same one line. If it comes back the cell is three lines and every row in
     the table is taller. */
  assert.doesNotMatch(cellCode, /ค้าง \{row\.pendingCount\}/, 'ค้าง n กลับมาแล้ว — เซลล์จะเป็นสามบรรทัด');
  assert.doesNotMatch(cellCode, /row\.pendingCount/, 'เซลล์กลับไปอ่าน pendingCount แล้ว');

  /* `HR อนุมัติชั้นเดียว` IS STILL ALLOWED TO BE THE THIRD LINE. It is a
     different fact (ใบ that carry no หัวหน้า signature at all), it is rare, and
     it reached three lines before this change too — so it is not a regression
     this test should forbid. Named here so that is a decision rather than an
     oversight. */
  assert.match(cellCode, /row\.hrVerified > 0/);
});

test('สามช่องเรียง อนุมัติ · หัวหน้า · HR และศูนย์วาดเป็นขีด', () => {
  const slots = [...cell.matchAll(/className=\{counted\.has\('(\w+)'\) \? '(cs-\w)' : '\2 out'\}/g)]
    .map(([, status, cls]) => [status, cls]);
  assert.deepEqual(slots, [
    ['approved', 'cs-a'],
    ['pending_mgr', 'cs-m'],
    ['pending_hr', 'cs-h'],
  ]);

  // A zero is `–`. `0` competes for the eye with the figures that matter and a
  // blank breaks the grid the eye is scanning down.
  for (const key of ['approved', 'pendingMgr', 'pendingHr']) {
    assert.match(cell, new RegExp(`\\{row\\.monthStatus\\.${key} \\|\\| '–'\\}`));
  }
});

test('ช่องที่ตัวกรองไม่ได้นับ วาดจาง ไม่ใช่ซ่อน', () => {
  /* Hiding the slot would throw away the one thing the gap is telling the
     reader — *this person has ใบ outstanding and you are not looking at them* —
     and would make the column change shape every time สถานะที่นับ moves. */
  assert.match(view, /const counted = React\.useMemo\(\(\) => new Set\(statusFilter\.split\(','\)\), \[statusFilter\]\);/);
  assert.match(css, /\.count-status \.out \{ color: var\(--muted-2\); font-weight: 400; \}/);

  // …and it is declared AFTER the three inks, at equal specificity, which is
  // the only reason it wins over them.
  assert.ok(
    css.indexOf('.count-status .out {') > css.indexOf('.count-status .cs-h {'),
    '.out ถูกประกาศก่อนสีทั้งสาม — มันจะแพ้และช่องที่ไม่ได้นับจะไม่จาง',
  );
});

// ── 3. the heading, and the grid that binds it to the cells ─────────────────

test('หัวคอลัมน์ถือคำอธิบายอยู่เหนือช่องของมันเอง', () => {
  const at = view.indexOf('<th className="num count-col">');
  const th = view.slice(at, view.indexOf('</th>', at));
  assert.match(th, /<span className="count-legend">/);
  for (const [cls, word] of [['cs-a', 'อนุมัติ'], ['cs-m', 'หัวหน้า'], ['cs-h', 'HR']]) {
    assert.match(th, new RegExp(`<span className="${cls}">${word}</span>`));
  }

  /* A HEADING GETS TALLER ONCE; A CELL GETS TALLER ON EVERY ROW. That is why
     the words are here and not repeated in each cell, and it is the same trade
     `RateHead` makes for the three rate columns. */
  /* ⚠ SCOPED TO THE THREE SLOTS, and this assertion was WRONG ON ITS FIRST RUN
     in a way worth keeping. Read against the whole cell it failed on
     `HR อนุมัติชั้นเดียว`, which is real drawn text with every right to be
     there. The claim is not *no Thai in this cell*; it is *the legend is not
     repeated on every row*, and that is a claim about the slots.

     The `title` on the wrapper is outside the scope for the same reason — it
     spells all three statuses out in words for a reader on a pointer, and a
     tooltip costs no height. */
  const from = cellCode.indexOf('<span className=');
  const slots = cellCode.slice(from, cellCode.lastIndexOf('</span>'));
  assert.ok(from > 0 && slots.includes('cs-h'), 'หาสามช่องในเซลล์ไม่เจอ');
  assert.doesNotMatch(slots, /อนุมัติ|หัวหน้า/, 'คำอธิบายหลุดลงไปอยู่ในเซลล์ — ทุกแถวจะสูงขึ้น');
});

test('หัวคอลัมน์กับเซลล์ใช้กริดสามช่องเท่ากัน ตัวเลขจึงตรงกับคำที่กำกับ', () => {
  assert.match(
    css,
    /\.count-legend,\r?\n\.count-status \{ display: grid; grid-template-columns: repeat\(3, 1fr\); gap: 2px; \}/,
  );
  // 96px and centred — the cell stopped being one figure, so `.num`'s right
  // alignment would put the total off the grid's own centre line.
  assert.match(css, /\.hr-table th\.count-col \{ width: 96px; \}/);
  assert.match(css, /\.hr-table th\.count-col, \.hr-table td\.count-col \{ text-align: center; \}/);
});

test('สีของสามช่อง เป็นสีเดียวกับป้ายสถานะที่แอปวาดอยู่แล้ว', () => {
  /* INHERITED, NOT CHOSEN. A figure here and a `.chip` elsewhere on the same
     screen must not come to mean different things — docs/design.md §1. */
  for (const [cls, token, chip] of [
    ['cs-a', '--green-dark', '.chip.st-approved'],
    ['cs-m', '--amber', '.chip.st-pending_mgr'],
    ['cs-h', '--info', '.chip.st-pending_hr'],
  ]) {
    assert.match(
      css,
      new RegExp(`\\.count-legend \\.${cls}, \\.count-status \\.${cls} \\{ color: var\\(${token}\\); \\}`),
    );
    const at = css.indexOf(`${chip} {`);
    assert.ok(at > 0, `${chip} หายไปจากสไตล์ชีต`);
    assert.match(
      css.slice(at, css.indexOf('}', at)),
      new RegExp(`color: var\\(${token}`),
      `${chip} เลิกใช้ ${token} แล้ว — ตัวเลขกับป้ายจะคนละสีทั้งที่หมายถึงสถานะเดียวกัน`,
    );
  }
});
