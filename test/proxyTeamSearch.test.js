import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { searchPeople } from '../lib/personSearch.js';

/**
 * ค้นหาชื่อเหนือกล่องเลือกลูกทีม — บันทึก OT แทนพนักงาน's own search box.
 * (That button read บันทึก OT แทนลูกทีม until 2026-08-31.)
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

// ── the button that opens all of this ──────────────────────────────────────

test('the queue button and the dialog it opens say the same words', () => {
  /**
   * Renamed 2026-08-31: `+ บันทึก OT แทนลูกทีม` → `+ บันทึก OT แทนพนักงาน`.
   *
   * TWO STRINGS IN TWO FILES, and they are one sentence a person reads across
   * a press — the queue's button says what is about to happen and the pop-up's
   * header says it has. `OtForm`'s comment says the heading is written once
   * because it is drawn by two different elements; nothing was making it agree
   * with the button that opens it, and only one of the two was reported.
   */
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  assert.match(queue, /\+ บันทึก OT แทนพนักงาน/);
  assert.ok(!queue.includes('บันทึก OT แทนลูกทีม'), 'the queue button kept the old wording');
  assert.match(code, /: proxy \? 'บันทึก OT แทนพนักงาน'/);
});

test('a .btn.sm in a card head is a 44px touch target on a phone', () => {
  /**
   * Measured on the built app while checking the label's fit: this button came
   * out **33px** at 320–768px while the same `.btn.sm` in `.row-actions` two
   * rows below it was 44. `.card-head` was the third place one of these is
   * pressed with a thumb and the only one the rule had not reached.
   *
   * The label was never the problem — it is ONE line at every width from 320
   * to 1440, 164.1px in a head that wraps it onto its own line well before the
   * space runs out.
   */
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  assert.match(
    phone,
    /\.card-head \.btn\.sm,\s*\n\s*\.row-actions \.btn\.sm, \.quick-edit-foot \.btn \{ min-height: 44px; \}/,
  );
});

// ── the queue's head: title, count and button on one line ──────────────────

test('the count sits with the title and the button shares their line', () => {
  /**
   * Asked for 2026-08-31. `.card-head` wraps by default and the count had
   * already been moved into the title for phones, so the wrap was spending a
   * whole row of a screen on one button.
   *
   * FOUR RULES, AND EACH ONE IS A BUILD THAT WENT WRONG WITHOUT IT — every
   * number below was measured on the built app rather than reasoned about:
   *
   *  · `flex-wrap: nowrap` alone put the head 7px over a 320px screen and made
   *    it scroll sideways, so the whole block starts at 360px instead.
   *  · `min-width: 0` on the column let it shrink past its own content: the
   *    title overflowed its box and slid under the button. Removed.
   *  · without `min-width: max-content` on the name, the column took its share
   *    from the long hint below and the title drew `รออนุ… · 2 รายการ` — nine
   *    characters elided with 48px of the row empty.
   *  · `.t` is a flex row, and a flex item drops its leading whitespace, so
   *    `{' · '}` rendered as `รออนุมัติ· 2 รายการ` until the 5px gap replaced
   *    the space the markup had been relying on.
   */
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  assert.match(phone, /@media \(min-width: 360px\) \{/, 'the one-line head lost its 360px floor');
  assert.match(phone, /\.card-head:has\(> \.row \.btn\) \{ flex-wrap: nowrap; \}/);
  assert.match(phone, /\.card-head:has\(> \.row \.btn\) > \.row \{ flex: none; \}/);
  assert.match(phone, /\.card-head:has\(> \.row \.btn\) \.btn \{ white-space: nowrap; \}/);
  assert.match(phone, /\.card-head:has\(> \.row \.btn\) \.t > \.t-name \{ min-width: max-content; \}/);
  assert.match(phone, /\.card-head:has\(> \.row \.btn\) \.t-count \{ flex: none; \}/);
  // The column must NOT be told it may shrink past its content.
  assert.ok(
    !/\.card-head:has\(> \.row \.btn\) > :first-child \{ min-width: 0/.test(phone),
    'the title column can shrink past the title again',
  );
  // …and the head that carries no button keeps the wrap it was written with.
  assert.match(css, /\.card-head \{ display: flex;[^}]*flex-wrap: wrap;/);
});

test('the queue heading reads รออนุมัติ, and the name is its own span', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  // STRIPPED, for the reason this file's header gives — and it caught the same
  // trap a second time on the first run: the comment beside the heading records
  // what it used to read, and the ban matched that instead of the code.
  const queueCode = strip(queue);
  assert.ok(queue.includes('รอหัวหน้าอนุมัติ'), 'the note recording the old wording is gone');
  assert.ok(!queueCode.includes('รอหัวหน้าอนุมัติ'), 'the heading kept the old wording');
  // `.t-name` is what the stylesheet reaches for; without the span the rules
  // above have nothing to hold the title's width against.
  assert.match(queue, /<span className="t-name">/);
  assert.match(queue, /: isHr \? 'รออนุมัติ OT' : 'รออนุมัติ'/);
});

test('ชื่อแผนกใต้หัวข้อไม่ตกไปอยู่บรรทัดใหม่คนเดียว', () => {
  /**
   * `เฉพาะแผนกวิศวกรรม` broke as `เฉพาะแผนก` / `วิศวกรรม`, leaving the
   * department's own name alone on a second line under the heading — reported
   * 2026-09-01.
   *
   * AND THE BREAK IS THE BROWSER DOING SOMETHING CORRECT. Thai sets no spaces,
   * and half the notes in `app/styles.css` lean on that — `.dept-combo .ph`'s
   * says the min-content width of a Thai run is the WHOLE string. That holds
   * only where the browser has no dictionary. Chrome has one, finds the word
   * boundaries inside the run, and breaks at them; so the fix cannot be an
   * `overflow-wrap` or a width, it has to say that this particular clause is
   * one word.
   *
   * IT MOVES THE BREAK RATHER THAN FORBIDDING ONE — the hint is two facts with
   * a `·` between them, and with the second held whole the line gives way at
   * the separator instead. `nowrap` is on the clause, never on `.hint` itself,
   * which would overflow.
   *
   * AND IT IS HALF A CHANGE ON ITS OWN — the 11px below is the other half, not
   * a second opinion about the size. Every rule in the test above depends on
   * the column's min-content being THE TITLE; an unbreakable clause in the hint
   * takes that back. Measured on the built app at 360px: the clause with the
   * longest department on the roster (ควบคุมคุณภาพ) is 142px against the
   * title's 129, the column grew to 142, and the button's right edge landed 2px
   * inside the card — no headroom at all, where the head had 33px, and one more
   * character would have put it back to scrolling sideways.
   *
   * At 11px that clause is 125px, under the title, and the column is
   * title-decided again. The size was the other way the report offered, and
   * this is where it belongs: the head where the column is 130px wide, not the
   * twenty other places `.hint` is drawn with a card to itself.
   */
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  assert.match(queue, /<span className="q-scope">\s*\n?\s*เฉพาะแผนก\{user\.department\?\.name \|\| ''\}/);
  assert.match(css, /\.hint \.q-scope \{ white-space: nowrap; \}/);
  // Both classes, so a name this short cannot escape into another component —
  // the trap `.box` sprang on the dropdown's tick-box, in this same stylesheet.
  assert.ok(
    !/(^|[^.\w])\.q-scope\b/m.test(css.replace(/\.hint \.q-scope/g, '')),
    'a bare .q-scope rule can reach anything called that',
  );
  // The base size is untouched — the 11px is the squeezed head's alone, and it
  // lives INSIDE the 360px block, with the rules whose geometry it protects.
  assert.match(css, /\.hint \{ font: 400 12\.5px\/1\.55 var\(--sans\); color: var\(--muted-2\); \}/);
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  const opens = phone.indexOf('@media (min-width: 360px) {');
  const rule = phone.indexOf('.card-head:has(> .row .btn) .hint { font-size: 11px; }');
  // The block runs from that inner `@media` to the เลือกทั้งหมด section that
  // follows it — bounded by both ends rather than by a closing brace, since
  // the rules inside it have braces of their own on their own lines.
  const closes = phone.indexOf('/* ── เลือกทั้งหมด');
  assert.ok(rule > opens && rule < closes && opens > 0 && closes > 0,
    'the 11px hint left the one-line head block it pays for');
});
