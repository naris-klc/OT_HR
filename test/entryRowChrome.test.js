import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * รายการ OT รายบุคคล — the last cell of a row, and the footnote under the table.
 *
 * This screen (components/HrEntries.jsx) is what sits behind a total that looks
 * wrong: one card per date, and on each of them exactly one thing HR can DO —
 * แก้ไข. What is pinned here is the difference between a control and a
 * statement, because for most of this file's life the screen drew both as
 * buttons and the statement won.
 *
 * THE DEFECT, WRITTEN DOWN BECAUSE IT SHIPPED. ไม่มีประวัติการแก้ไข was a
 * `disabled` button beside แก้ไข. `.btn:disabled` fills with `--neutral-wash`,
 * and on the dark theme that token is LIGHTER than the `--card` a ghost button
 * is drawn on — so the dead control came out brighter than the live one, and at
 * 134px against 57 it was also more than twice the width. Two buttons, and the
 * eye went to the one that does nothing.
 *
 * The fix is not a colour. It is that a sentence about the row is drawn as a
 * sentence — `.cell-sub.th`, which is what the same cell has always used for
 * แก้ไขไม่ได้ — and the one control on the card carries an icon so it is found
 * at a glance among eight lines of grey.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const jsx = read('components/HrEntries.jsx');
const css = read('app/styles.css');
const icons = read('components/icons.jsx');

/**
 * The screen with its commentary stripped.
 *
 * Two assertions in this file caught their own comment on the way in: one
 * looking for the ✏️ this file explains it does NOT use, and one for the inline
 * style it explains it replaced. The same trap test/hrMonthCards.test.js keeps a
 * note about, and the reason both files strip before asking.
 */
const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** One rule's body, by its exact selector. */
function rule(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `ไม่พบกฎ ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

// ── one control, one statement ───────────────────────────────────────────────

test('the only thing that can be pressed is the only thing drawn as a button', () => {
  // แก้ไข — a control.
  assert.match(jsx, /<button className="btn ghost sm with-icon" onClick=\{\(\) => setEditing\(e\)\}>/);
  // ไม่มีประวัติการแก้ไข — a statement, in the same voice as แก้ไขไม่ได้ above it.
  assert.match(jsx, /<span className="cell-sub th">ไม่มีประวัติการแก้ไข<\/span>/);
  assert.match(jsx, /<span className="cell-sub th">แก้ไขไม่ได้<\/span>/);
  // AND NOT A DISABLED BUTTON, which is what it was until 2026-08-26. Asserted
  // as a negative because the failure is invisible in the light theme: it is
  // `--neutral-wash` being lighter than `--card` in ธีมมืด that made the dead
  // control the loudest thing on the card.
  assert.ok(
    !/<button[^>]*disabled>/.test(jsx),
    'a disabled button came back — a row with nothing to press says so in words',
  );
});

test('nothing in a row writes its own type size any more', () => {
  // The four that were here — the day under the date, ข้ามคืน, who last edited
  // the row, and the ceiling warning — are `.cell-sub.th` and `.cell-note` now,
  // which is what คิวรออนุมัติ prints the same two strings from. Two screens
  // quoting one fact in two sizes is what those classes exist to prevent.
  assert.ok(
    !/style=\{\{ fontSize:/.test(code),
    'an inline font size came back into a row',
  );
  assert.match(jsx, /<div className="cell-sub th">วัน\{dayName\(e\.workDate\)\}<\/div>/);
  assert.match(jsx, /<div className="cell-note">ข้ามคืน<\/div>/);
  // The same string, from the same class, on the screen that shares it.
  assert.match(read('components/ApprovalQueue.jsx'), /<div className="cell-note">ข้ามคืน<\/div>/);
});

test('the two of them share one row, and the sentence is not on the buttons’ baseline', () => {
  assert.match(jsx, /<span className="entry-actions">/);
  assert.match(rule('.entry-actions'), /display: inline-flex; align-items: center; gap: 6px;/);
  // `gap` REPLACED FOUR `marginLeft: 6`s. One of them cannot be forgotten on the
  // next thing added to this cell, and a margin cannot centre 12px text against
  // a 44px control.
  assert.ok(
    !/style=\{\{ marginLeft: 6 \}\}/.test(jsx),
    'a hand-written margin came back beside the gap',
  );
  assert.match(rule('.entry-actions .cell-sub'), /margin-top: 0;/);
});

test('the wrap belongs to the card layout and not to the table', () => {
  // On the desktop this is the eleventh column of a table whose cell already
  // says `white-space: nowrap` — a flex container ignores that, and `wrap` left
  // on the base rule stacked แก้ไข and ดูข้อมูลเดิม onto two lines in every row
  // of a long month.
  assert.match(rule('.entry-actions'), /flex-wrap: nowrap;/);
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody td \.entry-actions \{ flex-wrap: wrap; \}/);
});

// ── the icon ─────────────────────────────────────────────────────────────────

test('the pencil is drawn, not typed, and it is sized by a class', () => {
  // Drawn: an emoji is whatever the font on the device decides, and this app
  // runs on Windows, iPhones and Android — the rule the whole icon file exists
  // for. ✏️ beside a form numbered F-HR-027 is also the wrong register.
  assert.match(icons, /^\s*pencil: \(/m);
  assert.ok(!/✏/.test(code), 'the pencil went back to being an emoji');
  assert.match(jsx, /<Icon name="pencil" className="btn-icon" \/>/);
  assert.match(jsx, /import Icon from '\.\/icons\.jsx';/);

  // OPT-IN BY CLASS. `display: inline-flex` on `.btn` itself would relayout
  // every button in the app to fix the one that has a picture in it.
  assert.match(rule('.btn.with-icon'), /display: inline-flex; align-items: center;/);
  assert.match(rule('.btn.with-icon .btn-icon'), /width: 15px; height: 15px; flex: none;/);
});

// ── the three states of the button ───────────────────────────────────────────

test('a ghost button now has a press, and the three states are a ladder', () => {
  // `.btn:active` moves every button down one pixel, which is enough on a
  // FILLED button and nothing at all on a ghost: the ghost is the card's own
  // background with a hairline round it, so under a thumb — which covers the
  // button — a press showed no change of any kind.
  assert.match(rule('.btn.ghost:hover:not(:disabled)'), /background: var\(--green-tint\)/);
  assert.match(rule('.btn.ghost:active:not(:disabled)'), /background: var\(--green-bg\)/);
  // Deeper on press than on hover, or the two states are the same picture.
  assert.ok(
    css.indexOf('.btn.ghost:hover') < css.indexOf('.btn.ghost:active'),
    'the press state is written above the hover state and loses to it on order',
  );
  // Tokens, both halves of the theme, and no colour named here — the rule
  // test/theme.test.js holds the whole stylesheet to.
  assert.ok(
    !/#[0-9a-fA-F]{3,6}/.test(rule('.btn.ghost:active:not(:disabled)')),
    'the press state named a colour of its own',
  );
});

// ── the card, and the footnote under it ──────────────────────────────────────

test('a field is 10px from the next one, the same step the cards keep', () => {
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  // Each field is a label and a value on ONE line — floated label, value flowing
  // to the right of it — so this gap is the only vertical space between one fact
  // and the next. It read 8px until 2026-08-26.
  assert.match(phone, /\.stack-table tbody tr \{[\s\S]*?display: flex; flex-direction: column; gap: 10px;/);
  // …and it is the same figure the cards themselves are spaced by, so a card's
  // insides and the space around it are one rhythm rather than two.
  assert.match(phone, /\.stack-table tbody \{ display: flex; flex-direction: column; gap: 10px;/);
});

test('the chip under a description is a statement, not the line above wrapping', () => {
  assert.match(jsx, /<div className="entry-mark"><ProxyMark entry=\{e\} \/><\/div>/);
  assert.match(rule('.entry-mark'), /margin-top: 6px;/);
  // `.chip` is nowrap everywhere else and that is right for อนุมัติ and
  // ต้องตรวจ. This one holds a sentence 242px long on a 304px card.
  assert.match(rule('.entry-mark .chip'), /white-space: normal;/);
  assert.ok(
    !/style=\{\{ marginTop: 4 \}\}><ProxyMark/.test(jsx),
    'the mark went back to an inline margin',
  );
});

test('the footnote is a boxed note, and it is not made unreadable to say so', () => {
  assert.match(jsx, /<div className="hint entry-foot">/);
  // The inline margin is gone: it is the one thing a media query cannot reach.
  assert.ok(!/className="hint" style=\{\{ marginTop: 12 \}\}/.test(jsx));
  const foot = rule('.hint.entry-foot');
  // A BOX AND NOT A RULE. It read `border-top: 1px solid var(--line-softer)`
  // with `padding-top: 12px` until 2026-08-26. A hairline says where the note
  // starts and says nothing about where it stops, so under a long month it
  // still trailed off into the page; a bordered wash closes both ends of it.
  assert.match(foot, /background: var\(--neutral-wash\);/);
  assert.match(foot, /border: 1px solid var\(--line-soft\);/);
  assert.match(foot, /border-radius: var\(--radius\);/);
  // 10px down, not 12: two short lines in a note that is the last thing in
  // the card, thinned on 2026-08-26 so the box reads as a margin note rather
  // than as a fifth panel. The 14 across is unchanged.
  assert.match(foot, /padding: 10px 14px;/);
  assert.match(foot, /font-size: 12px;/);
  // Last thing in the card, so `.card .hint`'s 14 left 32px under it against 18
  // at every other edge.
  assert.match(foot, /margin-top: 14px; margin-bottom: 0;/);
  // `.stack-table`'s cells are right-aligned on a phone and this box sits under
  // them; a list that inherited that would have its bullets floating off the
  // ends of two ragged lines.
  assert.match(foot, /text-align: left;/);

  // AND IT KEEPS `.hint`'s COLOUR. Asked for as a lighter grey a second time on
  // 2026-08-26 and declined a second time: `--muted-3` on `--neutral-wash`
  // measures 2.79:1 in ธีมสว่าง, against 3.20 for the `--muted-2` this inherits
  // — and this is the instruction that says what an edit does to a signed
  // month. The box, the smaller face and the space carry the hierarchy instead.
  assert.ok(!/color:/.test(foot), 'the footnote took a colour of its own');
  assert.match(css, /\.hint \{ font: 400 12\.5px\/1\.55 var\(--sans\); color: var\(--muted-2\); \}/);
});

test('the footnote is two rules, one per line, not one sentence and a middot', () => {
  // Thai has no spaces, so the two joined by a · were a single unbreakable
  // string as far as the layout was concerned: it broke wherever the box ended,
  // which put the tail of the first rule and the head of the second on one line.
  assert.match(jsx, /<ul className="foot-notes">/);
  const items = jsx.match(/<li>[^<]*<\/li>/g) || [];
  assert.equal(items.length, 2, 'the footnote is meant to hold exactly two rules');
  assert.match(items[0], /คำนวณชั่วโมงใหม่ทันที/);
  assert.match(items[0], /คงสถานะอนุมัติเดิม/);
  assert.match(items[1], /ยกเลิกหรือไม่อนุมัติ/);
  assert.match(items[1], /ยื่นส่งรายการเข้ามาใหม่/);
  assert.ok(
    !/คงสถานะการอนุมัติเดิมไว้ ·/.test(code),
    'the two rules went back to being one sentence',
  );

  // Drawn, not `list-style` — a disc sits outside the content box and would
  // hang into the panel's padding. Same reasoning as `.alerts-list`, and
  // `padding-left` is on the item so a rule that wraps aligns under its own
  // first line rather than under its bullet.
  assert.match(rule('.entry-foot .foot-notes'), /list-style: none;/);
  assert.match(rule('.entry-foot .foot-notes > li'), /padding-left: 14px;/);
  assert.match(rule('.entry-foot .foot-notes > li::before'), /content: '•';/);
});

test('the footnote lines up with the cards above it on a phone', () => {
  // `.stack-table tbody` insets the cards by 12px; the note is a sibling of the
  // whole table and ran the full width of the `.card`, so it was 12px wider on
  // each side than everything it is about.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.hint\.entry-foot \{ margin-left: 12px; margin-right: 12px; \}/);
  assert.match(phone, /\.stack-table tbody \{ display: flex; flex-direction: column; gap: 10px; padding: 12px;/);
});

test('the bar centres its two halves on one axis, and the margin is why', () => {
  // SEVEN PIXELS. `.audit-bar` is `align-items: center` and always was, but
  // `align-items` centres a flex item's MARGIN box — and `.card .hint` gives
  // every hint inside a card `margin-bottom: 14px`, so the sentence at the
  // right-hand end was centred with 14px of nothing under it and its words came
  // out half of that above the checkbox's. Measured on the built app at 1280px:
  // the label's mid was 302.8 and the hint's 295.8.
  //
  // Stated on all four sides rather than as a bare `margin-bottom: 0`, so the
  // next thing added to this bar cannot inherit one either. It read
  // `margin: 0 0 0 auto` until later the same day — see the wrapped-line test.
  assert.match(rule('.audit-bar .hint'), /margin: 0;/);
  // The bar's own centring is what the fix relies on — if this ever goes, the
  // margin above stops being the explanation.
  assert.match(rule('.audit-bar'), /align-items: center;/);
  // And the inherited margin is real: this is the rule that was reaching in.
  assert.match(css, /\.card \.hint \{[^}]*margin-bottom: 14px;/);
});

test('on a cancelled row the live control outweighs the dead sentence', () => {
  // แก้ไขไม่ได้ and ดูข้อมูลเดิม sit side by side in one cell: a thing that
  // cannot be done and a thing that can. Both were `--muted` at nearly one
  // size, and the live one was a white button with a `--line` hairline on a
  // white card — two labels, and which was which came only from the words.
  assert.match(rule('.entry-actions .cell-sub.th'), /color: var\(--muted-2\);/);
  assert.match(rule('.entry-actions .btn.ghost'), /border-color: var\(--line-lift\);/);

  // BOTH SENTENCES, not only แก้ไขไม่ได้. ไม่มีประวัติการแก้ไข stands in for
  // ดูข้อมูลเดิม in exactly the same way, and that the two speak in one voice
  // is the whole reason neither of them is a disabled button any more.
  assert.match(jsx, /<span className="cell-sub th">แก้ไขไม่ได้<\/span>/);
  assert.match(jsx, /<span className="cell-sub th">ไม่มีประวัติการแก้ไข<\/span>/);

  // NOT A FILL. `--neutral-wash` behind a ghost button is what `.btn:disabled`
  // looks like, and on ธีมมืด that token is LIGHTER than the `--card` a ghost
  // sits on — dressing the live control in the dead one's clothes is the exact
  // defect this cell was repaired for earlier the same day.
  assert.ok(
    !/\.entry-actions \.btn\.ghost \{[^}]*background:/.test(css),
    'the row button took a fill — see .btn:disabled',
  );
  // Scoped, so `.cell-sub.th` elsewhere — a note about a value rather than a
  // missing control — is untouched. Matched at the line start, because
  // `rule()` looks for a selector as a substring and the scoped rule above
  // ends with these same characters.
  assert.match(css, /^\.cell-sub\.th \{\r?\n  font: 400 12px\/1\.45 var\(--sans\);/m);
});

test('the one value that wraps gets a line-height, and only that one', () => {
  // รายละเอียดงานที่ทำ is the only cell on the card whose value runs to two
  // lines. At the table's 1.5 the pair closed up into a block whose last line
  // then sat 10px above กฎที่ใช้ — a LABEL, starting at the opposite edge. Two
  // lines and a heading sharing one gap that was measured for neither.
  assert.match(jsx, /<td className="entry-desc" data-label="รายละเอียดงานที่ทำ">/);
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  // TWO NUMBERS, because one could only do half the job: a line-height adds
  // half its growth under the last line — 1.75 puts 1.75px into the gap below
  // and no more — and what sits under this cell is a LABEL, not another value.
  // The 4px takes the card's 10px flex gap to 14 under this one field. Last
  // glyph to the label's first, measured on the built app: 16.75px before any
  // of it, 18.15 at 1.7 alone, 22.5 now.
  assert.match(phone, /\.stack-table tbody td\.entry-desc \{ line-height: 1\.75; padding-bottom: 4px; \}/);
  // The table's own rule is left alone: on the desktop this cell is a column
  // beside ten others, and a line-height set for a wrapped card value would
  // loosen every row of every table in the app.
  assert.match(css, /^td \{ padding: 12px;[^}]*font: 400 14px\/1\.5 var\(--sans\);/m);
});

test('the notice under the name has one place, whether or not there is a notice', () => {
  // Most months carry no policy warning, so this slot is empty on most people —
  // and `.alert` brought its own 12px top margin while `.audit-bar` brings 16,
  // so the first thing under the heading sat 12px down on a month that had a
  // warning and 16px down on one that did not. HR reads this screen one
  // employee after the next, and a block that moves between them is a
  // difference the eye reports every time.
  assert.match(jsx, /<div className="entry-notice">\s*\n\s*<PolicyVersionBanner spread=\{spread\} onGoMonthly=\{onClose\} \/>\s*\n\s*<\/div>/);

  // THE WRAPPER CARRIES NO MARGIN AND THE NOTICE INSIDE IT CARRIES 16, so an
  // empty slot is zero pixels tall and there is no `:empty` rule to get right.
  // Asserted as a negative too: a margin on the wrapper would put 16px of air
  // under the name of every employee who has no warning.
  assert.match(rule('.entry-notice > .alert'), /margin: 16px 0 0;/);
  assert.ok(!/^\.entry-notice \{/m.test(css), 'the slot took a box of its own');
  // The same figure the bar below it takes, which is what makes the two gaps
  // one gap repeated rather than two numbers that happen to be close.
  assert.match(css.slice(css.indexOf('.audit-bar {')), /^\.audit-bar \{[\s\S]*?margin: 16px 0 0; padding: 12px 16px;/);
});

test('every card footer is the same two slots, and they line up down the month', () => {
  // Left: what can be DONE to this row — แก้ไข, or แก้ไขไม่ได้ where the row is
  // ยกเลิก or ไม่อนุมัติ. Right: what can be READ about it — ดูข้อมูลเดิม, or
  // ไม่มีประวัติการแก้ไข. True in the markup and invisible on the screen: an
  // inline run with a 6px gap starts its second item wherever the first ended,
  // so down a month of six cards the right-hand control sat at four different
  // x-positions — and a column of controls that does not line up reads as a
  // column of different controls.
  // BOTH LAYOUTS, from the base rule. On the desktop the cell is the eleventh
  // column, sized by its widest row, so the same raggedness was there: 1192px
  // against 1221 for the five rows whose left slot is the pencil button.
  assert.match(rule('.entry-actions'), /width: 100%;/);
  assert.match(rule('.entry-actions > :last-child'), /margin-left: auto;/);
  // The phone still wraps and the desktop still does not — that difference is
  // about a 44px button beside a sentence on a 274px card, not about the slots.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody td \.entry-actions \{ flex-wrap: wrap; \}/);
  assert.match(rule('.entry-actions'), /flex-wrap: nowrap;/);

  // THE LAST CHILD, not `justify-content: space-between`. Three things land
  // here on an untouched วันเกิด filing — แก้ไข, ถอนใบวันเกิด, ดูข้อมูลเดิม —
  // and space-between would push ถอนใบวันเกิด to the centre of the card, away
  // from the แก้ไข it belongs with.
  assert.ok(
    !/\.entry-actions[^{]*\{[^}]*space-between/.test(css),
    'the run went to space-between — see ถอนใบวันเกิด, which makes it three',
  );
  assert.match(jsx, /ถอนใบวันเกิด/);
  assert.match(rule('.entry-actions'), /display: inline-flex;/);
});

test('a bar with nothing to show fades, and the reason for it does not', () => {
  // The checkbox has carried `disabled` since it was written and the label has
  // been `--muted-2` for as long — but a greyed word beside a live-looking box
  // reads as a quiet label, not as a control that will not answer. The whole
  // left-hand group fades: box, tick and words together.
  assert.match(jsx, /className=\{auditable\.length \? 'check' : 'check off'\}/);
  assert.match(jsx, /disabled=\{!auditable\.length\}/);
  const off = rule('.audit-bar .check.off');
  assert.match(off, /opacity: \.75;/);

  // AND THE COLOUR GOES DARKER BY A STEP SO THE FADE COSTS NOTHING. Stacking
  // opacity on `--muted-2` lands the words at 2.15:1 on `--neutral-wash`;
  // `--muted` at 75% comes out at 3.19, which is where `--muted-2` at full
  // opacity already was (3.20). The group dims and nothing became harder to
  // read. These five words are the only thing that names what the box does,
  // which is why the disabled-control contrast exemption is not taken here.
  assert.match(off, /color: var\(--muted\);/);
  assert.ok(!/--muted-2/.test(off), 'the label went back to the lighter grey under an opacity');

  // The sentence on the right is not part of the disabled control — it is the
  // REASON the control is disabled — so it keeps `.hint`'s size and colour and
  // ends up the more readable of the two. That is the right way round.
  assert.match(jsx, /'เดือนนี้ยังไม่มีรายการใดถูกแก้ไขหรือคำนวณใหม่'/);
  assert.match(rule('.audit-bar .hint'), /margin: 0;/);
  assert.ok(
    !/\.audit-bar \.hint \{[^}]*opacity/.test(css),
    'the reason faded with the control it explains',
  );
});

test('the bar puts its sentence at the right end, or under the label — never adrift', () => {
  // Two items: the checkbox and its name at the left, the count or the reason at
  // the right. On ONE line `space-between` and `margin-left: auto` do exactly the
  // same thing — but `justify-content` applies to each flex LINE, so on a line
  // holding one item it places that item at the START. When the bar wraps, the
  // sentence lands under the label at the same left edge instead of stranded
  // against the right border with nothing to be right of.
  assert.match(rule('.audit-bar'), /justify-content: space-between;/);
  assert.match(rule('.audit-bar'), /flex-wrap: wrap;/);
  // An auto margin would beat it, which is why the hint's margin is a flat zero.
  assert.ok(
    !/\.audit-bar \.hint \{[^}]*auto/.test(css),
    'the auto margin came back — it pushes right on a wrapped line too',
  );

  // Only exactly two children, which is what makes space-between safe here —
  // see `.entry-actions`, where a third control is why the last-child margin is
  // used instead.
  assert.match(jsx, /<div className="audit-bar">\s*\n\s*<label/);
  assert.match(jsx, /<\/label>\s*\n\s*<span className="hint">/);
});

test('below 860 the sentence is the checkbox’s description, and stacks', () => {
  // THE BREAKPOINT IS ABOUT WHAT THE SENTENCE IS, NOT ABOUT WHETHER IT FITS.
  // This file said "and no breakpoint" until 2026-08-26 and had the measurements
  // for it: the bar needs 444.7px of inside width for the longer of the two
  // sentences and has 470 at a 560px viewport against 390 at 480, so it fits
  // from about 535px up, and `flex-wrap` broke the line exactly there. What that
  // could not decide is what the sentence is FOR. Below 860 the table beside it
  // is already a column of cards; the bar is as wide as a phone; and the count
  // is not the far end of a row any more, it is what ticking the box will show.
  // A description goes under the thing it describes.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  const bar = phone.slice(phone.indexOf('.audit-bar {'));
  assert.match(bar, /^\.audit-bar \{[^}]*flex-direction: column;/);
  // `center` on the base rule centres the CROSS axis, which in a column is the
  // horizontal one — without this the stack comes out centred, which is the one
  // thing the wrapped line was fixed to stop doing.
  assert.match(bar, /^\.audit-bar \{[^}]*align-items: flex-start;/);
  // 6px, not the bar's 14: that gap was measured between two independent items
  // side by side, and between a label and its own sub-text it is a chasm.
  assert.match(bar, /^\.audit-bar \{[^}]*gap: 6px;/);
  // The base rule is what still puts a wrapped line at its own start, and it is
  // what draws this if the phone rule above ever goes.
  assert.match(rule('.audit-bar'), /flex-wrap: wrap;/);
});

test('the drawer’s green edge sits on the card’s border, not inside it', () => {
  // On a phone the drawer's <tr> is a card like the row above it — 15px of
  // padding, a border, a radius — so `.audit-drawer` sat 16px in from the card's
  // own edge with its 3px accent running down a white margin beside nothing, and
  // its words started 35px in (16 + 3 + 16) against the 15px every field on the
  // row above starts at. The card holds nothing but the drawer, so the padding
  // moves to the drawer: the stripe lands on the card's border, parallel with
  // it, and 12px of padding past a 3px stripe puts the text at the row's 15.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody tr\.audit-row \{[^}]*padding: 0;/);
  // The td carries `--neutral-wash` and now runs to the corners; a square wash
  // inside a 14px radius is worse than the inset it replaces.
  assert.match(phone, /\.stack-table tbody tr\.audit-row \{[^}]*overflow: hidden;/);
  assert.match(
    phone,
    /\.stack-table tbody tr\.audit-row \.audit-drawer \{ padding: 14px 15px 15px 12px; \}/,
  );
  // Two classes and two elements against the card rule's one class and two
  // elements — this wins on specificity, not on source order.
  assert.match(rule('.stack-table tbody tr'), /padding: 15px;/);
  // The accent itself is unchanged and stays on the shared rule: the desktop
  // draws it against the left wall of a colSpan cell and always did.
  assert.match(rule('.audit-drawer'), /border-left: 3px solid var\(--green\);/);
});

test('the drawer’s caption is smaller than the timestamps under it', () => {
  // It explains what the two halves of the drawer are and is read once; the
  // timestamps below are read every time. At `.hint`'s 12.5px it was within half
  // a pixel of `.entry-history .who` and a whole one ABOVE `.entry-history
  // .when` (11.5), so three lines of grey type came out the same size.
  assert.match(rule('.audit-drawer > .hint'), /font-size: 12px;/);
  // `--muted-2` AND NOT `--muted-3`, settled for the third time: on the drawer's
  // own `--neutral-wash` that token is 2.79:1 in ธีมสว่าง against 3.20, and this
  // line is already below AA. The size carries the step down on its own.
  assert.ok(
    !/\.audit-drawer > \.hint \{[^}]*muted-3/.test(css),
    'the caption bought its hierarchy with contrast it cannot spare',
  );
  // Stated in CSS rather than on the element. The margin is there for one
  // reason — `.card .hint`'s `margin-bottom: 14px` reaching in from four hundred
  // lines away — and the shorthand states all four sides so it cannot come back.
  assert.match(rule('.audit-drawer > .hint'), /margin: 2px 0 0;/);
  assert.match(code, /<div className="hint">\s*\n\s*แถวด้านบนคือข้อมูลล่าสุด/);
});

// ── กฎที่ใช้ came off the table on 2026-09-04 ────────────────────────────────

/**
 * WHAT WAS ASKED FOR, and it is two things rather than one.
 *
 * "ลบคอลัมน์ กฎที่ใช้ ออกจากทั้ง Header และ Body" is the visible half. The half
 * that decides whether it was done properly is the second sentence — "ขยาย
 * พื้นที่ของคอลัมน์ รายละเอียดงานที่ทำ และ สถานะ ให้กว้างขึ้น" — because taking
 * a column out of an `auto` table returns its room to the ALGORITHM, not to any
 * column in particular. On a month of short descriptions most of it goes to the
 * date and the times, and the screen ends up with the same cramped sentence and
 * one fewer fact on it.
 */
test('กฎที่ใช้ is not a column on this table, in either half of it', () => {
  assert.ok(!code.includes('<th>กฎที่ใช้</th>'), 'the header still has it');
  assert.ok(!code.includes('data-label="กฎที่ใช้"'), 'the body still has it');
  // และไม่กลับมาในชื่ออื่น — เซลล์นั้นเป็นตัวเดียวที่วาด PolicyVersionCell ในตาราง
  const head = jsx.slice(jsx.indexOf('<thead>'), jsx.indexOf('</thead>'));
  assert.ok(!/PolicyVersion/.test(head), 'a version cell is back in the header');
});

test('the two columns that hold prose are the two that were widened', () => {
  assert.match(code, /<th className="desc-col">รายละเอียดงานที่ทำ<\/th>/);
  assert.match(code, /<th className="status-col">สถานะ<\/th>/);
  assert.match(code, /<td className="status-col">\s*<StatusChip/);

  // A class with no rule behind it is the failure this pair exists to prevent:
  // the column comes off, the markup says it was compensated for, and nothing
  // on screen moved.
  assert.match(css, /\.stack-table th\.desc-col \{ width: \d+%; \}/);
  assert.match(css, /\.stack-table th\.status-col \{ width: \d+%; \}/);

  // และต้องอยู่นอกบล็อกมือถือ — ที่นั่น thead เป็น display:none ความกว้างจึงไม่ถึงใคร
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/th\.desc-col/.test(phone), 'the width was written where thead is hidden');
});

/**
 * จาก–ถึง IS THE THIRD COLUMN THAT HOLDS MORE THAN A FIGURE, and it was the one
 * left out when the other two were widened.
 *
 * It was written when the cell held `17:00–19:30` and nothing else, so it never
 * got a width. It now carries the times, up to two chips, the day's scan line
 * and the mismatch detail. MEASURED on the built app at 1440px against a clone
 * of the real July scan file, with `desc-col` and `status-col` already in
 * place: the column came out **79px**, the `ไม่ได้สแกนเข้า OT` pill rendered
 * **55×60** — three lines of text inside one pill — `สแกน 07:34 , 19:30`
 * wrapped to three lines, and a row whose description is ONE line stood 187px
 * tall. With the rule below: 172px, the pill 104×25, the scan line one line,
 * the row 97px.
 *
 * THE FLOOR IS IN PIXELS AND THAT IS THE POINT. A time string, a pill and
 * `สแกน 07:34 , 19:30` do not get shorter on a narrower screen, so a percentage
 * alone lets a 1280 laptop squeeze them back into the shape the rule exists to
 * undo. A `%`-only rule here would pass a test that only looked for a width.
 */
test('จาก–ถึง has a width, and its floor is a pixel one', () => {
  assert.match(code, /<th className="when-col">จาก–ถึง<\/th>/);

  const rule = /\.stack-table th\.when-col \{ width: \d+%; min-width: (\d+)px; \}/.exec(css);
  assert.ok(rule, 'จาก–ถึง has no width rule behind its class');
  // 148px of content is what the pill and the scan line need side by side; the
  // cell's own padding is 12px each side. Below this the pill breaks in half.
  assert.ok(Number(rule[1]) >= 168, `the floor fell to ${rule[1]}px — the chip wraps under ~168`);

  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/th\.when-col/.test(phone), 'the width was written where thead is hidden');
});

/**
 * A colSpan that outlives the column it counted.
 *
 * The drawer is one cell spanning the whole row. Leave it at ten after taking a
 * column out and the browser draws a phantom eleventh — an empty cell at the
 * end of every open drawer, which no assertion about markup would notice and
 * every reader would see. Counted from the header rather than written down, so
 * the next column to arrive or leave fails this rather than being remembered.
 */
test('the drawer spans exactly the columns the header declares', () => {
  const head = jsx.slice(jsx.indexOf('<thead>'), jsx.indexOf('</thead>'));
  const columns = (head.match(/<th[\s>/]/g) || []).length;
  assert.equal(columns, 9, 'the table is nine columns wide since 2026-09-04');
  const span = /<td colSpan=\{(\d+)\}>/.exec(code);
  assert.ok(span, 'the drawer must span the row');
  assert.equal(Number(span[1]), columns, 'colSpan and the header disagree');
});

/**
 * The audit fact has to land somewhere, and "somewhere" is checkable.
 *
 * Asked for as "ย้ายไปแสดงใน Modal ดูข้อมูลเดิม หรือ ประวัติการแก้ไข" — so the
 * version being absent from the table is only half of what was requested, and
 * the half that is easy to leave undone.
 */
test('the rule set moved into the drawer, above the trail rather than inside it', () => {
  const drawer = code.slice(code.indexOf('audit-drawer'), code.indexOf('</tbody>'));
  assert.match(drawer, /<PolicyVersionCell version=\{e\.policyVersionId\} \/>/, 'the version is nowhere');
  assert.match(drawer, /className="audit-policy"/);

  // เหนือร่องรอย ไม่ใช่ปนอยู่ในนั้น: อันหนึ่งคือข้อเท็จจริงคงที่ อีกอันคือลำดับเหตุการณ์
  assert.ok(
    drawer.indexOf('audit-policy') < drawer.indexOf('<RequestTrail'),
    'the standing fact is filed among the events',
  );
  assert.match(css, /\.audit-policy \{/, 'the line has no style of its own');
});
