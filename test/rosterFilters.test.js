import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BLANK, BLANK_LABEL, FACET_KEYS, anyFilter, facetOptions, filterRoster,
} from '../lib/rosterFilters.js';
import { textMatches } from '../lib/personSearch.js';

/**
 * ตำแหน่ง · แผนก · บทบาท บนทะเบียนพนักงาน — asked for on 2026-09-14 with a
 * screenshot of the bar, in two messages: *"เพิ่มตัวกรอง ตำแหน่ง แผนก บทบาท"*
 * and then *"เพิ่มไว้แถวเดียวกับ ช่องค้นหา"*.
 *
 * ── WHAT THE SCREEN COULD NOT BE ASKED BEFORE ───────────────────────────────
 *
 * The register is 164 rows ordered by รหัส and the only way in was
 * ค้นหาพนักงาน, which searches รหัสพนักงาน and ชื่อ-สกุล and nothing else — its
 * own empty state says so, and that sentence exists because people typed
 * department names into it. "Who is in แผนกผลิต1" was nine pages of scrolling.
 *
 * ── THE TWO RULES WORTH A TEST, AND THEY ARE BOTH ABOUT THE LISTS ───────────
 *
 * The filtering itself is three equality checks. What is easy to get wrong is
 * what the boxes OFFER:
 *
 *   NARROWED BY THE OTHER TWO — each list is counted against every filter
 *   except its own, so a ตำแหน่ง that would produce an empty table is not on
 *   the list at all, and the number beside each row is the size of the table
 *   that row would produce.
 *
 *   AND THE CHOSEN VALUE IS NEVER DROPPED FROM ITS OWN LIST, even when the
 *   other two leave nobody holding it — a dropdown that does not contain the
 *   value it is displaying cannot be read and cannot be pressed back.
 *
 * The rest of this file is the screen: the boxes are on the bar the search box
 * is on (asked for in as many words), the table draws what they leave, the page
 * resets when they change, and the phone gets two columns rather than four
 * full-width slabs.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** CRLF here, LF on the Linux box — see the note in `.gitattributes`. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const admin = read('components/AdminView.jsx');
const common = read('components/common.jsx');
const css = read('app/styles.css');

/** The screen, cut at the same seam every other test on it uses. */
const employees = admin.slice(
  admin.indexOf('function Employees({ user })'),
  admin.indexOf('function AddEmployee('),
);

/**
 * A roster in the shape `/employees?all=1` actually hands back: department
 * populated as an object with `nameTh`, ตำแหน่ง as free text, บทบาท as a slug.
 * Ids are 24 hex characters because that is what a real one is, and the rule
 * under test compares them as strings.
 */
const PROD1 = '68c1a0a0a0a0a0a0a0a0a001';
const RND = '68c1a0a0a0a0a0a0a0a0a002';
const dept = (id, nameTh) => ({ _id: id, nameTh });
const person = (code, position, department, role = 'employee') => ({
  code, name: `คน ${code}`, position, department, role,
});

const ROSTER = [
  person('PM00344', 'พนักงานผลิต1', dept(PROD1, 'แผนกผลิต1')),
  person('PM00345', 'พนักงานผลิต1', dept(PROD1, 'แผนกผลิต1')),
  person('PM00346', 'หัวหน้ากลุ่มงานผลิต1', dept(PROD1, 'แผนกผลิต1'), 'supervisor'),
  person('PM00347', 'ผู้ช่วยวิศวกรวิจัยและออกแบบผลิตภัณฑ์', dept(RND, 'แผนกออกแบบและวิจัยผลิตภัณฑ์')),
  person('PM00348', 'ผู้จัดการแผนกวิจัยและออกแบบผลิตภัณฑ์', dept(RND, 'แผนกออกแบบและวิจัยผลิตภัณฑ์'), 'dept_manager'),
];
const NONE = { position: '', department: '', role: '' };

// ── the rows the three boxes leave ──────────────────────────────────────────

test('ไม่ได้ตั้งอะไรไว้ = ทุกแถวผ่าน และได้อาร์เรย์เดิมกลับมา', () => {
  // Identity, not just equality: the screen memoises on this, and a fresh copy
  // of 164 rows on every keystroke in the search box re-renders the table for
  // no change. Same bargain `searchPeople` makes.
  assert.equal(filterRoster(ROSTER, NONE), ROSTER);
  assert.equal(anyFilter(NONE), false);
  assert.equal(anyFilter({ ...NONE, role: 'supervisor' }), true);
});

test('แต่ละกล่องกรองคอลัมน์ของตัวเอง และสามกล่องรวมกันแบบ และ', () => {
  const inProd1 = filterRoster(ROSTER, { ...NONE, department: PROD1 });
  assert.deepEqual(inProd1.map((p) => p.code), ['PM00344', 'PM00345', 'PM00346']);

  const supervisors = filterRoster(ROSTER, { ...NONE, role: 'supervisor' });
  assert.deepEqual(supervisors.map((p) => p.code), ['PM00346']);

  // AND, never OR: แผนกผลิต1 กับ บทบาทหัวหน้างาน คือคนเดียว ไม่ใช่สี่คน
  const both = filterRoster(ROSTER, { ...NONE, department: PROD1, role: 'supervisor' });
  assert.deepEqual(both.map((p) => p.code), ['PM00346']);

  // A combination nobody is in is an empty table, not a silently ignored filter.
  assert.deepEqual(filterRoster(ROSTER, { ...NONE, department: RND, role: 'supervisor' }), []);
});

test('แถวที่ยังไม่ระบุตำแหน่ง หาเจอได้ด้วยค่า BLANK — และ BLANK ไม่ใช่ค่าว่าง', () => {
  /**
   * No row on the real roster is missing either column today. It is here
   * because the CSV import does not require them, and a blank nobody can filter
   * for is a blank nobody can find to fix.
   *
   * BLANK MUST NOT BE `''`, which the boxes already spend on ทุกตำแหน่ง: "do
   * not narrow this" and "narrow to the ones with nothing in it" are different
   * instructions and would otherwise be the same keystroke.
   */
  const roster = [...ROSTER, person('PM00349', '', dept(PROD1, 'แผนกผลิต1'))];
  assert.notEqual(BLANK, '');
  assert.deepEqual(
    filterRoster(roster, { ...NONE, position: BLANK }).map((p) => p.code),
    ['PM00349'],
  );
  const list = facetOptions(roster, NONE, 'position');
  const blankRow = list.find((o) => o.value === BLANK);
  assert.equal(blankRow.label, BLANK_LABEL);
  // …and it is filed at the end: it is the row about rows that are missing
  // something, and it belongs under the ones that are not.
  assert.equal(list.at(-1).value, BLANK);
});

// ── what the boxes offer ────────────────────────────────────────────────────

test('ตัวเลือกมาจากทะเบียนจริง พร้อมจำนวนคนของแต่ละแถว', () => {
  const list = facetOptions(ROSTER, NONE, 'position');
  const byValue = Object.fromEntries(list.map((o) => [o.value, o.count]));
  assert.equal(byValue['พนักงานผลิต1'], 2);
  assert.equal(byValue['หัวหน้ากลุ่มงานผลิต1'], 1);
  assert.equal(list.length, 4, 'ตำแหน่งที่ไม่มีใครถืออยู่ ต้องไม่อยู่ในลิสต์');

  // แผนก is offered by id and named by nameTh — two แผนก may share a name, and
  // the id is what the table's own cell is keyed on.
  const depts = facetOptions(ROSTER, NONE, 'department');
  assert.deepEqual(depts.map((o) => [o.value, o.count]), [[PROD1, 3], [RND, 2]]);
  assert.equal(depts.find((o) => o.value === PROD1).label, 'แผนกผลิต1');
});

test('บทบาทเรียงตามลำดับของ lib/roles.js ไม่ใช่ตามตัวอักษร', () => {
  // พนักงาน · หัวหน้างาน · ผู้จัดการแผนก — lowest first, which is the order the
  // whole app uses. Alphabetically ผู้ดูแลระบบ would stand above พนักงาน for a
  // reason no reader could name.
  assert.deepEqual(
    facetOptions(ROSTER, NONE, 'role').map((o) => o.value),
    ['employee', 'supervisor', 'dept_manager'],
  );
});

test('เลือกแผนกแล้ว กล่องตำแหน่งเหลือเฉพาะตำแหน่งในแผนกนั้น', () => {
  /**
   * THE RULE THE WHOLE FILE IS FOR. Without it a reader picks แผนกผลิต1, opens
   * ตำแหน่ง, takes one of the thirty-odd titles from another แผนก and gets an
   * empty table — a dead end built out of two controls that were each behaving
   * correctly.
   */
  const list = facetOptions(ROSTER, { ...NONE, department: PROD1 }, 'position');
  assert.deepEqual(
    list.map((o) => o.value),
    ['พนักงานผลิต1', 'หัวหน้ากลุ่มงานผลิต1'],
  );
  // …and the counts follow the same narrowing, or the number beside a row would
  // be a promise about a table it cannot produce.
  assert.equal(list.find((o) => o.value === 'พนักงานผลิต1').count, 2);

  // The box being built never narrows itself: แผนก still offers both, or
  // choosing one would be the last thing anybody could do with that box.
  assert.equal(facetOptions(ROSTER, { ...NONE, department: PROD1 }, 'department').length, 2);
});

test('ค่าที่เลือกค้างอยู่ไม่หายจากลิสต์ของตัวเอง แม้กล่องอื่นจะกรองจนไม่เหลือใคร', () => {
  /**
   * ⚠ A dropdown that does not contain the value it is DISPLAYING is a control
   * that cannot be read and cannot be pressed back to where it was: the only
   * way out would be ล้างตัวกรอง, which throws away the other two choices too.
   * It is drawn with `count: 0`, which says exactly what happened — and it is
   * still named, which is why the whole register goes in as the last argument.
   */
  const filters = { ...NONE, department: RND, position: 'พนักงานผลิต1' };
  const list = facetOptions(filterRoster(ROSTER, filters), filters, 'position', ROSTER);
  const stuck = list.find((o) => o.value === 'พนักงานผลิต1');
  assert.ok(stuck, 'ตำแหน่งที่เลือกอยู่หลุดออกจากลิสต์ — กดกลับไม่ได้แล้ว');
  assert.equal(stuck.count, 0);
});

test('พิมพ์ในลิสต์ตำแหน่ง — ทุกคำต้องเจอ สลับลำดับได้ และช่องว่างไทยไม่สำคัญ', () => {
  // The rule is lib/personSearch.js's with the code half off; the terms are why
  // ผู้จัดการ ผลิต finds a title that spells them four syllables apart.
  assert.equal(textMatches('ผู้จัดการแผนกผลิต1', 'ผู้จัดการ ผลิต'), true);
  assert.equal(textMatches('ผู้จัดการแผนกผลิต1', 'ผลิต ผู้จัดการ'), true);
  assert.equal(textMatches('หัวหน้า กลุ่มงานผลิต1', 'หัวหน้ากลุ่ม'), true);
  assert.equal(textMatches('พนักงานผลิต1', 'ผู้จัดการ'), false);
  // An empty query is no filter at all, never "no matches".
  assert.equal(textMatches('พนักงานผลิต1', '   '), true);
});

// ── the bar ─────────────────────────────────────────────────────────────────

test('สามกล่องอยู่บนแถบเดียวกับช่องค้นหา — ไม่ใช่บาร์ที่สอง', () => {
  // *"เพิ่มไว้แถวเดียวกับ ช่องค้นหา"*, 2026-09-14. One `.queue-tools` on this
  // screen, with the search box first and the three boxes after it.
  const bars = employees.match(/className="queue-tools[^"]*"/g) || [];
  assert.equal(bars.length, 1, 'ทะเบียนพนักงานมีแถบตัวกรองมากกว่าหนึ่งแถบ');
  const bar = employees.slice(
    employees.indexOf('<div className="queue-tools'),
    employees.indexOf('An empty table after a search'),
  );
  assert.ok(bar.includes('<Field label="ค้นหาพนักงาน"'), 'ช่องค้นหาไม่ได้อยู่บนแถบนี้แล้ว');
  assert.match(bar, /FACET_KEYS\.map\(\(key\) => \(\s*<PickOne/);
  assert.ok(
    bar.indexOf('<Field label="ค้นหาพนักงาน"') < bar.indexOf('<PickOne'),
    'ช่องค้นหาต้องมาก่อนสามกล่อง',
  );
});

test('สามกล่องเป็น PickOne ของแอป และแถวแรกคือ ทุก…', () => {
  // NOT a `<select>`: test/noNativeSelect.test.js is the app-wide version of
  // this, and `allLabel` is the one press back to an unfiltered list.
  for (const all of ['ทุกตำแหน่ง', 'ทุกแผนก', 'ทุกบทบาท']) {
    assert.ok(read('lib/rosterFilters.js').includes(`all: '${all}'`), `${all} หายไป`);
  }
  assert.match(employees, /allLabel=\{FACETS\[key\]\.all\}/);
  assert.match(employees, /options=\{facets\[key\]\}/);
  // The count beside every row is `PickOne`'s own `.ct` column — the options
  // carry it, so nothing here has to draw it.
  assert.match(read('lib/rosterFilters.js'), /count: 1,/);
});

test('ช่องพิมพ์ในลิสต์เปิดเฉพาะตำแหน่ง ซึ่งเป็นกล่องเดียวที่ยาวสี่สิบแถว', () => {
  assert.match(employees, /searchable=\{key === 'position'\}/);
  // The control itself lives in the shared kit, not on this screen — the next
  // long list gets it with one prop. AGENTS.md §Inherit before you invent.
  assert.match(common, /searchable = false,/);
  assert.match(common, /searchPlaceholder = 'พิมพ์เพื่อกรองรายการ…',/);
  // ทุกตำแหน่ง is never filtered out: it is a command, not an option, and three
  // letters must not be able to hide the row that undoes the three letters.
  assert.match(common, /allRows\.filter\(\(r\) => r\.value === '' \|\| textMatches\(r\.label, query\)\)/);
  // The closed box reads its label off the WHOLE list, or a filtered-out
  // selection would leave it saying ทุกตำแหน่ง while a ตำแหน่ง is in force.
  assert.match(common, /const picked = allRows\.find\(\(r\) => String\(r\.value\) === current\);/);
});

test('ล้างตัวกรองล้างทั้งสี่ช่อง และโผล่เฉพาะตอนมีอะไรให้ล้าง', () => {
  // Asked for that way: the reader pressing it wants the whole register back,
  // and a button that leaves the search box narrowing the table has not done
  // what its label says. Twice — on the bar, and inside the empty state.
  const presses = employees.match(/setFind\(''\); setFilters\(NO_FILTERS\);/g) || [];
  assert.equal(presses.length, 2, 'ล้างตัวกรองต้องมีทั้งบนแถบและในข้อความว่าง');
  assert.match(employees, /\{\(find \|\| filtering\) && \(\s*\n\s*<button/);
  assert.match(admin, /const NO_FILTERS = Object\.freeze\(Object\.fromEntries\(FACET_KEYS/);
});

test('บรรทัดนับขึ้นเมื่อกรองด้วยกล่องเหมือนกับตอนพิมพ์ค้นหา', () => {
  // A filtered table is a table lying by omission; a chosen ตำแหน่ง is easier
  // to scroll past than a query, because it looks like a heading.
  assert.match(
    employees,
    /\{\(find \|\| filtering\) && \(\s*\n\s*<div className="found">/,
  );
  assert.match(employees, /แสดง <strong>\{shown\.length\}<\/strong> จาก <strong>\{rows\.length\}<\/strong> คน/);
});

test('ตารางวาดจากแถวที่ผ่านทั้งคำค้นและสามกล่อง และหน้ารีเซ็ตเมื่อกรอง', () => {
  assert.match(employees, /const searched = React\.useMemo\(\(\) => searchPeople\(rows, find\), \[rows, find\]\);/);
  assert.match(employees, /const shown = React\.useMemo\(\(\) => filterRoster\(searched, filters\), \[searched, filters\]\);/);
  // The boxes count against the SEARCH RESULT — a list of ตำแหน่ง has to
  // describe rows the reader can currently see.
  assert.match(employees, /facetOptions\(searched, filters, k, rows\)/);
  // Page 5 of a list that just became seven rows long is an empty table under a
  // band reading หน้า 5 / 1.
  assert.match(employees, /usePageReset\(setPage, \[find, filters, pageSize\]\);/);
});

test('ข้อความว่างบอกว่ากรองด้วยอะไรอยู่ ไม่ใช่แค่ว่าไม่พบ', () => {
  assert.match(employees, /\{\(find \|\| filtering\) && shown\.length === 0 \?/);
  // The search half keeps its old sentence word for word, including the clause
  // naming what this box can and cannot search.
  assert.match(employees, /ไม่พบพนักงานที่ตรงกับ “\{find\}”/);
  assert.match(employees, /ค้นได้จากรหัสพนักงานและชื่อ-สกุลเท่านั้น/);
  assert.match(employees, /\{filtering && <div>\{filterWords\}<\/div>\}/);
  // …and the words are read off the options, where the labels already are: a
  // แผนก is an id in `filters`, and a second lookup table would drift.
  assert.match(employees, /const filterWords = FACET_KEYS/);
});

test('แถวใหม่ต้องไม่ตกนอกตัวกรองที่เปิดค้างไว้', () => {
  // The search box has had this since it was written; the boxes can hide a new
  // row just as completely — HR filters to แผนกผลิต1 and adds somebody in
  // แผนกไอที, and the screen looks like the create failed.
  assert.match(
    employees,
    /if \(filtering && filterRoster\(\[values\], filters\)\.length === 0\) setFilters\(NO_FILTERS\);/,
  );
});

// ── the phone, and the panel with a box in it ───────────────────────────────

test('มือถือ: ช่องค้นหาเต็มบรรทัด สองกล่องคู่กัน บทบาทเต็มบรรทัด', () => {
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.queue-tools\.roster-tools \.field:not\(\.search\) \{ flex: 1 1 calc\(50% - 6px\); min-width: 0; \}/);
  assert.match(phone, /\.queue-tools\.roster-tools \.field\.roster-wide \{ flex: 1 1 100%; \}/);
  // `roster-wide` is put on บทบาท by the screen — the third of three, which
  // would otherwise sit alone in a half-width column beside an empty space.
  assert.match(employees, /className=\{key === 'role' \? 'roster-wide' : undefined\}/);
  // The search box is NOT in that rule: it is typed into, and a Thai name in a
  // half-width box is a box you cannot read back what you put in.
  assert.match(phone, /\.queue-tools \.field, \.queue-tools \.field\.search \{ flex: 1 1 100%; \}/);
});

test('แผงที่มีช่องค้นหาเป็นแผงเดียว ไม่ใช่กล่องลอยซ้อนอีกใบ', () => {
  /**
   * `.pop.one-pop` draws nothing, because the `<ul>` inside it already draws a
   * fill, an edge, a shadow and a corner — right while the list is the panel's
   * only child. With a search box above it that would leave the box outside the
   * panel it belongs to, floating on the page with no ground under it. So the
   * shell draws the panel and the list gives its own up, exactly as
   * `.pop.sheet.one-pop` does for a phone.
   */
  assert.match(css, /\.pop\.one-pop:not\(\.sheet\):has\(> \.one-search\) \{/);
  assert.match(css, /\.pop\.one-pop:not\(\.sheet\):has\(> \.one-search\) \.pick-menu \{\n\s*padding: 0; background: none; border: 0; border-radius: 0; box-shadow: none;/);
  // A rule under the box rather than a gap: the rows scroll and the box does
  // not, so the reader needs to see where the scrolling part starts.
  assert.match(css, /\.one-search \{ padding-bottom: 6px; margin-bottom: 4px; border-bottom: 1px solid var\(--line-soft\); \}/);
  // The box is a `.field`, which is the only rule in this app that gives an
  // input its width, fill, radius, padding and focus ring.
  /* THE COMMENTS COME OUT FIRST, and the reason is on the record three times
     over in this repository: the note above that wrapper explains the bug by
     quoting `<input>` and `<div>`, so a plain `indexOf('<input')` finds the
     PROSE and reports the markup in the wrong order. */
  const at = common.indexOf('<div className="one-search">');
  const box = common.slice(at, common.indexOf('<ul', at))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(box.includes('<div className="field">'), 'ช่องค้นหาในแผงอยู่นอก .field');
  assert.ok(box.indexOf('<div className="field">') < box.indexOf('<input'), 'ช่องค้นหาในแผงอยู่นอก .field');
});

test('พิมพ์ในแผงแล้วปุ่มไม่ปิดลิสต์ทิ้ง — และคำค้นหายไปกับแผงเสมอ', () => {
  /**
   * The focus leaves the button the moment the panel opens (it goes into the
   * box), so the old `onBlur={() => setOpen(false)}` would shut the list on the
   * same frame it was opened. `Popover` closes on Escape, on a press outside and
   * on a scroll; the box's own blur covers Tab.
   */
  assert.match(common, /onBlur=\{\(\) => \{ if \(!searchable\) setOpen\(false\); \}\}/);
  // Cleared on the way out AND on the way in: a query left behind is a list
  // that opens already narrowed by something nobody can see a reason for.
  // จบที่ `PickMany` ซึ่งมาต่อท้ายตั้งแต่ 2026-09-16 — สองคอมโพเนนต์ใช้แผงเดียวกัน
  // และเคลียร์คำค้นด้วยเหตุผลเดียวกัน แต่ข้อนี้นับของ PickOne เท่านั้น
  const pickOne = common.slice(common.indexOf('export function PickOne('), common.indexOf('export function PickMany('));
  assert.equal((pickOne.match(/setQuery\(''\)/g) || []).length, 5);
  // No type-ahead where there is a box to type in — one behaviour, not two.
  assert.match(common, /if \(!searchable && e\.key\.length === 1/);
});

test('กดกล่องซ้ำตอนแผงเปิดอยู่ ต้องปิด ไม่ใช่ปิดแล้วเปิดใหม่', () => {
  /**
   * A pointer pressing the box while the panel is up fires mousedown → blur →
   * click, and that blur belongs to the SEARCH FIELD, which closes the panel.
   * By the time the click lands `open` is already false, so a plain toggle
   * opens it straight back up — the box becomes unclosable by the control that
   * opened it. Answered on mousedown instead, before the blur, with
   * `preventDefault` so the sequence never starts.
   */
  assert.match(common, /onMouseDown=\{\(e\) => \{\s*\n\s*if \(!searchable\) return;\s*\n\s*e\.preventDefault\(\);/);
  assert.match(common, /if \(open\) close\(\); else \{ openList\(\); btnRef\.current\?\.focus\(\); \}/);
  // …and the click handler stands down where mousedown answered it, or the two
  // would both fire and cancel each other out.
  assert.match(common, /if \(searchable\) return;\s*\n\s*if \(open\) setOpen\(false\); else openList\(\);/);
});

test('ช่องค้นหาในแผงบอกได้ว่ากำลังคุมลิสต์ไหน และยืนอยู่แถวไหน', () => {
  // While this box holds the focus, ↑/↓ move a highlight the reader cannot see
  // — `aria-activedescendant` is the only thing that says which row Enter takes.
  // The same five attributes `PickPerson` carries, for the same reason.
  const at = common.indexOf('<div className="one-search">');
  const box = common.slice(at, common.indexOf('<ul', at));
  assert.match(box, /role="combobox"/);
  assert.match(box, /aria-expanded/);
  assert.match(box, /aria-controls=\{`\$\{id\}-list`\}/);
  assert.match(box, /aria-autocomplete="list"/);
  assert.match(box, /aria-activedescendant=\{rows\[at\] \? `\$\{id\}-\$\{at\}` : undefined\}/);
  // The list it points at is the one the panel draws.
  assert.match(common, /id=\{`\$\{id\}-list`\}/);
});

test('ทั้งสามคอลัมน์ที่กรองได้ เป็นคอลัมน์ที่ตารางวาดอยู่จริง', () => {
  // A filter for a column nobody can see is a filter nobody can check. All
  // three are `<th>`s on this table, and the order on the bar follows the table.
  assert.deepEqual(FACET_KEYS, ['position', 'department', 'role']);
  for (const head of ['<th>ตำแหน่ง</th>', '<th>แผนก</th>']) {
    assert.ok(employees.includes(head), `${head} หายไปจากตาราง`);
  }
  assert.match(employees, /<th>บทบาท<\/th>/);
});
