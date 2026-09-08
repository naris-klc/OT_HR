import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ภาพรวม บนบันทึกประวัติระบบ — the four counted lists, all the same height.
 *
 * They sit in one `.log-columns` grid, and a grid row is as tall as its tallest
 * cell. The endpoint hands each list a different cap — 3 accounts, 15
 * addresses, 10 of each of the other two — so the addresses card set the height
 * of the row and the accounts card beside it stood under twelve rows of empty
 * card. What each list is worth FETCHING and what a card shows AT ONCE are two
 * different questions, and the screen was only answering the first.
 *
 * It answered the second with a `ดูทั้งหมด` button for a while: three rows
 * shown, "PANEL_ROWS = 3" cutting the list, and a max-height measured off the
 * collapsed list the instant before it opened. Asked for on 2026-09-08, all
 * three are gone — every row is in the list from the first paint, and the card
 * is a fixed box you scroll. What is pinned here is what is left of the answer:
 *
 *   ONE HEIGHT, IN THE STYLESHEET, ON ALL FOUR — three rows' worth, with no
 *   condition and no state, so no card can be taller or shorter than another
 *   and none can be left folded shut.
 *   NOTHING TO PRESS — no button, no slice, no collapsed state to restore.
 *   AND SOMETHING SAYS THE LIST RUNS ON — the fade, because an overlay
 *   scrollbar does not paint until the pointer is over the box.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/LogSystem.jsx'), 'utf8');
const route = readFileSync(join(ROOT, 'app/api/logs/summary/route.js'), 'utf8');

/** The `.log-tally { … }` block itself, without the `::-webkit-` ones after it. */
const tally = css.slice(css.indexOf('.log-tally {'), css.indexOf('.log-tally-view {'));

/**
 * The same two files with every comment taken out.
 *
 * What was removed here is remembered in both files, by name — the button, the
 * head that held it, the state behind it — because a rule with no record of
 * what it replaced is a rule somebody rebuilds. So the assertions that say a
 * thing is GONE have to read the code and not the prose about it, or the note
 * explaining the removal fails the test that checks it.
 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const jsxCode = strip(jsx);
const cssCode = strip(css);

// ── one height, for all four cards ──────────────────────────────────────────

test('the list is capped in the stylesheet, not by a slice in the component', () => {
  assert.match(tally, /max-height: \d+px/, 'the cap is gone — each card is back to standing as tall as the list it was sent');
  assert.match(tally, /overflow-y: auto/, 'a capped list with no scroll is rows nobody can reach');
  // Contained, or the page behind it scrolls on at the end of a card's list.
  assert.match(tally, /overscroll-behavior: contain/);
  // And there is one Panel, so there is no second place for a second height.
  assert.equal(jsx.match(/^function Panel\(/gm)?.length, 1);
});

test('the cap is three rows, and a row is what the rules above it say it is', () => {
  const cap = Number(tally.match(/max-height: (\d+)px/)?.[1]);
  // 9px of padding twice over a 13.5px line and an 11.5px line 2px apart is 55,
  // and three of them have two 1px rules between. Read from the same stylesheet
  // rather than written down here, so a change to the row's padding or type
  // fails this instead of quietly showing two and a half rows.
  const pad = Number(css.match(/\.log-tally li > button, \.log-tally li > \.static \{[^}]*padding: (\d+)px/)?.[1]);
  const main = Number(css.match(/\.log-tally \.main \{ font: 500 ([\d.]+)px\/1\.4/)?.[1]);
  const sub = Number(css.match(/\.log-tally \.sub \{ font: 400 ([\d.]+)px\/1\.4/)?.[1]);
  const gap = Number(css.match(/\.log-tally \.t \{[^}]*gap: (\d+)px/)?.[1]);
  const row = pad * 2 + Math.round(main * 1.4) + gap + Math.round(sub * 1.4);
  assert.equal(cap, row * 3 + 2, `three rows is ${row * 3 + 2}px and the stylesheet caps at ${cap}px`);
});

test('three is a number the shortest list can actually fill', () => {
  // บัญชีที่ใช้งานมากที่สุด is capped at three by the endpoint, for its own
  // reasons — the question is settled at the top of that list. A box built for
  // more rows than that card will ever be sent is empty space inside it, and
  // the row goes crooked again from the other side.
  const smallest = Number(route.match(/^const TOP_ACCOUNTS = (\d+);/m)?.[1]);
  assert.ok(smallest > 0, 'TOP_ACCOUNTS is gone from app/api/logs/summary/route.js');
  assert.ok(smallest >= 3, `the endpoint sends at most ${smallest} accounts and the card is built for three`);
});

// ── the grid ────────────────────────────────────────────────────────────────

test('the cards in a row share one height', () => {
  const rule = css.slice(css.indexOf('.log-columns {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /align-items: stretch/,
    'the cards each end where their own list does again');
});

// ── nothing to press ────────────────────────────────────────────────────────

test('there is no ย่อ / ดูทั้งหมด control, in the component or the stylesheet', () => {
  assert.ok(!/ดูทั้งหมด|log-more|log-panel-head/.test(jsxCode),
    'the fold is back on the card — a list that can be shut is a card that can be left shut');
  assert.ok(!/log-more|log-panel-head/.test(cssCode),
    'the stylesheet still dresses a control the component no longer draws');
  // No collapsed state means no measurement of it, and no inline height to
  // fight the stylesheet's.
  assert.ok(!/maxHeight/.test(jsxCode),
    'a measured max-height is back in the component — it will fight the one in the stylesheet');
  assert.ok(!/const \[all, setAll\]|list\.slice\(/.test(jsxCode),
    'the list is being cut again — the rows below the cut are then reachable by nothing');
});

test('the scrollbar is the app\'s own, thinned', () => {
  // The app has ONE scrollbar geometry (`::-webkit-scrollbar-thumb` at the top
  // of the sheet, 10px with a 3px border of the page's colour). `.pick-list`
  // established how to make it thin inside a panel without inventing a second
  // one: keep the width, drop the border to transparent so no groove is painted
  // down the card, and give Firefox the same bar with `scrollbar-width`.
  assert.match(css, /\.log-tally \{ scrollbar-width: thin; scrollbar-color: var\(--scroll-thumb\) transparent; \}/);
  assert.match(css, /\.log-tally::-webkit-scrollbar \{ width: 10px; \}/);
  assert.match(css, /\.log-tally::-webkit-scrollbar-track \{ background: transparent; \}/);
  assert.match(css, /\.log-tally::-webkit-scrollbar-thumb \{ border-color: transparent; \}/);
});

test('and something says the rest is down there', () => {
  // A scrollbar does not paint until the pointer is over the box, so a card
  // with twelve more rows in it looks exactly like a card with none. The fade
  // is the app's existing answer to "is there more this way", turned ninety
  // degrees — and now the only answer, since there is no longer a button whose
  // absence says the list is complete.
  assert.match(jsx, /<div className="log-tally-view" data-edge=\{edge\}>/);
  assert.match(jsx, /useScrollEdge\(list, 'y'\)/);
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  assert.match(common, /export function useScrollEdge\(watch, axis = 'x'\)/,
    'the vertical axis is gone from useScrollEdge — the capped list has no reading to draw');
  // On the wrapper, never on the scroller: a fade painted inside a scroll
  // container is content and scrolls away with the row it was drawn over.
  assert.match(css, /\.log-tally-view \{ position: relative; \}/);
  assert.match(css, /\.log-tally-view::before, \.log-tally-view::after \{[^}]*pointer-events: none/);
  assert.ok(!/\.log-tally(\.all)?::(before|after)/.test(css),
    'the fade moved onto the list itself, where it will scroll away with the content');
});
