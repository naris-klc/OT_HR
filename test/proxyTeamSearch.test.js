import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * กล่องเลือกลูกทีมบน บันทึก OT แทนพนักงาน — the list a หัวหน้า ticks names in.
 * (That button read บันทึก OT แทนลูกทีม until 2026-08-31.)
 *
 * ── WHY THE FILE IS STILL CALLED proxyTeamSearch ────────────────────────────
 * There is no search box on this screen any more. It came out on 2026-09-01,
 * asked for as making the picker compact, and the name is kept rather than
 * renamed for two reasons: the documents point at this path by name, and the
 * paragraphs below are most of what is known about why the box existed — which
 * is worth more attached to the screen it was on than in a git log.
 *
 * ── WHAT THE BOX WAS FOR, AND WHY FOUR NAMES DO NOT NEED IT ─────────────────
 * The one promise it existed to keep: narrowing the list must never lose a
 * tick. A หัวหน้า files for a team by ticking names, and every route by which a
 * search could quietly drop one ends with a request filed for the wrong
 * person's month — which nothing on any screen afterwards would flag. Three
 * such routes were held open here: filtering `targets` instead of the list
 * drawn from it; `เลือกทั้งหมด` REPLACING the selection with what was on
 * screen; and `เลือกทั้งหมด` reaching past the filter to the whole team.
 *
 * ALL THREE ARE UNREACHABLE WITH NOTHING TO NARROW. `team` is the non-manager
 * staff of ONE แผนก, and this roster's largest is ENG at four people (WH is
 * two). The list IS the team, so what is on screen and what is ticked cannot
 * disagree — which is a stronger guarantee than the three assertions were.
 *
 * WHAT IS HELD HERE NOW is the picker the box left behind: the count in the
 * label, the scroll box, the ticked row's own highlight, and — as bans — that
 * none of the search's machinery grew back.
 *
 * The matcher itself is `lib/personSearch.js` and is tested in
 * test/personSearch.test.js, which is where the two cases that lived here went.
 * It still has three callers; this screen was the fourth.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/**
 * The source with its comments taken out — the same stripper
 * test/holidayDeleteConfirm.test.js and test/modalCloseButton.test.js use.
 *
 * A BAN PROVES NOTHING WITHOUT IT, and this file has caught itself twice. The
 * check that the box did not claim `role="combobox"` failed on its first run
 * against the comment beside it explaining why it did not; and the bans below
 * are now ALL about machinery that is gone, every name of which is written out
 * in the paragraphs recording why it went. Without the stripper this whole
 * section passes by reading its own reasons.
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
  // Every one of these three is a name the comments spell out and the code no
  // longer holds. If the stripper stopped working, the bans further down would
  // match those paragraphs and report the search box as still removed while it
  // sat on the screen.
  assert.ok(form.includes('teamFind'), 'the note recording what came out is gone');
  assert.ok(!code.includes('teamFind'), 'the stripper left a comment behind');
  assert.ok(form.includes('shownTeam'), 'the note recording the old list is gone');
  assert.ok(!code.includes('shownTeam'), 'the stripper left a comment behind');
  // …and that it did not eat the live code along with them.
  assert.ok(code.includes('const [targets, setTargets] = useState([]);'), 'the stripper ate the code');
  assert.ok(code.includes('<div className="pick-list">'));
});

// ── the search box is gone, and none of it grew back ───────────────────────

test('ไม่มีช่องค้นหาเหนือกล่องรายชื่ออีกแล้ว', () => {
  /**
   * Asked for on 2026-09-01: "ลบช่องค้นหาด้านบนกล่องรายชื่อออก เพื่อให้พื้นที่
   * กระชับขึ้น".
   *
   * THE BAN IS ON THE PICKER, NOT ON THE FILE, and the slice is what says so:
   * `.searchbox` is a shape three other screens draw and one of them could
   * legitimately arrive in this form one day. What may not come back is a box
   * over THIS list, between the label and the names.
   */
  const picker = code.slice(code.indexOf('บันทึกแทนพนักงาน *'), code.indexOf('ล้างที่เลือก'));
  assert.ok(picker.length > 0, 'the picker moved — this slice is measuring nothing');
  assert.ok(!picker.includes('searchbox'), 'ช่องค้นหากลับมาอยู่เหนือรายชื่ออีกแล้ว');
  assert.ok(!picker.includes('placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"'));
  assert.ok(!picker.includes('aria-label="ค้นหาพนักงาน"'));

  // And the state, the filter and the marking that only the box used.
  assert.ok(!code.includes('teamFind'), 'the query state is back');
  assert.ok(!code.includes('shownTeam'), 'the filtered list is back');
  assert.ok(!code.includes('hiddenPicked'), 'the hidden-tick note is back with nothing to hide');
  assert.ok(!code.includes('searchPeople'), 'the form is filtering the team again');
  assert.ok(!code.includes('<Highlight'), 'a row is marking a query that does not exist');

  // The imports went with them. A dead import compiles clean and would go on
  // being bundled into this form for nobody.
  //
  // `Icon` IS NOT ON THIS LIST AND WAS, FOR ONE ROUND ON THE SAME DAY. The
  // magnifier was its only use here when the box left, so it went out with the
  // others — and it came back that afternoon for the calendar glyph on the date
  // rule under วันที่เริ่ม, which is pinned in test/submissionWindowForm.test.js.
  // The list is "imported for nobody", not "imported for the search box", so an
  // import that found a second reader belongs off it.
  const imports = form.slice(0, form.indexOf('const blank'));
  for (const gone of ['ClearButton', 'Highlight', 'searchPeople']) {
    assert.ok(!strip(imports).includes(gone), `${gone} ยังถูก import อยู่ทั้งที่ไม่มีใครใช้`);
  }
});

// ── the label counts, always ───────────────────────────────────────────────

test('ป้ายบอกจำนวนที่เลือกเสมอ แม้ยังไม่ได้เลือกใคร', () => {
  /**
   * `บันทึกแทนพนักงาน * (เลือกแล้ว X คน)`, asked for on 2026-09-01 with the
   * count "อัปเดตตามจริงแบบ Dynamic".
   *
   * IT READ THE COUNT OFF `targets` BEFORE THIS AND STILL DOES — the change is
   * that the parenthetical is no longer conditional on there being one. A
   * counter that is absent at nought is a counter a reader has to notice
   * ARRIVING to know it exists, and this label is the only place on the screen
   * that says how many people a press of บันทึก is about to file for.
   *
   * AND THE LABEL STOPS CHANGING WIDTH as the first tick lands. The line
   * reflowed when the parenthetical appeared, which on a phone moved the `*`
   * a reader was looking at.
   */
  assert.match(code, /<label>บันทึกแทนพนักงาน \* \(เลือกแล้ว \{targets\.length\} คน\)<\/label>/);
  // Not `team.length`, not the number of rows on screen: what is COUNTED is
  // what would be filed.
  assert.ok(
    !/\(เลือกแล้ว \{team\.length\}/.test(code),
    'the label is counting the team rather than the selection',
  );
});

// ── the list, and the box it scrolls in ────────────────────────────────────

test('รายชื่อวาดจาก team และช่องติ๊กอ่านจาก targets', () => {
  assert.match(code, /\{team\.map\(\(p\) => \(/, 'the rows are drawn from something other than the team');
  assert.match(code, /checked=\{targets\.includes\(String\(p\._id\)\)\}/);
  // The bug the search box was capable of, kept as a ban now that it cannot
  // arise: nothing may narrow `targets` itself.
  assert.ok(!/setTargets\([^)]*filter\([^)]*\bfind\b/.test(code), 'the selection is being filtered');
});

test('เลือกทั้งหมด ยังเป็นการรวม ไม่ใช่การแทนที่ — และกดซ้ำได้', () => {
  /**
   * A REPLACE COMPUTES THE SAME LIST TODAY, and the union is kept anyway.
   *
   * With nothing narrowing the list, `setTargets(team.map(...))` and the union
   * come to the same array — so this is not load-bearing this morning. It is
   * the shape that cannot lose a tick, it is idempotent (pressed twice it adds
   * nothing, and a duplicate id in `targets` is a second request filed for the
   * same person), and the day this list is narrowed again by anything at all a
   * replace is a bug and a union is not.
   */
  assert.ok(!/setTargets\(team\.map/.test(code), 'select-all became a replace');
  assert.match(code, /\.\.\.team\s*\n?\s*\.map\(\(p\) => String\(p\._id\)\)\s*\n?\s*\.filter\(\(id\) => !t\.includes\(id\)\)/);
  assert.match(code, /เลือกทั้งหมด \(\{team\.length\}\)/);
  // Shut when there is nothing left to add, not when the list is empty.
  assert.match(code, /team\.every\(\(p\) => targets\.includes\(String\(p\._id\)\)\)/);
  // ล้างที่เลือก says "all" and means it, in one press.
  assert.match(code, /onClick=\{\(\) => setTargets\(\[\]\)\}/);

  // Run the two expressions as they are written, on a team of three.
  const team = [{ _id: '1' }, { _id: '2' }, { _id: '3' }];
  const add = (t) => [...t, ...team.map((p) => String(p._id)).filter((id) => !t.includes(id))];
  assert.deepEqual(add(['2']), ['2', '1', '3'], 'a tick already made was dropped or duplicated');
  assert.deepEqual(add(add(['2'])), add(['2']), 'pressed twice it files somebody twice');
});

test('รายชื่ออยู่ในกล่องสูงคงที่ที่เลื่อนได้ ไม่ดันฟอร์มที่เหลือลงไป', () => {
  /**
   * The three fields that matter next (วันที่, เวลาเข้า, เวลาออก) and the live
   * preview under them are what a หัวหน้า is actually filling in. A list of
   * whatever length the แผนก happens to be pushes all of it below the fold and
   * turns one screen into three.
   *
   * `max-height` AND NOT A FIXED ONE, so a team of two does not sit in a box of
   * empty rules. Asked for on 2026-09-01 as "Fix Height / Max Height", which is
   * the same request either way round: what it buys is that the rest of the
   * form does not move when the list is long.
   */
  const rule = css.slice(css.indexOf('.pick-list {'), css.indexOf('}', css.indexOf('.pick-list {')));
  assert.match(rule, /max-height: 210px;/);
  assert.match(rule, /overflow-y: auto;/);
  assert.match(rule, /border: 1px solid var\(--line\);/, 'the box lost the edge that makes it a box');
  assert.match(rule, /background: var\(--card\);/);
  // A flick inside the list must not carry on into the page behind it once the
  // list has run out.
  assert.match(rule, /overscroll-behavior-y: contain;/);
});

test('แถบเลื่อนเป็นของกล่อง ไม่ใช่ของหน้า — คืนเฉพาะสีเท่านั้น', () => {
  /**
   * The app has ONE scrollbar rule and it is written for a bar running down the
   * PAGE: a 10px track with the thumb inset by `border: 3px solid var(--bg)`,
   * which is what makes it a slim pill on the page's ground rather than a
   * groove. That border is a COLOUR, not a transparency — so inside a container
   * filled with `--card` it drew three pixels of the page's colour down the
   * inside edge of the box.
   *
   * ONLY THE COLOUR IS RESTATED. Width, radius and the 3px inset stay the
   * app's; a second geometry here is a second scrollbar for a reader to learn.
   * `transparent` rather than `var(--card)` so the value follows the box if
   * this container is ever put on a different fill.
   */
  assert.match(css, /\.pick-list::-webkit-scrollbar-thumb \{ border-color: transparent; \}/);
  assert.match(css, /\.pick-list::-webkit-scrollbar-track \{ background: transparent; \}/);
  // Firefox draws none of the `::-webkit-` rules and would show its own bar.
  assert.match(css, /\.pick-list \{ scrollbar-width: thin; scrollbar-color: var\(--scroll-thumb\) transparent; \}/);
  // The page's own rule is what is being deferred to, so it has to still exist.
  assert.match(css, /::-webkit-scrollbar-thumb \{ background: var\(--scroll-thumb\); border-radius: 8px; border: 3px solid var\(--bg\); \}/);
  // And this container may not restate the geometry it is borrowing.
  const own = css.slice(css.indexOf('.pick-list::-webkit-scrollbar {'), css.indexOf('.pick-list .check {'));
  assert.ok(!own.includes('border-radius'), '.pick-list ตั้งรูปทรงแถบเลื่อนเอง');
  assert.ok(!own.includes('background: var(--scroll-thumb)'), '.pick-list ตั้งสีหัวแถบเลื่อนเอง');
});

test('แถวที่ติ๊กแล้วมีไฮไลต์เขียวล้อมรอบ และเส้นคั่นสองข้างหลบให้', () => {
  /**
   * Asked for on 2026-09-01: "เมื่อเลือกรายการ ให้แสดงแถบไฮไลต์สีเขียวโปร่งแสง
   * ล้อมรอบการ์ดพนักงานคนนั้นอย่างชัดเจน".
   *
   * A 17px checkbox at the left edge was the only thing separating the people
   * about to have a request filed for them from the people who are not — down a
   * list where every row is the same height and the same colour, on a phone,
   * with a thumb over the left column.
   *
   * THE PAIR IS `.announce`'S, not a new colour: `--green-bg` under
   * `--green-accent` mixed to 45%. Its note carries the reason — `--green-accent`
   * is the one green that holds on both sides of the theme, and at full strength
   * a ring in it is louder than anything on a form whose subject is the times
   * below.
   *
   * AN INSET RING RATHER THAN A BORDER, or the row moves a pixel when it is
   * ticked. `inset` paints inside the row's own edges, closes on all four sides
   * — which is what "ล้อมรอบ" asks for — and reflows nothing.
   *
   * AND THE SEPARATORS ON BOTH SIDES GO, or a grey hairline runs immediately
   * under the ring's green one at the bottom and over it at the top: two edges
   * where the eye is being shown one.
   *
   * `:has()` AND NOT A CLASS FROM THE COMPONENT. The state is already in the
   * DOM — the checkbox's own `:checked` — and a `className` computed from
   * `targets` is a second copy of it for a future edit to leave behind.
   */
  assert.match(
    css,
    /\.pick-list \.check:has\(input:checked\) \{\s*\n\s*background: var\(--green-bg\);\s*\n\s*box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--green-accent\) 45%, transparent\);\s*\n\s*border-top-color: transparent;\s*\n\}/,
  );
  assert.match(css, /\.pick-list \.check:has\(input:checked\) \+ \.check \{ border-top-color: transparent; \}/);
  // Hover on a row that is ALREADY ticked must not read as "not ticked" — the
  // neutral wash is one class less specific and loses, which is the kind of win
  // that survives only until somebody adds a class. Stated rather than left.
  assert.match(css, /\.pick-list \.check:has\(input:checked\):hover \{ background: var\(--green-bg\); \}/);
  // The base rules it leans on.
  assert.match(css, /\.pick-list \.check \+ \.check \{ border-top: 1px solid var\(--line-softer\); \}/);
  assert.match(css, /\.pick-list \.check:hover \{ background: var\(--neutral-wash\); \}/);
  // Both classes on every selector: `.check` alone is the app's tick-box row
  // everywhere, and a green ring on every checked box in the app is the trap
  // `.box` sprang on the dropdown's tick-box in this same stylesheet.
  for (const m of css.matchAll(/^([^\n{}]*:has\(input:checked\)[^\n{}]*)\{/gm)) {
    assert.ok(m[1].includes('.pick-list'), `กฎ ${m[1].trim()} ไม่ได้จำกัดอยู่แค่กล่องเลือกลูกทีม`);
  }
});

test('แถวหนึ่งแถวยังเป็น flex item เดียวข้างช่องติ๊ก', () => {
  /**
   * `.check` is a flex row with a 9px gap, and `{p.name} · {p.code}` as bare
   * children survives that only because adjacent text collapses into one
   * anonymous flex item. ONE element of any kind between them and the name, the
   * · and the code become three flex items 9px apart.
   *
   * `Highlight` was that element and made it happen WHILE SOMEBODY TYPED, on
   * every row that matched. It is gone with the box, and the span it forced is
   * kept: the next thing put in that row would spring the same trap, and this
   * assertion is the only place that says so now.
   */
  assert.match(css, /\.check \{ display: flex;[^}]*gap: 9px;/);
  // From this label to ITS closing tag — `code.indexOf('</label>')` finds the
  // first one in the file, hundreds of lines above this row.
  const from = code.indexOf('<label key={p._id} className="check">');
  const row = code.slice(from, code.indexOf('</label>', from));
  assert.match(row, /<span>\{p\.name\} · \{p\.code\}<\/span>/);
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
