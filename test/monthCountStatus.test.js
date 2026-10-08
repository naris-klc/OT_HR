import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คอลัมน์ รายการ บน ตรวจสอบประจำเดือน — `ที่นับ/ทั้งเดือน` แล้วนาฬิกาเมื่อมีใบค้าง.
 *
 * ── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *
 * 2026-10-08, picked from a mockup: *"ข้อความในคอลัมน์รายการ ให้แสดงจำนวนที่
 * นับ/ทั้งหมด แล้วมีไอคอนเวลา เอาเม้าไปชี้แล้วแสดง tooltip ว่ารออะไรเท่าไร"*.
 *
 * ── THE THREE THINGS IT HAS TO KEEP TRUE ───────────────────────────────────
 *
 *  1. **THE FIRST NUMBER IS WHAT THE ROW'S HOURS COUNT** (`entryCount`, filtered
 *     by สถานะที่นับ) and the second is the whole month from `monthStatus`.
 *     2026-09-11 drew the same two bases stacked (`11` over `11  1`) and it was
 *     rejected as unreadable; a fraction says which number is part of which.
 *  2. **WHAT IS WAITING IS IN THE CLOCK'S TOOLTIP, ALWAYS FOR THE WHOLE MONTH** —
 *     the column answers "is anything of this person's left to do", which must
 *     not disappear because the filter was narrowed.
 *  3. **ONE LINE.** The row is two lines already (name over รหัส); the cell may
 *     not add a third.
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

// ── 1. the two numbers ──────────────────────────────────────────────────────

test('เลขหน้าคือใบที่นับ เลขหลังคือใบทั้งเดือน — และเท่ากันก็วาดเลขเดียว', () => {
  assert.match(helper, /const total = m\.approved \+ m\.pendingMgr \+ m\.pendingHr;/);
  assert.match(helper, /\{row\.entryCount\}\r?\n\s*\{row\.entryCount !== total && <span className="count-of">\/\{total\}<\/span>\}/);
  // `entryCount` alone for a payload with no `monthStatus` — an old response in
  // a tab nobody reloaded.
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

// ── 2. what is waiting goes in the clock ────────────────────────────────────

test('นาฬิกาขึ้นเฉพาะเมื่อมีใบค้าง และ tooltip บอกว่ารอใครกี่ใบ', () => {
  assert.match(helper, /m\.pendingMgr > 0 && `รอหัวหน้า \$\{m\.pendingMgr\} ใบ`/);
  assert.match(helper, /m\.pendingHr > 0 && `รอ HR \$\{m\.pendingHr\} ใบ`/);
  assert.match(helper, /\{waiting && \(/);
  // The app's one tooltip (`data-tip` → TipLayer), reachable by Tab, and the
  // app's one clock — not a second icon set, not the native `title`.
  assert.match(helper, /<span className="count-wait" tabIndex=\{0\} data-tip=\{waiting\} aria-label=\{waiting\}>/);
  assert.match(helper, /<Icon name="clock" \/>/);
  // The 2026-09-11 second line is gone, and so is its stylesheet.
  assert.doesNotMatch(helper, /count-status/);
  assert.doesNotMatch(cssCode, /\.count-status/);
});

test('นาฬิกาใช้สีเดียวกับป้าย รอหัวหน้า ที่แอปวาดอยู่แล้ว', () => {
  assert.match(css, /\.count-frac \.count-wait \{[^}]*color: var\(--amber\);/);
  const at = css.indexOf('.chip.st-pending_mgr {');
  assert.ok(at > 0, '.chip.st-pending_mgr หายไปจากสไตล์ชีต');
  assert.match(css.slice(at, css.indexOf('}', at)), /color: var\(--amber\)/);
});

// ── 3. one line ─────────────────────────────────────────────────────────────

test('เซลล์เป็นบรรทัดเดียว ห้ามตัดที่เครื่องหมาย /', () => {
  assert.match(css, /\.count-frac \{\r?\n\s*display: inline-flex; align-items: center; gap: 1px; white-space: nowrap;\r?\n\}/);
});

test('40px ที่คอลัมน์ รายการ คืนมา ไปอยู่ที่ พนักงาน — ผลรวมสามคอลัมน์เท่าเดิม', () => {
  const width = (col) => {
    const m = css.match(new RegExp(`\\.hr-table th\\.${col} \\{ width: (\\d+)px; \\}`));
    assert.ok(m, `ไม่พบความกว้างของ ${col}`);
    return Number(m[1]);
  };
  assert.equal(width('count-col'), 96);
  assert.equal(width('who-col'), 264);
  assert.equal(width('cap-col'), 140);
  // Under `table-layout: auto` a width that moves without its pair comes out of
  // the one column that wraps — so the three are pinned as a budget.
  assert.equal(width('count-col') + width('who-col') + width('cap-col'), 136 + 224 + 140);
});

test('หัวคอลัมน์เป็นคำเดียว และ title บอกว่าเลขไหนคืออะไร', () => {
  const at = code.indexOf('className="num count-col"');
  assert.ok(at > 0, 'หัวคอลัมน์ รายการ เปลี่ยนรูปไปแล้ว');
  const th = code.slice(code.lastIndexOf('<th', at), code.indexOf('</th>', at));
  assert.match(th, /title="ใบที่นับตามสถานะที่นับ \/ ใบทั้งเดือน[^"]*"/);
  assert.doesNotMatch(th, /<span/);
  assert.match(th, /รายการ/);
});

test('ค้าง n ของเดิมไม่กลับมา และ HR อนุมัติชั้นเดียว ยังอยู่', () => {
  assert.doesNotMatch(cellCode, /row\.pendingCount/, 'เซลล์กลับไปอ่าน pendingCount แล้ว');
  /* `HR อนุมัติชั้นเดียว` is a different fact — ใบ carrying no หัวหน้า
     signature at all — it is rare, and it was the third line before any of this
     began. Named here so its survival is a decision rather than an oversight. */
  assert.match(cellCode, /row\.hrVerified > 0/);
});
