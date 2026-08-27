import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * สรุป OT ส่งบัญชี บนมือถือ — the edge that says there is more table.
 *
 * Seven columns do not fit 304px, so below 860px this sheet scrolls sideways
 * and the right edge of the box is where the rest of the month is. The hint
 * that says so used to be four gradients painted BEHIND the table, and every
 * cell that carries a background of its own covered them — `thead th`,
 * `tfoot td`, `tr.grand td` — so it showed on the rows band and stopped dead at
 * the heading strip. It is now a sticky `::after` drawn IN FRONT of the table,
 * fading to the card's own colour so the last figure dissolves rather than
 * ending mid-digit.
 *
 * Five of its declarations are load-bearing and not one of them is visible on
 * a laptop, which is the whole reason for this file:
 *
 *   `flex-shrink: 0` on the table — a flex item's default is `flex: 0 1 auto`,
 *      and a table allowed to shrink is squeezed to the width of the box. No
 *      overflow, no scroll, and the fade sits on a table that never moves.
 *   the fade OUTSIDE the `@supports` gate — it shipped inside it first, which
 *      left the phones that cannot follow a scroll with nothing at all, and
 *      "nothing at all" is what was reported as the bug. Only switching itself
 *      off is conditional.
 *   `opacity: 0` as the base INSIDE the gate — a scroll timeline with nothing
 *      to scroll is inactive, and an animation on an inactive timeline is not
 *      applied at all. Written the other way round, รวมทุกบริษัท drew a fade
 *      down a table that had nowhere to go.
 *   `pointer-events: none` — it lies over the last column's cells.
 *   `--card-fade` and not `transparent` — `transparent` is rgba(0, 0, 0, 0),
 *      so fading to it fades through grey.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

const HINT = '.table-wrap:has(> .acct-table)';
const GATE = '@supports (animation-timeline:';

/** Everything from the first rule of the hint to the end of its `@supports` gate. */
function hintBlock() {
  const start = css.indexOf(HINT);
  assert.ok(start > 0, 'the right-edge fade is gone from สรุป OT ส่งบัญชี');
  const gate = css.indexOf(GATE, start);
  assert.ok(gate > start, 'the fade lost the gate that switches it off at the far right');
  let depth = 0;
  for (let i = css.indexOf('{', gate); i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) {
      return { all: css.slice(start, i + 1), base: css.slice(start, gate), gate: css.slice(gate, i + 1) };
    }
  }
  throw new assert.AssertionError({ message: 'the @supports block never closes' });
}

// ── where it applies ────────────────────────────────────────────────────────

test('the fade is a phone rule, not a desktop one', () => {
  const phone = css.indexOf('@media screen and (max-width: 860px)');
  assert.ok(phone > 0, 'the 860px block is gone');
  assert.ok(css.indexOf(HINT) > phone,
    'the fade moved out of the phone block — on a desktop the table fits and there is nothing to promise');
});

test('it is scoped to the two sheets on this screen', () => {
  const { all } = hintBlock();
  for (const table of ['.acct-table', '.allco-table']) {
    assert.ok(all.includes(`.table-wrap:has(> ${table})`),
      `${table} is not reached — its card is the one that scrolls`);
  }
  // ตรวจสอบรายเดือน and สรุป OT แยกแผนก are other screens with other rules.
  assert.ok(!all.includes('.hr-table') && !all.includes('.dept-table'),
    'the fade reached a table it was not measured on');
});

// ── the declarations that do the work ───────────────────────────────────────

test('the table may not shrink — that is what leaves something to scroll', () => {
  assert.match(hintBlock().base, />\s*\.acct-table,[\s\S]*?\{[^}]*flex:\s*0\s+0\s+auto/,
    'the sheet lost `flex: 0 0 auto` — as an ordinary flex item it is squeezed to the card and never overflows');
});

test('the fade itself ships to every browser; only switching it off is gated', () => {
  const { base } = hintBlock();
  assert.match(base, /::after[\s\S]*?\{[^}]*background:\s*linear-gradient/,
    'the fade moved inside the @supports gate — the phones that cannot follow a scroll would get nothing,'
      + ' which is the state this was reported as');
});

test('it fades to the card, not through grey', () => {
  const { base } = hintBlock();
  assert.match(base, /linear-gradient\(to left, var\(--card\), var\(--card-fade\)\)/,
    '`transparent` is rgba(0, 0, 0, 0) — fading to it fades through grey, which is what `--card-fade` exists to avoid');
});

test('a table that fits draws no fade at all', () => {
  assert.match(hintBlock().gate, /::after[\s\S]*?\{[^}]*opacity:\s*0\s*;/,
    'the base opacity inside the gate is not 0 — on a scroller with nothing to scroll the timeline is'
      + ' inactive and the element falls back to exactly this declaration');
});

test('it does not take the tap meant for the cell under it', () => {
  assert.match(hintBlock().base, /::after[\s\S]*?\{[^}]*pointer-events:\s*none/,
    'the fade became clickable — it covers the last column of every row');
});

test('it adds nothing to the width the table already had', () => {
  const { base } = hintBlock();
  const width = /flex:\s*0\s+0\s+(\d+)px/.exec(base.slice(base.indexOf('::after')));
  const pull = /margin-left:\s*-(\d+)px/.exec(base);
  assert.ok(width && pull, 'the fade lost either its width or the margin that pulls it back over the table');
  assert.equal(pull[1], width[1],
    'the negative margin no longer matches the width — the box now widens the scroll it is describing');
});

test('the timeline is declared after the shorthand that would reset it', () => {
  const { gate } = hintBlock();
  const shorthand = gate.indexOf('animation:');
  const timeline = gate.indexOf('animation-timeline:', gate.indexOf('::after'));
  assert.ok(shorthand > 0 && timeline > shorthand,
    '`animation-timeline` is before `animation` — the shorthand resets it and the fade stops following the scroll');
});
