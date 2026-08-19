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
 * were taken out of — and that the bar stays put while the list scrolls.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');

/** The phone block only — the desktop rules above it are a different design. */
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('the controls sit in the same bar as เลือกทั้งหมด', () => {
  // The actions are inside the toolbar element, not a sibling of it.
  const bar = jsx.slice(jsx.indexOf('className="queue-mobile-bar'), jsx.indexOf('{/* ── batch bar'));
  has(bar, 'เลือกทั้งหมด ({actionable.length})');
  has(bar, 'picked-actions');
  has(bar, 'pileLabel(isHr, picked.length)');
  has(bar, 'setRejecting(picked)');
});

test('it summarises what is ticked — count and hours', () => {
  // Two numbers on the tick-box's own line, not a sentence on a row of its own:
  // this is checked before a press, not read.
  has(jsx, '<strong>{picked.length}</strong> ใบ · {hours(pickedHours)} ชม.');
});

/**
 * FOUR ROWS DOWN TO TWO. On a 640px phone the bar was taking a fifth of the
 * screen — and it is stuck to the top of that screen, over the list it exists to
 * act on. Only the two decisions are worth a touch target; the rest is a
 * tick-box, two numbers and an undo.
 */
test('the box is two rows, and only the decisions keep the 44px floor', () => {
  const rules = phone.slice(phone.indexOf('.picked-sum {'), phone.indexOf('/* ── the row as a card'));
  // Tally and ✕ share the tick-box's line; the two decisions have the next.
  has(rules, '.picked-sum {\r\n    flex: 1 1 auto;');
  has(rules, '.picked-actions {\r\n    flex: 1 1 100%;');
  has(rules, '.picked-actions .btn { flex: 1 1 0; min-height: 44px;');
  // The undo is smaller ON PURPOSE — it is the one control here that can be
  // taken back, and at full width under the other two it read as a third
  // decision.
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
  has(jsx, '✓ เลือกอยู่');
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
     so 62 IS the top of the usable screen; at 0 this bar would slide under it
     (z-index 11 against 20) and vanish at the exact moment it stuck. */
  has(rule, 'position: sticky; top: 62px;');
  has(rule, 'z-index: 11;');
  const appbar = css.slice(css.indexOf('.appbar {'), css.indexOf('.appbar .title'));
  has(appbar, 'position: sticky; top: 0; z-index: 20;', 'แอปบาร์เปลี่ยนไปแล้ว');
  has(appbar, 'height: 62px;', 'ความสูงแอปบาร์เปลี่ยน — top ของแถบต้องตามไปด้วย');
  // Sticky needs a fill of its own or the rows read through it.
  has(phone, '.queue-mobile-bar:has(.picked-actions) { background: var(--green-bg); }');
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
