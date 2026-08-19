import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * แถบอนุมัติแบบกลุ่มบนมือถือ — ลอยอยู่เหนือแถบเมนู และไม่บังการ์ดใบสุดท้าย.
 *
 * Two numbers have to agree and nothing makes them: where the bar sits, and how
 * much room the list leaves under itself. Get the second wrong and the last row
 * of a queue is unreachable — not missing, not greyed, simply under a bar that
 * looks perfectly correct. Nobody reports that as a bug; they report that a
 * request "is not in the list".
 *
 * It went wrong the ordinary way. The clearance was a number typed once against
 * the labels of the day, and the labels have changed twice since — a button
 * reading "อนุมัติทั้งหมดที่เลือก (5 รายการ)" wraps where the older one did not.
 * So the number is measured from the bar now, and what these pin is that it
 * still is.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');

/** The phone block only — the desktop rule above it is sticky-to-the-top. */
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
const mobileBar = phone.slice(phone.indexOf('.batch-bar {'), phone.indexOf('.batch-bar .count-label'));

const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('on a phone the bar is fixed to the bottom, not sticky to the top', () => {
  has(mobileBar, 'position: fixed; top: auto;');
  has(mobileBar, 'bottom: calc(70px + env(safe-area-inset-bottom))');
});

/**
 * The stack it has to win, and the one it must not: .mobile-nav is fixed at the
 * very bottom on 30. One above it puts the bar over the cards and under nothing.
 */
test('it sits one layer above the bottom nav and never over it', () => {
  has(mobileBar, 'z-index: 31;');
  const nav = phone.slice(phone.indexOf('.mobile-nav {'), phone.indexOf('.mobile-nav button'));
  has(nav, 'z-index: 30;', 'แถบเมนูล่างเปลี่ยน z-index ไปแล้ว');
  // It starts where the nav ends, so neither covers the other.
  has(nav, 'position: fixed; bottom: 0;');
});

test('it lifts off the list — a shadow, and a slide up from the edge', () => {
  has(mobileBar, 'box-shadow: 0 -8px 22px');
  has(mobileBar, 'animation: otbatchup');
  // Travels its own height, so it comes from under the screen edge rather than
  // appearing part-way up and sliding the rest.
  has(css, '@keyframes otbatchup { from { transform: translateY(100%); }');
  // And is silenced for anybody who asked for less motion.
  has(css, '@media (prefers-reduced-motion: reduce)');
});

test('the clearance under the list is measured from the bar, not typed', () => {
  has(phone, 'padding-bottom: calc(var(--batch-bar-h) + 16px)');
  // Declared in :root as well, so the token exists before the first measurement
  // and for a browser with no ResizeObserver — and so it passes the
  // completeness check in test/theme.test.js.
  has(css, '--batch-bar-h: 88px;');
  has(jsx, "card.style.setProperty('--batch-bar-h'");
  // Height changes without a remount — a fifth tick can wrap a button, and so
  // does turning the phone sideways.
  has(jsx, 'new ResizeObserver(publish)');
  has(jsx, "card.style.removeProperty('--batch-bar-h')");
});

/**
 * The rule writes to `.card:has(> .batch-bar)` and the effect writes to the
 * bar's `parentElement`. They are the same box only because the bar is a direct
 * child; if one moves, both must.
 */
test('the element measured is the element the rule is on', () => {
  has(phone, '.card:has(> .batch-bar) .table-wrap');
  has(jsx, 'const card = bar?.parentElement;');
  has(jsx, '<div className="batch-bar" ref={barRef}>');
});

/**
 * The dependency is evaluated during render, so a `const` declared below it is
 * still in its temporal dead zone and the screen throws on first paint. It did.
 */
test('the observer is set up after the value its dependency reads', () => {
  assert.ok(
    jsx.indexOf('const picked = shown.filter') < jsx.indexOf('}, [picked.length > 0]);'),
    'useEffect อ่าน picked ก่อนที่ picked จะถูกประกาศ — หน้าจอจะพังตั้งแต่เรนเดอร์แรก',
  );
});
