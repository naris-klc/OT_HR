import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { personMatches, queryTerms, searchPeople } from '../lib/personSearch.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ค้นหาพนักงานจากรหัสหรือชื่อ — กรองตามพนักงาน on ประวัติการแก้ทะเบียน.
 *
 * The roster below is the shape the real one has and not a tidy one: both code
 * spellings, a THT code, two people whose given names begin the same way, and
 * two whose family names do. Every assertion here is a thing somebody would
 * actually type.
 */
const ROSTER = [
  { _id: '1', code: 'PM-0412', name: 'สมชาย ใจดี' },
  { _id: '2', code: 'PM00511', name: 'สมใจ มั่งมี' },
  { _id: '3', code: 'PM-0620', name: 'พรทิพย์ สายเพชร' },
  { _id: '4', code: 'THT00111', name: 'น้ำใจ มีสุข' },
  { _id: '5', code: 'HR-001', name: 'ฝ่ายบุคคล' },
];

const codes = (q) => searchPeople(ROSTER, q).map((p) => p.code);

// ── the two examples in the request ─────────────────────────────────────────

test('พิมพ์ 0412 → PM-0412 · สมชาย ใจดี', () => {
  assert.deepEqual(codes('0412'), ['PM-0412']);
});

test('พิมพ์ สมชาย → PM-0412 · สมชาย ใจดี', () => {
  assert.deepEqual(codes('สมชาย'), ['PM-0412']);
});

// ── the hyphen is noise, in both directions ─────────────────────────────────

test('a hyphenated code is found without the hyphen, and the reverse', () => {
  // The roster carries both spellings and always will — see
  // src/lib/employeeCode.js. Somebody reading a code off a printed sheet types
  // what habit gives them, not what that particular row happens to store.
  assert.deepEqual(codes('PM0412'), ['PM-0412']);
  assert.deepEqual(codes('PM-00511'), ['PM00511']);
  assert.deepEqual(codes('pm 0412'), ['PM-0412']);
});

test('searching by code is case-blind', () => {
  assert.deepEqual(codes('tht'), ['THT00111']);
  assert.deepEqual(codes('Tht00111'), ['THT00111']);
});

test('a prefix narrows to the company that uses it', () => {
  assert.deepEqual(codes('pm'), ['PM-0412', 'PM00511', 'PM-0620']);
});

// ── a name is not a code ────────────────────────────────────────────────────

test('a term with Thai in it never reaches the code test', () => {
  /**
   * `normalizeCode` keeps [A-Za-z0-9] and drops the rest — Thai as readily as
   * a hyphen. So "0412สมชาย" normalises to "0412", and a code test taking that
   * at face value would return PM-0412 for a query whose name half was thrown
   * away unread. It is one string, and it matches nobody: no row is called
   * "0412สมชาย".
   */
  assert.deepEqual(codes('0412สมชาย'), []);
});

test('the space between given and family name is optional', () => {
  // Thai sets no space between words. The one in "สมชาย ใจดี" separates the
  // two names and is exactly the keystroke somebody typing fast leaves out.
  assert.deepEqual(codes('สมชายใจดี'), ['PM-0412']);
  assert.deepEqual(codes('สมชาย ใจดี'), ['PM-0412']);
});

test('a fragment of a family name finds everybody who shares it', () => {
  assert.deepEqual(codes('ใจ'), ['PM-0412', 'PM00511', 'THT00111']);
});

// ── terms narrow together, in any order ─────────────────────────────────────

test('a code and a name in one query narrow to the person who is both', () => {
  assert.deepEqual(codes('0412 สมชาย'), ['PM-0412']);
  // Word order is not something anybody gets right against a list they cannot
  // see yet, so it must not matter.
  assert.deepEqual(codes('สมชาย 0412'), ['PM-0412']);
});

test('terms that contradict each other match nobody', () => {
  // Not "the last term wins" and not "either term will do": both have to hold,
  // or narrowing would widen and the list would grow as you typed.
  assert.deepEqual(codes('0412 สมใจ'), []);
});

// ── the query that is not a query ───────────────────────────────────────────

test('an empty query is no filter at all, not an empty result', () => {
  assert.equal(searchPeople(ROSTER, '').length, ROSTER.length);
  assert.equal(searchPeople(ROSTER, '   ').length, ROSTER.length);
  assert.equal(searchPeople(ROSTER, null).length, ROSTER.length);
  assert.equal(searchPeople(ROSTER, undefined).length, ROSTER.length);
  assert.deepEqual(queryTerms('  \t '), []);
  /**
   * AND IT IS THE SAME ARRAY, not an equal one — the promise callers memoise
   * against. `shown` on ตรวจสอบรายเดือน and on ทะเบียนพนักงาน is derived from
   * this on every render; an identical-but-new array on the cleared box
   * rebuilds a list of forty rows on every keystroke that empties it.
   *
   * Moved here from test/proxyTeamSearch.test.js on 2026-09-01, when the
   * search box over บันทึกแทนพนักงาน came out and that file stopped calling
   * this module at all. It is a fact about the module, and it was only ever
   * written down beside its fourth caller.
   */
  assert.equal(searchPeople(ROSTER, ''), ROSTER, 'the cleared box rebuilt the list');
  assert.equal(searchPeople(ROSTER, '   '), ROSTER);
});

test('a lone separator does not match the entire roster', () => {
  /**
   * "-" and "·" both normalise to '', and `'PM0412'.includes('')` is true of
   * every string on earth. Without the guard in `termMatches` one hyphen —
   * a single keystroke on the way to typing a code, and the character the list
   * itself prints between code and name — would silently return everybody
   * while looking like a search that had found them.
   */
  assert.deepEqual(codes('-'), []);
  assert.deepEqual(codes('·'), []);
});

test('nonsense matches nobody rather than everybody', () => {
  assert.deepEqual(codes('zzzz'), []);
  assert.deepEqual(codes('9999'), []);
});

// ── shape ───────────────────────────────────────────────────────────────────

test('the roster comes back in the order it went in', () => {
  // The control this feeds replaced a <select>. A list that reshuffles itself
  // as you type is a list you cannot aim at, so narrowing is the whole of the
  // behaviour — no ranking, no promoting exact matches to the top.
  assert.deepEqual(codes('pm'), ['PM-0412', 'PM00511', 'PM-0620']);
  assert.deepEqual(searchPeople(ROSTER, '').map((p) => p.code), ROSTER.map((p) => p.code));
});

test('a row with no code or no name does not throw', () => {
  // The roster is imported from CSV and edited by hand; a half-filled row is
  // a thing that happens, and a search box is not where it should surface.
  const ragged = [{ _id: '9' }, { _id: '8', code: 'PM-0001' }, { _id: '7', name: 'ก' }];
  assert.doesNotThrow(() => searchPeople(ragged, 'pm'));
  assert.deepEqual(searchPeople(ragged, 'pm').map((p) => p._id), ['8']);
  assert.deepEqual(searchPeople(ragged, 'ก').map((p) => p._id), ['7']);
});

test('a people argument that is not a list is an empty roster, not a crash', () => {
  // It arrives from a fetch that may not have answered yet.
  assert.deepEqual(searchPeople(undefined, 'x'), []);
  assert.deepEqual(searchPeople(null, ''), []);
});

test('personMatches and searchPeople agree', () => {
  for (const q of ['0412', 'สมชาย', 'pm', '', '-', 'zzz', 'สมชาย 0412']) {
    assert.deepEqual(
      ROSTER.filter((p) => personMatches(p, q)),
      searchPeople(ROSTER, q),
      q,
    );
  }
});

// ── the control the rule is for ─────────────────────────────────────────────

/**
 * `PickPerson`'s source, AND NOTHING AFTER IT.
 *
 * It read `src.slice(at)` — to the end of the file — until 2026-09-01, which
 * was only ever right because PickPerson happened to be the last thing in
 * common.jsx. `PickOne` was added below it that day and the count below went
 * from 2 to 3 without a line of PickPerson changing: a test that reports a
 * safety property of one control while measuring two.
 *
 * The end is the next top-level `export`, or the end of the file when there is
 * none — so this stays true whichever side of PickPerson the next component
 * lands on.
 */
const pick = (() => {
  const src = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  const at = src.indexOf('export function PickPerson(');
  assert.ok(at > 0, 'PickPerson หายไปจาก common.jsx');
  const rest = src.slice(at);
  const next = rest.indexOf('\nexport ', 1);
  return next < 0 ? rest : rest.slice(0, next);
})();

test('typing never changes who is chosen — only picking a row does', () => {
  /**
   * The whole safety of the control. `query` is what has been typed since the
   * box was opened; `value` is who is filtering the list below. If abandoning a
   * half-typed search could clear the filter, or leave text on screen that
   * disagrees with it, the screen would be lying about whose history it is
   * showing — on the one screen whose entire job is being the record of who
   * changed what.
   *
   * So `onChange` — the caller's setter, the only thing that can move the
   * filter — may be called from exactly three places: picking a row, the ✕,
   * and nowhere else.
   */
  const calls = pick.match(/onChange\(/g) || [];
  assert.equal(calls.length, 2, `onChange ถูกเรียก ${calls.length} ครั้ง — ต้องเป็น 2 (เลือกแถว กับ ปุ่ม ✕)`);
  assert.match(pick, /function pick\(row\) \{\s*onChange\(row\.value\);/);

  // And abandoning restores rather than commits: `revert` puts the typed text
  // back to null, which is what makes the box show the chosen person again.
  assert.match(pick, /function revert\(\) \{[^}]*setQuery\(null\)/);
  assert.match(pick, /onBlur=\{revert\}/);
});

/** The shared ✕, which is its own component since ทะเบียนพนักงาน grew one too. */
const clearBtn = (() => {
  const src = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  const at = src.indexOf('export function ClearButton(');
  assert.ok(at > 0, 'ClearButton หายไปจาก common.jsx');
  return src.slice(at, src.indexOf('export function PickPerson('));
})();

test('the ✕ goes back to ทุกคน in one press', () => {
  // PickPerson's ✕ clears all three at once: the caller's filter, the typed
  // text, and the open list. Anything left behind would be a box that says one
  // thing while the report below it shows another.
  assert.match(pick, /<ClearButton/);
  assert.match(pick, /onClear=\{\(\) => \{ onChange\(''\); setQuery\(null\); setOpen\(false\); \}\}/);
  // A real button, with a name for anybody who cannot see the glyph.
  assert.match(clearBtn, /type="button"/);
  assert.match(clearBtn, /aria-label=\{label\}/);
  assert.match(clearBtn, /className="searchbox-clear"/);
});

test('a click on a row is not lost to the blur that precedes it', () => {
  // mousedown moves focus, focus leaves the input, `revert()` unmounts the
  // list — and the click lands on nothing. Prevented on the container rather
  // than on each row, so a drag to scroll on a touch screen is still a scroll.
  assert.match(pick, /className="pick-menu"[\s\S]{0,600}onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  // The ✕ sits inside a focused box and needs the same guard. It lives in
  // ClearButton rather than at each caller — it costs nothing where there is
  // no blur handler to race, and leaving it out is invisible until a click
  // silently does nothing.
  assert.match(clearBtn, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
});

test('one row is highlighted, and it is the one Enter takes', () => {
  // Hover as a second CSS-only highlight is the bug this avoids: the mouse
  // rests on one row while the arrows are on another, two light up, and Enter
  // takes the one the eye is not on. The pointer writes to the same state.
  assert.match(pick, /onMouseMove=\{\(\) => setActive\(i\)\}/);
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.match(css, /\.pick-menu li\[data-active='1'\]/);
  assert.doesNotMatch(css, /\.pick-menu li:hover/);
});

test('the roster picker is used where the list is long and nowhere else', () => {
  /**
   * A combobox on a four-option filter is worse than the <select> it replaced:
   * it gives up the operating system's own picker on a phone and asks somebody
   * to type where one tap used to do. กรองตามพนักงาน holds the roster; the
   * three filters beside it hold four, ten, and however many accounts have
   * ever written to the trail.
   */
  /**
   * COMMENTS COME OFF FIRST, the same stripper theme.test.js needs and for the
   * same reason. The comment introducing this very control contains the words
   * "a <select> is the right control for those" — and counted as markup that
   * sentence is a fourth dropdown. A test that prose can satisfy, or break, is
   * not testing the screen.
   */
  const admin = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Prove the stripper works, or the counts below mean nothing.
  assert.doesNotMatch(admin, /is the right control for those/, 'ตัวตัดคอมเมนต์ไม่ทำงาน');
  assert.equal((admin.match(/<PickPerson/g) || []).length, 1);
  const filters = admin.slice(admin.indexOf('กรองตามพนักงาน'), admin.indexOf('ล้างตัวกรองทั้งหมด'));
  assert.equal((filters.match(/<select/g) || []).length, 3, 'ตัวกรองที่รายการสั้นต้องยังเป็น <select>');
});

test('the rows are a real touch target on a phone', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.pick-menu li \{ min-height: 44px; \}/);
  assert.match(phone, /\.searchbox-clear \{ width: 44px; height: 44px/);
});

// ── ค้นหาในทะเบียนพนักงาน ────────────────────────────────────────────────────

const employees = (() => {
  const src = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  const at = src.indexOf('function Employees({ user })');
  assert.ok(at > 0, 'Employees หายไปจาก AdminView.jsx');
  return src.slice(at, src.indexOf('function AddEmployee('));
})();

test('the roster table draws the narrowed list, not the register', () => {
  /**
   * The bug this pins is a one-word one and it renders perfectly: the box
   * filters `shown`, the table maps `rows`, and typing does nothing at all
   * while the count beside the box counts down. Both names are in scope, both
   * are arrays of the same shape, and nothing but this notices.
   */
  assert.match(employees, /const shown = React\.useMemo\(\(\) => searchPeople\(rows, find\), \[rows, find\]\)/);
  assert.match(employees, /\{shown\.map\(\(p\) => \(/, 'ตารางต้องวาดจาก shown');
  assert.ok(!/\{rows\.map\(\(p\) => \(/.test(employees), 'ตารางต้องไม่วาดจาก rows');
});

test('the count is measured against the whole register', () => {
  // "แสดง 3 จาก 3 คน" would be true of every search ever made and would say
  // nothing. The point of the line is the gap between the two numbers.
  assert.match(employees, /\{shown\.length\}<\/strong> จาก <strong>\{rows\.length\}/);
});

test('an empty result says so in words rather than drawing an empty table', () => {
  /**
   * Nine columns of headings over nothing, on a screen whose ordinary content
   * is the entire company, reads as breakage rather than as "no match" — and
   * the query is quoted back so a typo is visible.
   */
  assert.match(employees, /find && shown\.length === 0 \?/);
  assert.match(employees, /ไม่พบพนักงานที่ตรงกับ [“{]/);
  assert.match(employees, /\{find\}/);
});

test('the search survives an edit, and is not sent to the server', () => {
  /**
   * `find` is a view of rows that are already here — `/employees?all=1` has no
   * limit — so it must not be part of `load()`. Two things follow: fixing
   * somebody's วันเกิด reloads the table still showing the person being worked
   * on rather than throwing you back to the top of the register, and no
   * keystroke costs a request.
   */
  const load = employees.slice(employees.indexOf('async function load()'), employees.indexOf('useEffect(() => { load(); }'));
  assert.ok(!/find/.test(load), 'load() ต้องไม่รู้จักคำค้น');
  assert.ok(!/api\.get\([^)]*find/.test(employees), 'คำค้นต้องไม่ถูกส่งไปเซิร์ฟเวอร์');
});

test('a new row is never hidden behind a filter that was already on', () => {
  /**
   * HR searches for somebody, does not find them, and adds them — with the
   * search that just failed still narrowing the table. The new row lands
   * outside it and the screen looks like the create failed.
   *
   * Cleared only when it WOULD hide them, so a filter that still matches is
   * left alone rather than reset under somebody mid-task.
   */
  assert.match(employees, /if \(find && !personMatches\(who, find\)\) setFind\(''\)/);
});

/** The whole search box, from its wrapper to the table it sits over. */
const findBox = employees.slice(
  employees.indexOf('className="roster-find"'),
  employees.indexOf('An empty table after a search'),
);

test('the roster box is a search box, not a second combobox', () => {
  /**
   * They ask the same rule and share the box and the ✕, and that is the whole
   * of the overlap. กรองตามพนักงาน commits a value — it picks one person for a
   * report to be filtered by. This one commits nothing: it narrows the table in
   * front of you, and the table is the answer. Giving it a popup listbox would
   * put a list of names over the list of names it is filtering.
   */
  assert.ok(!/PickPerson|role="combobox"|role="listbox"/.test(findBox), 'ช่องนี้ต้องไม่ใช่ combobox');
  assert.match(findBox, /<ClearButton onClear=\{\(\) => setFind\(''\)\}/);
});

test('the search box is a Field, which is where every input style comes from', () => {
  /**
   * THIS IS A REGRESSION TEST FOR SOMETHING THAT SHIPPED. The box went out as a
   * bare <input> in a bare <div>, outside the `.field` wrapper, and drew at the
   * browser's default width of about twenty characters with the browser's own
   * border, no fill and no padding — a broken-looking stub in the corner of the
   * card. Nothing was missing from the stylesheet and nothing failed to
   * compile: `.field input` is simply the only rule in this app that gives an
   * input its width, background, radius, padding and focus ring, and the box
   * was outside its reach.
   *
   * Pinned from both ends, because either alone would pass while looking wrong:
   * the markup must be inside a <Field>, and the stylesheet must still hang
   * those properties off `.field input`.
   */
  assert.ok(
    findBox.indexOf('<Field') >= 0 && findBox.indexOf('<Field') < findBox.indexOf('<input'),
    'ช่องค้นหาต้องอยู่ใน <Field> ไม่งั้นจะไม่ได้สไตล์ของ input เลย',
  );
  assert.match(findBox, /label="ค้นหาพนักงาน"/, 'ต้องมี label กำกับ');
  // The accessible name matches the visible label — `Field` renders a bare
  // <label> with no `htmlFor`, so this is what is actually read out, and a name
  // that differs from the words on screen is worse than a plain one.
  assert.match(findBox, /aria-label="ค้นหาพนักงาน"/);

  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  // The selector grew a `:not()` pair on 2026-08-31 — a checkbox is an `input`
  // too, and this text-box rule had been giving every tick box in a `.field` a
  // 46px-tall plate. What that changed is which elements the rule REACHES;
  // what a search box gets from it is the list below, unchanged.
  const rule = css.slice(css.indexOf(".field input:not(:where([type='checkbox'], [type='radio'])),"));
  const body = rule.slice(0, rule.indexOf('}'));
  for (const prop of ['border:', 'border-radius:', 'padding:', 'background:', 'width: 100%']) {
    assert.ok(body.includes(prop), `.field input ต้องยังให้ ${prop}`);
  }
});

test('one ✕, shared, and both boxes use it', () => {
  // It went from being PickPerson's private markup to a component the day the
  // roster grew a box of its own. A second hand-rolled copy is how one of them
  // quietly loses its aria-label or its mousedown guard.
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  assert.equal((common.match(/className="searchbox-clear"/g) || []).length, 1);
  assert.equal((employees.match(/className="searchbox-clear"/g) || []).length, 0);
  assert.match(employees, /<ClearButton/);
});
