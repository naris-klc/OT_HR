import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * แถบเลือกหลายรายการบนมือถือ — อยู่ที่เดียวกับปุ่มที่ใช้เลือก.
 *
 * เลือกทั้งหมด is the only way to build a batch on a phone (the card layout
 * hides `thead`, which took the heading checkbox with it) and it sits at the TOP
 * of the list. The buttons that act on the selection were pinned above the nav
 * at the FOOT of the screen — a defensible place for a thumb, and the wrong
 * place for the one moment they are wanted: somebody has just pressed something
 * at the other end of the screen and is looking for what to do next.
 *
 * So both live in one sticky bar under the app bar now, which is the shape the
 * desktop rule has always had. What these pin is that there is exactly ONE set
 * of these buttons on a phone — two would be the duplication the row buttons
 * were taken out of — that the bar stays put while the list scrolls, and that
 * once something is ticked the whole thing is ONE LINE: four rows, then two,
 * then this. A bar pinned over the list it acts on is paid for in list.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');

/** The phone block only — the desktop rules above it are a different design. */
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('the controls sit in the same bar as เลือกทั้งหมด', () => {
  // The actions are inside the toolbar element, not a sibling of it.
  const bar = jsx.slice(jsx.indexOf('queue-mobile-bar no-print'), jsx.indexOf('{/* ── batch bar'));
  has(bar, 'เลือกทั้งหมด ({actionable.length})');
  has(bar, 'picked-actions');
  has(bar, 'setConfirming(picked)');
  has(bar, 'setRejecting(picked)');
});

/**
 * TWO BUTTONS, ONE SHAPE, BOTH COUNTED — and short enough that the pair fits
 * beside the tally on one line. The long sentence belongs to the dialog these
 * open, which has a sheet's width for it and is the last thing read before the
 * hours move; a bar button is what you press to GET to that sheet.
 *
 * One counting and one not, side by side, reads as the uncounted one doing
 * something else — so if either carries the number, both do.
 */
test('the two decisions are short, counted and the same width', () => {
  const bar = jsx.slice(jsx.indexOf('queue-mobile-bar no-print'), jsx.indexOf('{/* ── batch bar'));
  has(bar, '{verb} ({picked.length})');
  has(bar, 'ไม่อนุมัติ ({picked.length})');
  // ...and nothing of the sentence the dialog says.
  const code = bar.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('pileLabel') && !code.includes('รายการ'),
    'ปุ่มบนแถบยาวเท่ากับปุ่มในกล่องยืนยันอีกแล้ว');
  // Equal halves: same basis, and neither may grow past the other.
  has(phone, '.picked-actions .btn {\r\n    flex: 1 1 0; min-height: 44px;');
});

/**
 * เลือกทั้งหมด keeps its words while nothing is ticked — it is the only way to
 * build a batch here and a bare box under a row of filters says nothing. Once
 * something IS ticked the words are wrong anyway (the box toggles, it no longer
 * selects all) and the room they were taking is what buys the single line.
 *
 * What must NOT change with them is the name a screen reader hears.
 */
test('the tick-box drops its words but not its name', () => {
  const bar = jsx.slice(jsx.indexOf('queue-mobile-bar no-print'), jsx.indexOf('{/* ── batch bar'));
  has(bar, 'aria-label="เลือกทั้งหมด"');
  has(bar, '{picked.length === 0 && <>เลือกทั้งหมด ({actionable.length})</>}');
  has(phone, '.queue-mobile-bar.picking .check { flex: none; gap: 0; }');
});

/**
 * ONE FRAMED OBJECT ON THE BAR, AND IT IS THE APPROVAL.
 *
 * Everything here started life on a white card, where a border is what separates
 * one control from the next. The bar is green, so every one of those borders
 * came with a white block behind it — and three white blocks beside one filled
 * green button is four things competing, with the brightest of them being an
 * empty tick-box chip.
 *
 * So the tick-box, the ✕ and the refusal all sit on the bar's own fill now.
 * What none of them lose is size: the 44px on the decisions and the 34px on the
 * undo are tap targets, and this is a change of chrome, not of reach.
 */
test('only the approval is drawn as a filled control', () => {
  const rules = phone.slice(phone.indexOf('.queue-mobile-bar {'), phone.indexOf('/* ── the row as a card'));
  // The tick-box: no card and no border, in EITHER state — with the words while
  // nothing is ticked, and without them after.
  has(rules, '.queue-mobile-bar .check {');
  has(rules, 'background: none; border: 0;');
  assert.ok(!rules.includes('border: 1px solid var(--line); border-radius: var(--radius-sm);\r\n    background: var(--card);'),
    'ช่องติ๊กกลับไปเป็นการ์ดขาวอีกแล้ว');
  // The ✕: a plain grey mark, tinted only while it is being pressed.
  has(rules, 'border: 0; border-radius: var(--radius-sm);');
  has(rules, 'background: transparent; color: var(--muted);');
  // The refusal: flat red, no white block bidding against the green button.
  has(rules, '.picked-actions .btn.ghost.danger {\r\n    background: transparent; border-color: transparent;');
  // ...including while a batch is running, when the app-wide rule would
  // otherwise draw back the grey card this one just took off.
  has(rules, '.picked-actions .btn.ghost.danger:disabled {');
  // The green button is untouched — it is the one thing here that should be
  // filled, and `.btn` gives it that with no help from this block.
  assert.ok(!rules.includes('.picked-actions .btn:not(.ghost)'),
    'ปุ่มเขียวถูกเขียนทับ — มันควรเป็นปุ่มเต็มตามปกติของแอป');
});

test('it summarises what is ticked — count and hours', () => {
  // Two numbers on the tick-box's own line, not a sentence on a row of its own:
  // this is checked before a press, not read.
  has(jsx, '<strong>{picked.length}</strong> ใบ · {hours(pickedHours)} ชม.');
});

/**
 * FOUR ROWS, THEN TWO, NOW ONE. On a 640px phone the two-row bar was ~110px of
 * a screen it is stuck to the top of, over the list it exists to act on. One
 * line is the 44px the decisions keep plus the padding around them.
 *
 * The single line survives only if exactly one child may shrink. Give a second
 * one flex-grow, or let the bar wrap, and the old two-row layout comes back by
 * accident on the first long tally.
 */
test('the bar is one row, and only the decisions keep the 44px floor', () => {
  const rules = phone.slice(phone.indexOf('.queue-mobile-bar {'), phone.indexOf('/* ── the row as a card'));
  // No second row, ever, once something is ticked.
  has(rules, '.queue-mobile-bar.picking {\r\n    flex-wrap: nowrap;');
  // The tally is the one that gives; the controls beside it do not.
  has(rules, '.picked-sum {\r\n    flex: 0 1 auto; min-width: 0;');
  has(rules, 'text-overflow: ellipsis;');
  has(rules, '.picked-actions {\r\n    flex: 0 0 auto; margin-left: auto;');
  has(rules, '.picked-actions .btn {\r\n    flex: 1 1 0; min-height: 44px;');
  // The undo is smaller ON PURPOSE — it is the one control here that can be
  // taken back, and at the size of the two beside it, in the same group, it
  // would read as a third decision.
  has(rules, 'width: 34px; height: 34px;');
});

test('the ✕ is reachable without a pointer', () => {
  has(jsx, 'aria-label="ล้างการเลือก"');
  // Not a `.btn`, so the app's focus rule does not reach it — the gap
  // `.password-field .reveal` had to close too.
  has(phone, '.picked-clear:focus-visible');
});

/**
 * The card pointed at "แถบด้านล่าง" for one commit after the bar moved to the
 * top. A direction that names the wrong end of the screen is worse than none.
 */
test('a ticked card does not send anybody to where the bar used to be', () => {
  /* The tick and the word are two spans since 2026-09-09: `.btn-word` is what
     the 861px block hides on this cell, so a desktop row shows "✓" in a 96px
     column and the phone card — which has the width and no heading row to lean
     on — still reads "✓ เลือกอยู่". Same two characters and the same word, in
     the order they were always in. */
  has(jsx, '<span aria-hidden="true">✓</span>');
  has(jsx, "<span className=\"btn-word\">{' เลือกอยู่'}</span>");
  const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('ใช้แถบด้านล่าง'), 'การ์ดยังชี้ไปที่แถบด้านล่างที่ย้ายไปแล้ว');
});

/**
 * A control that scrolls away takes the selection with it as far as the reader
 * is concerned: the ticks are still set, but nothing on screen says so or offers
 * to act on them.
 */
test('the bar stays under the app bar while the list scrolls', () => {
  const rule = phone.slice(phone.indexOf('.queue-mobile-bar {'), phone.indexOf('.queue-mobile-bar .check'));
  /* 62px, NOT 0. The app bar is itself sticky at 0, 62px tall and never leaves,
     so 62 IS the top of the usable screen. At 0 this bar either slides under the
     app bar and vanishes at the exact moment it sticks, or — drawn later at the
     same z-index — covers it and leaves 14px of app bar showing below. */
  has(rule, 'position: sticky; top: 62px;');
  has(rule, 'z-index: 20;');
  const appbar = css.slice(css.indexOf('.appbar {'), css.indexOf('.appbar .title'));
  has(appbar, 'position: sticky; top: 0; z-index: 20;', 'แอปบาร์เปลี่ยนไปแล้ว');
  has(appbar, 'height: 62px;', 'ความสูงแอปบาร์เปลี่ยน — top ของแถบต้องตามไปด้วย');
  // Sticky needs a fill of its own or the rows read through it, and a shadow to
  // say it is stuck: a green strip over white cards with only a hairline under
  // it reads as part of the first card.
  has(rule, 'background: var(--green-bg);');
  has(rule, 'box-shadow: 0 6px 14px -8px var(--shadow-3);');
  // Under the nav (30) and the modals (80) it shares the screen with.
  has(css, '.mobile-nav {\r\n    position: fixed; bottom: 0; left: 0; right: 0; z-index: 30;');
});

/**
 * The bottom bar is the SAME element as the desktop one, so it stays in the
 * markup; the phone simply stops drawing it. Drawing both would put two
 * identical pairs of buttons on one short screen.
 */
test('there is exactly one set of these buttons on a phone', () => {
  has(phone, '.batch-bar { display: none; }');
  // …and the desktop rule is untouched above the media query.
  const desktop = css.slice(0, css.indexOf('@media screen and (max-width: 860px)'));
  has(desktop, 'position: sticky; top: 62px; z-index: 10;');
});

/**
 * Removed with the bottom bar: the fixed positioning it needed, the height
 * measurement that fed the clearance under the list, and the clearance itself.
 * A leftover of any of them is a rule holding up nothing.
 */
test('nothing is left over from the bar that used to cover the list', () => {
  assert.ok(!phone.includes('padding-bottom: calc(var(--batch-bar-h)'), 'ยังเว้นที่ให้แถบที่ไม่มีแล้ว');
  assert.ok(!css.includes('--batch-bar-h: '), 'token ที่ไม่มีใครอ่านแล้วยังอยู่');
  assert.ok(!css.includes('@keyframes otbatchup'), 'keyframe ที่ไม่มีใครใช้แล้วยังอยู่');
  // Comments stripped: the note where the observer stood NAMES it, which is the
  // point of a tombstone and not a leftover. Prose is not what runs.
  const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('ResizeObserver'), 'observer ที่ไม่มีอะไรให้วัดแล้วยังอยู่');
  assert.ok(!code.includes('barRef'), 'ref ที่ไม่มีใครใช้แล้วยังอยู่');
});
