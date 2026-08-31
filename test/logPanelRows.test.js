import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ภาพรวม บนบันทึกระบบ — the four counted lists, all the same height.
 *
 * They sit in one `.log-columns` grid, and a grid row is as tall as its tallest
 * cell. The endpoint hands each list a different cap — 3 accounts, 15
 * addresses, 10 of each of the other two — so the addresses card set the height
 * of the row and the accounts card beside it stood under twelve rows of empty
 * card. What each list is worth FETCHING and what a card opens SHOWING are two
 * different questions, and the screen was only answering the first.
 *
 * What is pinned here is the shape of the answer, in three parts:
 *
 *   ONE NUMBER FOR ALL FOUR — `PANEL_ROWS`, used both to cut the list and to
 *   decide whether anything is hidden, so a card can never open with a count
 *   the button is not counting against.
 *   NO LARGER THAN THE SMALLEST CAP — a standard บัญชีที่ใช้งานมากที่สุด cannot
 *   meet is not a standard, and its cap is the one that would break it.
 *   OPENING SCROLLS, IT DOES NOT GROW — otherwise ดูทั้งหมด on one card drags
 *   the three beside it taller and hands each of them the whitespace back.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/LogSystem.jsx'), 'utf8');
const route = readFileSync(join(ROOT, 'app/api/logs/summary/route.js'), 'utf8');

const panelRows = Number(jsx.match(/^const PANEL_ROWS = (\d+);/m)?.[1]);

// ── one number, on all four cards ───────────────────────────────────────────

test('every card opens on the same number of rows, and it is a constant', () => {
  assert.ok(panelRows > 0, 'PANEL_ROWS is gone — each card is back to opening on whatever it was sent');
  // The cut and the "is there more" question read the same constant. Two
  // literals here is how a card comes to show four rows under a button that
  // says there are three.
  assert.match(jsx, /const shown = all \? list : list\.slice\(0, PANEL_ROWS\);/);
  assert.match(jsx, /const hidden = list\.length - PANEL_ROWS;/);
  // And there is one Panel, so there is no second place for a fifth number.
  assert.equal(jsx.match(/^function Panel\(/gm)?.length, 1);
});

test('the standard is one the shortest list can actually meet', () => {
  // บัญชีที่ใช้งานมากที่สุด is capped at three by the endpoint, for its own
  // reasons — the question is settled at the top of that list. A card that
  // opens on more rows than it will ever be sent is a card that can never show
  // its standard, and the row would go crooked again from the other side.
  const smallest = Number(route.match(/^const TOP_ACCOUNTS = (\d+);/m)?.[1]);
  assert.ok(smallest > 0, 'TOP_ACCOUNTS is gone from app/api/logs/summary/route.js');
  assert.ok(panelRows <= smallest,
    `PANEL_ROWS is ${panelRows} and the endpoint sends at most ${smallest} accounts`);
});

// ── the grid ────────────────────────────────────────────────────────────────

test('the cards in a row share one height', () => {
  const rule = css.slice(css.indexOf('.log-columns {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /align-items: stretch/,
    'the cards each end where their own list does again');
});

// ── ดูทั้งหมด ───────────────────────────────────────────────────────────────

test('the control sits in the top right of the card, and only when there is more', () => {
  assert.match(css, /\.log-panel-head \{[^}]*justify-content: space-between/);
  assert.match(jsx, /\{hidden > 0 && \(/,
    'the button is drawn on cards with nothing hidden — three cards would offer to show a fourth row that does not exist');
  // It says how many, because "ดูทั้งหมด" on its own does not tell somebody
  // whether the rest is one more row or twelve.
  assert.match(jsx, /ดูทั้งหมด \(\$\{list\.length\.toLocaleString\('th-TH'\)\}\)/);
});

test('the control is styled by a selector that can beat .btn.sm', () => {
  // The button is `btn quiet sm log-more`, so a bare `.log-more` is one class
  // against `.btn.sm`'s two and LOSES — the padding and the size were in the
  // bundle, were correct, and were overruled, and the control measured 33px
  // with `.btn.sm`'s 9px/13px on it. Nothing about that is visible in the
  // source; it is only visible in a measurement of the running app.
  assert.match(css, /\.btn\.sm\.log-more \{[^}]*font-size: 12px/);
  assert.ok(!/^\.log-more \{/m.test(css),
    'the one-class selector is back — it loses to .btn.sm and the size silently reverts');
  // And it is 44px to a thumb, bought back out of the layout with the negative
  // margins, the same way `.announce-fold` does it.
  const phone = css.slice(css.lastIndexOf('@media (max-width: 860px) {'));
  assert.match(phone, /\.btn\.sm\.log-more \{[^}]*min-height: 44px/);
  assert.match(phone, /\.btn\.sm\.log-more \{[^}]*margin: -11px -4px -11px 0/);
});

test('opening scrolls inside the card rather than making it taller', () => {
  assert.match(css, /\.log-tally\.all \{[^}]*overflow-y: auto/);
  // The cap is the collapsed list's own measured height, not a number in the
  // stylesheet. Three rows of arithmetic is wrong on exactly the cards where it
  // matters — the ones where a long name wraps — and too small a number makes
  // ดูทั้งหมด shrink the card, which is worse than the growth it prevents.
  assert.match(jsx, /setCap\(listRef\.current\?\.offsetHeight \|\| 0\)/);
  assert.match(jsx, /style=\{all && cap \? \{ maxHeight: cap \} : undefined\}/);
  assert.ok(!/\.log-tally\.all \{[^}]*max-height: \d/.test(css),
    'a fixed max-height is back in the stylesheet — it will fight the measured one');
});

test('and something says the rest is down there', () => {
  // A card that does not change height is a card that looks like the button did
  // nothing. Walked on the verify build: the fourth row was in the DOM, the
  // list scrolled to it, and the scrollbar did not paint until the pointer was
  // over it — so ดูทั้งหมด read as inert. The fade is the app's existing answer
  // to "is there more this way", turned ninety degrees.
  assert.match(jsx, /<div className="log-tally-view" data-edge=\{all \? edge : 'none'\}>/);
  assert.match(jsx, /useScrollEdge\(all, 'y'\)/);
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  assert.match(common, /export function useScrollEdge\(watch, axis = 'x'\)/,
    'the vertical axis is gone from useScrollEdge — the opened list has no reading to draw');
  // On the wrapper, never on the scroller: a fade painted inside a scroll
  // container is content and scrolls away with the row it was drawn over.
  assert.match(css, /\.log-tally-view \{ position: relative; \}/);
  assert.match(css, /\.log-tally-view::before, \.log-tally-view::after \{[^}]*pointer-events: none/);
  assert.ok(!/\.log-tally(\.all)?::(before|after)/.test(css),
    'the fade moved onto the list itself, where it will scroll away with the content');
});
