import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ปริมาณการใช้งานรายวัน — the chart that drew nothing.
 *
 * It is fourteen divs, not a charting library, and every height in it is a
 * PERCENTAGE. That makes the whole picture rest on one declaration nothing on
 * the screen names: `.log-chart` must STRETCH its bars. A flex item that is not
 * stretched is as tall as its own contents, and the contents here are a `.col`
 * with `flex: 1` over a zero basis — about three pixels. With `align-items:
 * flex-end` the card rendered as it was reported on 2026-08-31: a row of date
 * ticks along the bottom, a red mark on the days that had a refused login, and
 * no bars at all. Nothing was wrong with the data — `/api/logs/summary` had
 * been returning fourteen days of real counts the whole time.
 *
 * The second half of the same report is the dark foot. คำสั่งแก้ไขข้อมูล is
 * drawn as a slice of the bar it belongs to, and on this traffic that slice is
 * a rounding error: a working day is six or seven hundred requests of which
 * three change data, and 3/663 rounds to 0%. So the slice carries a floor —
 * and because a floor would otherwise paint a foot on a day where nothing was
 * edited, the div is rendered only on the days that have one.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/LogSystem.jsx'), 'utf8');

/** One declaration block, by selector, out of the stylesheet. */
function rule(selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at > 0, `${selector} is gone from the stylesheet`);
  return css.slice(at, css.indexOf('}', at));
}

// ── the bars are given a height to stand in ─────────────────────────────────

test('the chart stretches its bars to its own height', () => {
  const chart = rule('.log-chart');
  assert.match(chart, /height: \d+px/,
    '.log-chart has no height of its own — every percentage below it resolves against nothing');
  assert.doesNotMatch(chart, /align-items:\s*(flex-end|flex-start|center|baseline)/,
    'the bars are not stretched, so each one is as tall as its date label and the chart draws nothing');
});

test('the bars grow from the floor because the column says so, not the chart', () => {
  // This is what lets the chart stretch and still have the bars rise from the
  // bottom: the column is the flex container that pushes its own fill down, so
  // the cross-axis alignment up on .log-chart is free to do the one thing only
  // it can do — hand each bar the full 132px.
  const col = rule('.log-bar .col');
  assert.match(col, /justify-content:\s*flex-end/,
    'the column no longer pushes its fill to the floor — the bars would hang from the top');
  assert.match(col, /flex:\s*1/,
    'the column no longer takes the height the chart gives it');
});

// ── the dark foot is drawn on the days that have one ────────────────────────

test('คำสั่งแก้ไขข้อมูล has a floor, or it rounds away to nothing', () => {
  assert.match(rule('.log-bar .writes'), /min-height:\s*[1-9]/,
    'a handful of writes among several hundred requests rounds to 0% and is drawn as nothing');
});

test('the floor cannot paint a foot on a day with no writes', () => {
  const at = jsx.indexOf('<div className="log-chart">');
  assert.ok(at > 0, 'the chart is gone from the markup');
  const block = jsx.slice(at, jsx.indexOf('<div className="log-columns">'));
  assert.match(block, /d\.writes > 0 &&/,
    'the writes slice is rendered unconditionally — with a min-height under it, that is a mark on a quiet day');
});

// ── both of the things the hint promises are actually drawn ─────────────────

test('the two marks the hint names are both in the markup', () => {
  // แท่งสีเข้มคือคำสั่งที่แก้ไขข้อมูล · ขีดสีแดงคือการเข้าสู่ระบบไม่สำเร็จ
  assert.match(jsx, /className="writes"/, 'the dark slice the hint describes is gone');
  assert.match(jsx, /d\.failedLogins > 0 && <div className="failed" \/>/,
    'the red mark the hint describes is gone');
  assert.match(rule('.log-bar .failed'), /background: var\(--danger\)/, 'the mark is no longer red');
});
