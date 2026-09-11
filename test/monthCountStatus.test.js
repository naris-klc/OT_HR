import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คอลัมน์ รายการ บน ตรวจสอบประจำเดือน — จำนวนใบทั้งเดือน แล้วบรรทัดที่บอกว่า
 * ค้างอยู่ที่ขั้นไหน.
 *
 * ── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *
 * 2026-09-11: *"ตรงคอลัมน์ รายการ ให้แสดงเป็นข้อมูลสถานะ เช่น อนุมัติ 5 /
 * รอหัวหน้า 2 / รอ 3 · ช่วยออกแบบหน่อยทำยังไงให้ความสูงของแถวไม่เพิ่ม"*, then
 * *"แล้วใบที่ค้างจะแสดงยังไง"*, and then — against the built screen —
 * **"ผมว่าจะต้องออกแบบใหม่ครับ ดูแล้วเข้าใจยาก"**.
 *
 * ── THE VERSION THAT WAS THROWN AWAY, AND WHY ──────────────────────────────
 *
 * The first build drew `entryCount` over three fixed slots (`อนุมัติ · หัวหน้า
 * · HR`) with a legend in the heading, `–` for zero, and the slots the filter
 * did not count greyed. The screenshot killed it in two ways at once:
 *
 *   1. **TWO BASES IN ONE CELL.** A row read `11`, then `11  1` beneath it —
 *      the top filtered by สถานะที่นับ, the three the whole month. Both true,
 *      and together they read as a table that cannot add up. The grey existed
 *      to explain that gap and was one more thing to decode instead.
 *   2. **NEARLY EVERY SLOT WAS A DASH.** `อนุมัติ` all but equals the total on
 *      almost every row, so two thirds of the column and all of its legend went
 *      to restating what the reader already had.
 *
 * ── THE THREE THINGS THE REPLACEMENT HAS TO KEEP TRUE ──────────────────────
 *
 *  1. **ONE BASIS.** Every figure in the cell is the whole month, so they add
 *     up by construction and there is nothing left to grey. This is what the
 *     fix actually was: not a better way to show the gap, but removing it.
 *  2. **ONLY WHAT IS OUTSTANDING GETS INK.** No `อนุมัติ` figure at all — it is
 *     the total minus what is written. A reader scanning the column sees words
 *     exactly on the rows that want them.
 *  3. **TWO LINES AT MOST.** The row is already two lines (`who-col` draws the
 *     รหัส under the name), so the second is free and a third makes EVERY row
 *     in the table taller — the one thing the ask ruled out. Both pending kinds
 *     share one line and that line may not wrap.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * The source with its comments taken out — test/queueDropdown.test.js's
 * stripper verbatim, which carries that file's rule and its reason: a BAN
 * PROVES NOTHING WITHOUT IT.
 *
 * ⚠ THIS FILE PROVED IT ON ITS FIRST RUN, twice in one go, in its previous
 * shape. Two of the checks below are bans, and both matched the PARAGRAPH
 * explaining that the code had been removed. A ban read against the sentence
 * that says the code is gone passes on the strength of that sentence.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const route = read('app/api/reports/monthly/[period]/route.js');
const view = read('components/HrView.jsx');
const code = strip(view);
const css = read('app/styles.css');
/**
 * ⚠ AND THE STYLESHEET NEEDS IT TOO, which this file learnt one run later: the
 * ban on `.count-legend` matched the ⚠ paragraph in app/styles.css that records
 * the grid being REMOVED. Same failure as the component's, same fix.
 */
const cssCode = strip(css);

/** `monthCount`, the helper the cell is, with its prose taken off. */
const helper = (() => {
  const at = view.indexOf('function monthCount(row) {');
  assert.ok(at > 0, 'monthCount หายไปจาก components/HrView.jsx');
  return strip(view.slice(at, view.indexOf('\n}', at)));
})();

/** The `<td>` itself, also stripped — the bans at the bottom read this. */
const cellCode = (() => {
  const at = code.indexOf('<td className="num count-col">');
  assert.ok(at > 0, 'คอลัมน์ รายการ ไม่มี <td> ของตัวเองแล้ว');
  return code.slice(at, code.indexOf('</td>', at));
})();

// ── 1. the basis, which is the whole repair ─────────────────────────────────

test('ทุกตัวเลขในเซลล์มาจากฐานเดียวกัน — ใบทั้งเดือน ไม่ใช่ชุดที่ตัวกรองเลือก', () => {
  /* ⚠ THE TOTAL IS THE SUM OF THE THREE, COMPUTED — not `entryCount` read off
     the payload. That is what makes "the figures add up" structurally true
     rather than a coincidence that holds until somebody narrows the filter. */
  assert.match(helper, /const total = m\.approved \+ m\.pendingMgr \+ m\.pendingHr;/);
  assert.doesNotMatch(
    cellCode,
    /\{row\.entryCount\}/,
    'เซลล์กลับไปวาด entryCount ซึ่งนับตามตัวกรอง — สองฐานในเซลล์เดียวคือปัญหาที่รอบนี้แก้',
  );

  // `entryCount` survives only as the fallback for a payload with no
  // `monthStatus` — an old response in a tab nobody reloaded, not a design.
  assert.match(helper, /if \(!m\) return row\.entryCount;/);
});

test('สามเลขมาจาก live ของเราต์ ซึ่งเป็นใบทั้งเดือนทุกสถานะ', () => {
  const at = route.indexOf('monthStatus: {');
  assert.ok(at > 0, 'เราต์เลิกส่ง monthStatus แล้ว');
  const tally = route.slice(at, route.indexOf('},', at));
  for (const [key, status] of [
    ['approved', 'approved'],
    ['pendingMgr', 'pending_mgr'],
    ['pendingHr', 'pending_hr'],
  ]) {
    assert.match(
      tally,
      new RegExp(`${key}: live\\.filter\\(\\(e\\) => e\\.status === '${status}'\\)\\.length`),
      `${key} ไม่ได้นับจาก live — ที่ อนุมัติแล้วเท่านั้น คอลัมน์จะบอกว่าไม่มีใบค้าง`,
    );
  }
  assert.doesNotMatch(tally, /group\.entries/, 'กลับไปนับจากชุดที่ตัวกรองเลือกแล้ว');
});

test('ไม่มีการอ่านฐานข้อมูลเพิ่ม — ใช้แถวชุดเดียวกับที่คอลัมน์ เพดาน ดึงมาแล้ว', () => {
  assert.match(
    route,
    /const live = capByEmployee\.get\(String\(group\.employee\?\._id\)\) \|\| \[\];\r?\n\s*const cap = capColumn\(\{\r?\n\s*shown: group\.entries,\r?\n\s*live,/,
    'live ไม่ได้มาจาก capByEmployee แล้ว — อาจมีการอ่านฐานรอบที่สองแอบเข้ามา',
  );
  assert.equal(
    (route.match(/await capEntriesByEmployee\(/g) || []).length,
    1,
    'เราต์เรียก capEntriesByEmployee มากกว่าหนึ่งครั้ง',
  );
});

// ── 2. only what is outstanding gets ink ────────────────────────────────────

test('วาดเฉพาะส่วนที่ค้าง — ไม่มีเลข อนุมัติ และไม่มีขีดแทนศูนย์', () => {
  // Guarded by `> 0`, so a person with nothing pending draws a bare number and
  // the column's blank rows are the answer rather than the absence of one.
  assert.match(helper, /m\.pendingMgr > 0 && <span key="m" className="cs-m">รอหัวหน้า \{m\.pendingMgr\}<\/span>/);
  assert.match(helper, /m\.pendingHr > 0 && <span key="h" className="cs-h">รอHR \{m\.pendingHr\}<\/span>/);

  /* ⚠ THE VERB IS PART OF THE LABEL — asked for on 2026-09-11 as *"แก้ไขคำเป็น
     `รอหัวหน้า 1` `รอHR 1`"*. `หัวหน้า 1` named a person and left the reader to
     supply what the row was doing with them; the column exists to answer "is
     there anything of this person's left to do", so the waiting is the word
     that cannot be the one left out. Pinned as a whole label rather than a
     substring: `HR 1` matches inside `รอHR 1` and would pass either way. */
  assert.doesNotMatch(helper, /className="cs-m">หัวหน้า /, 'ป้ายกลับไปเป็น หัวหน้า เฉย ๆ ไม่มีคำว่ารอ');
  assert.doesNotMatch(helper, /className="cs-h">HR /, 'ป้ายกลับไปเป็น HR เฉย ๆ ไม่มีคำว่ารอ');
  assert.match(helper, /\.filter\(Boolean\)/);

  /* ⚠ NO `อนุมัติ` FIGURE AND NO `–` — both were in the version the screenshot
     rejected. `อนุมัติ` is the resting state and is the total minus what is
     written; a dash is ink spent saying "none of this kind" on a column where
     "none" is the usual answer. */
  assert.doesNotMatch(helper, /cs-a/, 'ช่อง อนุมัติ กลับมาอยู่ในเซลล์แล้ว');
  assert.doesNotMatch(helper, /'–'/, 'ขีดแทนศูนย์กลับมาแล้ว');
  assert.doesNotMatch(cssCode, /\.count-status \.out/, 'กฎทำสีจางยังอยู่ — ไม่มีช่องว่างให้อธิบายอีกแล้ว');
  assert.doesNotMatch(cssCode, /\.count-legend/, 'คำอธิบายที่หัวคอลัมน์ยังอยู่ ทั้งที่เซลล์บอกชื่อสถานะเองแล้ว');
  assert.doesNotMatch(code, /const counted = React\.useMemo/, 'counted ยังอยู่ — ไม่มีอะไรให้มันตัดสินแล้ว');
});

test('มีทั้งสองอย่างก็ยังบรรทัดเดียว และบรรทัดนั้นห้ามตัดคำ', () => {
  /* THE HEIGHT BUDGET, ENFORCED IN TWO PLACES. One `<div>` holds both, joined
     by a separator rather than one block each — and `nowrap` is what turns a
     cell too narrow into a visible overflow instead of a silent third line that
     makes every row in the table taller. */
  assert.match(helper, /waiting\.length === 2 \? \[waiting\[0\], ' · ', waiting\[1\]\] : waiting/);
  assert.equal(
    (helper.match(/<div className="count-status">/g) || []).length,
    1,
    'มี .count-status มากกว่าหนึ่งบล็อก — สองอย่างจะกลายเป็นสองบรรทัด',
  );
  assert.match(css, /\.count-status \{\r?\n\s*font: 600 11\.5px\/1\.5 var\(--sans\); margin-top: 1px; white-space: nowrap;\r?\n\}/);

  // 136px is what the widest line — `รอหัวหน้า 1 · รอHR 2`, 109.5px measured off
  // the font file — is measured against, plus the cell's two 12px gutters.
  assert.match(css, /\.hr-table th\.count-col \{ width: 136px; \}/);
});

test('40px ที่คอลัมน์ รายการ กินเพิ่ม ถูกจ่ายมาจากคอลัมน์ที่วัดแล้วว่ามีเหลือ', () => {
  /* ⚠ THIS TABLE IS `table-layout: auto`, WHICH IS WHY THE SUM MATTERS.
     A declared width there is not a box the cell is clipped into — it is a
     share of the row. Declare one column 40px more and the browser does not
     find the 40px in the margin; it takes it out of the only column that can
     wrap, which is แผนก, and แผนก breaking mid-word is a bug this table has
     already had twice (`th.dept-col`'s two notes in app/styles.css).

     So the four widths are pinned together, as a budget rather than four
     numbers. `รอ` on the labels cost 40px; `who-col` 196 → 168 and `cap-col`
     152 → 140 paid all of it, both still measured over what they hold, and
     `dept-col` — the one that wraps — was not asked to contribute. */
  const width = (col) => {
    const m = css.match(new RegExp(`\\.hr-table th\\.${col} \\{ width: (\\d+)px; \\}`));
    assert.ok(m, `ไม่พบความกว้างของ ${col}`);
    return Number(m[1]);
  };
  assert.equal(width('count-col'), 136);
  assert.equal(width('who-col'), 168);
  assert.equal(width('cap-col'), 140);
  assert.equal(width('dept-col'), 160, 'แผนก ถูกเรียกมาจ่ายด้วย — มันคือคอลัมน์ที่การย้ายนี้มีไว้ป้องกัน');

  assert.equal(
    width('count-col') + width('who-col') + width('cap-col'),
    96 + 196 + 152,
    'รวมสามคอลัมน์ไม่เท่าเดิม — ความกว้างที่เพิ่มมาถูกดึงมาจาก แผนก โดยเงียบ ๆ',
  );
});

test('หัวคอลัมน์กลับมาเป็นคำเดียว และบอกไว้ว่ามันไม่ขึ้นกับ สถานะที่นับ', () => {
  const at = code.indexOf('className="num count-col"');
  assert.ok(at > 0, 'หัวคอลัมน์ รายการ เปลี่ยนรูปไปแล้ว');
  const th = code.slice(code.lastIndexOf('<th', at), code.indexOf('</th>', at));

  // The one thing about this column a reader cannot work out by looking at it.
  assert.match(th, /title="[^"]*ไม่ขึ้นกับสถานะที่นับ"/);
  // …and the three-word key is gone, because the cell names its own statuses.
  assert.doesNotMatch(th, /<span/, 'คำอธิบายสามคำกลับมาอยู่ที่หัวคอลัมน์แล้ว');
  assert.match(th, /รายการ/);
});

test('สีของส่วนที่ค้าง เป็นสีเดียวกับป้ายสถานะที่แอปวาดอยู่แล้ว', () => {
  /* INHERITED, NOT CHOSEN — docs/design.md §1. And the words carry the meaning
     on their own here, so the colour is a help rather than the only key. */
  for (const [cls, token, chip] of [
    ['cs-m', '--amber', '.chip.st-pending_mgr'],
    ['cs-h', '--info', '.chip.st-pending_hr'],
  ]) {
    assert.match(css, new RegExp(`\\.count-status \\.${cls} \\{ color: var\\(${token}\\); \\}`));
    const at = css.indexOf(`${chip} {`);
    assert.ok(at > 0, `${chip} หายไปจากสไตล์ชีต`);
    assert.match(
      css.slice(at, css.indexOf('}', at)),
      new RegExp(`color: var\\(${token}`),
      `${chip} เลิกใช้ ${token} แล้ว — ตัวเลขกับป้ายจะคนละสีทั้งที่หมายถึงสถานะเดียวกัน`,
    );
  }
});

test('ค้าง n ของเดิมไม่กลับมา และ HR อนุมัติชั้นเดียว ยังอยู่', () => {
  assert.doesNotMatch(cellCode, /row\.pendingCount/, 'เซลล์กลับไปอ่าน pendingCount แล้ว');
  /* `HR อนุมัติชั้นเดียว` is a different fact — ใบ carrying no หัวหน้า
     signature at all — it is rare, and it was the third line before any of this
     began. Named here so its survival is a decision rather than an oversight. */
  assert.match(cellCode, /row\.hrVerified > 0/);
});
