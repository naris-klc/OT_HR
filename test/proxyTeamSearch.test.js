import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { searchPeople } from '../lib/personSearch.js';

/**
 * ค้นหาชื่อเหนือกล่องเลือกลูกทีม — บันทึก OT แทนลูกทีม's own search box.
 *
 * THE ONE PROMISE THIS FILE EXISTS FOR: narrowing the list must never lose a
 * tick. A หัวหน้า files for a team by ticking names, and every route by which
 * a search could quietly drop one of them ends with a request filed for the
 * wrong person's month — which nothing on any screen afterwards would flag.
 * There are three such routes and all three are held below:
 *
 *   1. filtering `targets` instead of the list drawn from it,
 *   2. `เลือกทั้งหมด` REPLACING the selection with what is on screen,
 *   3. `เลือกทั้งหมด` reaching past the filter to the whole team.
 *
 * The rule itself is `lib/personSearch.js` and is tested there. What is
 * exercised here is the part of it this screen depends on, plus the wiring.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/**
 * The source with its comments taken out — the same stripper
 * test/holidayDeleteConfirm.test.js and test/modalCloseButton.test.js use.
 *
 * A BAN PROVES NOTHING WITHOUT IT, and this file caught itself: the check that
 * this box does not claim `role="combobox"` failed on the FIRST run against
 * the comment beside it explaining why it does not. That is the third time an
 * assertion on this screen's family has matched prose instead of code, and the
 * note over ตรวจสอบประจำเดือน's search box says so in as many words.
 *
 * IT IS THE OTHER TWO FILES' STRIPPER VERBATIM, and that is deliberate. This
 * file first shipped a third one that matched a brace-wrapped JSX comment as
 * its own pattern, ahead of the block rule — and the self-test below caught it
 * eating live code. Its non-greedy body ran from one JSX comment's opening
 * brace to the first comment-close that happened to be followed by a closing
 * brace, taking everything between two comments with it, `const shownTeam`
 * included; every ban in this file would then have passed against source it
 * could not see. The simple rule leaves a brace-wrapped comment behind as an
 * empty pair of braces, which costs nothing here.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(form);

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(form.includes('role="combobox"'), 'the comment this guards against is gone');
  assert.ok(!code.includes('role="combobox"'), 'the stripper left a comment behind');
  assert.ok(code.includes('const shownTeam'), 'the stripper ate the code as well');
  assert.ok(code.includes('placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"'));
});

/** The seed team a หัวหน้า of ENG actually sees. */
const TEAM = [
  { _id: '1', code: 'PM-0147', name: 'สุรชัย ดวงดี' },
  { _id: '2', code: 'PM-0388', name: 'ธนพล เกษมสุข' },
  { _id: '3', code: 'PM-0412', name: 'สมชาย ใจดี' },
];

// ── what the box has to match ──────────────────────────────────────────────

test('a name, a surname and a code all find the row', () => {
  const only = (q) => searchPeople(TEAM, q).map((p) => p.code);
  assert.deepEqual(only('สมชาย'), ['PM-0412'], 'ชื่อต้น');
  assert.deepEqual(only('ใจดี'), ['PM-0412'], 'นามสกุล');
  assert.deepEqual(only('สมชายใจดี'), ['PM-0412'], 'ชื่อติดกันไม่เว้นวรรค');
  assert.deepEqual(only('PM-0388'), ['PM-0388'], 'รหัสตามที่พิมพ์บนใบ');
  // Half this roster is written PM-0412 and half PM00511, both current — so
  // the hyphen a person types or omits cannot decide whether they find anyone.
  assert.deepEqual(only('PM0388'), ['PM-0388'], 'รหัสไม่มีขีด');
  assert.deepEqual(only('pm-0388'), ['PM-0388'], 'พิมพ์เล็ก');
  // Word order against a list you cannot see yet is not something anybody
  // gets right; each term may match a different part of the person.
  assert.deepEqual(only('0388 ธนพล'), ['PM-0388'], 'รหัสก่อนชื่อ');
  assert.deepEqual(only('ธนพล 0388'), ['PM-0388'], 'ชื่อก่อนรหัส');
  assert.deepEqual(only('zzz'), [], 'ไม่ตรงใครเลย');
});

test('an empty box is not a filter — and hands back the same array', () => {
  assert.equal(searchPeople(TEAM, ''), TEAM, 'the cleared box rebuilt the list');
  assert.equal(searchPeople(TEAM, '   '), TEAM);
});

// ── the promise: a tick outlives every query ───────────────────────────────

test('narrowing draws fewer rows and changes no tick', () => {
  /**
   * The component's two expressions, run here as they are written there:
   * `shownTeam` is what gets mapped into rows, `targets` is what gets filed.
   * They are two pieces of state and only one of them reads the query.
   */
  const targets = ['1', '2'];
  const shown = searchPeople(TEAM, 'สมชาย');
  assert.deepEqual(shown.map((p) => p.code), ['PM-0412']);
  assert.deepEqual(targets, ['1', '2'], 'the search wrote to the selection');

  // Which is the count the label prints, against what is visible under it.
  const onScreen = shown.filter((p) => targets.includes(String(p._id))).length;
  assert.equal(onScreen, 0);
  assert.equal(targets.length, 2, 'เลือกแล้ว 2 คน is still true with none on screen');

  // …so the difference has to be said out loud, or the screen contradicts the
  // label. This is `hiddenPicked`.
  const hidden = targets.filter((id) => !shown.some((p) => String(p._id) === id)).length;
  assert.equal(hidden, 2);
});

test('เลือกทั้งหมด adds what is on screen and keeps what is not', () => {
  /**
   * Ticking two names, searching for a third and pressing เลือกทั้งหมด must
   * come to three. `setTargets(shown)` — a replace — comes to one, and the two
   * that vanish are two people who do not get their OT filed.
   */
  const before = ['1', '2'];
  const shown = searchPeople(TEAM, 'สมชาย');
  const after = [
    ...before,
    ...shown.map((p) => String(p._id)).filter((id) => !before.includes(id)),
  ];
  assert.deepEqual(after, ['1', '2', '3']);

  // And it never reaches past the filter. Under a query showing one of three,
  // a button that ticked all three would file two people nobody looked at.
  assert.equal(shown.length, 1, 'the union was built from the whole team');
  // Pressed twice, it is the same list — no duplicate lands on the batch.
  const twice = [
    ...after,
    ...shown.map((p) => String(p._id)).filter((id) => !after.includes(id)),
  ];
  assert.deepEqual(twice, after);
});

// ── the wiring, in the component ───────────────────────────────────────────

test('the list is drawn from shownTeam and the checkbox reads targets', () => {
  assert.match(form, /const shownTeam = searchPeople\(team, teamFind\);/);
  assert.match(form, /\{shownTeam\.map\(\(p\) => \(/, 'the rows still map the unfiltered team');
  assert.match(form, /checked=\{targets\.includes\(String\(p\._id\)\)\}/);
  // The bug this file is about, stated as a ban: nothing may narrow `targets`.
  assert.ok(
    !/setTargets\([^)]*searchPeople/.test(form),
    'the query is being written into the selection',
  );
  assert.ok(
    !/targets\.filter\([^)]*teamFind/.test(form),
    'the selection is being filtered by the query',
  );
});

test('เลือกทั้งหมด is a union over shownTeam, not a replace over team', () => {
  const button = form.slice(form.indexOf('เลือกทั้งหมด ('), form.indexOf('ล้างที่เลือก'));
  assert.ok(!/setTargets\(team\.map/.test(form), 'select-all went back to the whole team');
  assert.match(form, /\.\.\.shownTeam\s*\n?\s*\.map\(\(p\) => String\(p\._id\)\)/);
  assert.match(form, /เลือกทั้งหมด \(\{shownTeam\.length\}\)/);
  assert.ok(button.length > 0);
  // ล้างที่เลือก says "all" and has to mean it — a clear that left ticks on
  // hidden names is one word meaning two things on one screen.
  assert.match(form, /onClick=\{\(\) => setTargets\(\[\]\)\}/);
});

test('the box is the app’s search box, not a third grammar', () => {
  const picker = code.slice(code.indexOf('บันทึกแทนพนักงาน *'), code.indexOf('ล้างที่เลือก'));
  assert.match(picker, /<div className="searchbox"/);
  assert.match(picker, /<Icon name="search" className="searchbox-icon" \/>/);
  assert.match(picker, /placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"/);
  assert.match(picker, /aria-label="ค้นหาพนักงาน"/);
  assert.match(picker, /\{teamFind && <ClearButton onClear=\{\(\) => setTeamFind\(''\)\} \/>\}/);
  // `has-icon` is what leaves room for the glyph; without it the caret starts
  // underneath it. `has-clear` does the same at the other end, and only while
  // there is a ✕ to make room for.
  assert.match(picker, /className=\{`has-icon\$\{teamFind \? ' has-clear' : ''\}`\}/);
  assert.match(css, /\.searchbox input\.has-icon \{ padding-left: 40px; \}/);
  // NOT a combobox: nothing pops over anything here, so the role would promise
  // a listbox that never opens and an aria-expanded that is always false.
  assert.ok(!/role="combobox"/.test(picker), 'the in-place filter claims a popup it has not got');
  // Same gate as เลือกทั้งหมด rather than a second threshold: one name is not
  // a list to hunt through.
  assert.match(picker, /\{team\.length > 1 && \(\s*<div className="searchbox"/);
});

test('a matched row stays one flex item beside its checkbox', () => {
  /**
   * `.check` is a flex row with a 9px gap, and `{p.name} · {p.code}` survived
   * that only because adjacent text collapses into one anonymous flex item.
   * `Highlight` returns real <mark> elements the moment a query matches — as
   * bare children they become flex items and pull the name, the · and the code
   * apart by 9px each, WHILE TYPING, on every row that matched.
   */
  assert.match(css, /\.check \{ display: flex;[^}]*gap: 9px;/);
  // From this label to ITS closing tag — `form.indexOf('</label>')` finds the
  // first one in the file, which is hundreds of lines above this row.
  const from = code.indexOf('<label key={p._id} className="check">');
  const row = code.slice(from, code.indexOf('</label>', from));
  assert.match(row, /<span>[\s\S]*<Highlight text=\{p\.name\}[\s\S]*<Highlight text=\{p\.code\}[\s\S]*<\/span>/);
});
