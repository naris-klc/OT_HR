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
  assert.match(foot, /padding: 12px 14px;/);
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
