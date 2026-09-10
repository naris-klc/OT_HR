import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คิวรออนุมัติ — ชื่อพนักงานที่ยาวทับคอลัมน์วันที่, and why the answer is a
 * second line rather than a wider column.
 *
 * Reported 2026-09-10: "หน้ารออนุมัติ เวลาที่เปิดแถบบาร์ด้านข้าง ชื่อของพนักงานที่
 * ยาว ๆ มันจะทับกับวันที่". The employee cell's name carried `white-space:
 * nowrap`, and a nowrap cell DOES NOT CLIP — it paints its text over the cell
 * beside it, so the surname was drawn across the date.
 *
 * WHAT MOVED WAS THE ROSTER. `th.who-col`'s 168px was measured against a demo
 * roster whose names carried no คำนำหน้า; the live one (2026-09-08, 164 people)
 * joins the title to the given name, which put six or seven characters on every
 * name in the queue. Measured in the running app on 2026-09-10, with the rule
 * on and then off: 116 of 313 rows overflowed at 1440, the worst by 42px.
 *
 * WHAT IS PINNED HERE is the allocation, because the fix is three declarations
 * that only work together and each of them reads as tidy-up on its own:
 *
 *   · the name is NOT in the queue's nowrap list, and the date and the span
 *     still are — they are single facts on one line and the row's height is
 *     theirs to keep;
 *   · the name wraps at `normal`, NOT at `break-word`/`anywhere`: no token on
 *     the roster is wider than this cell (the widest, "นางสาวฟ้าประทาน", is
 *     115.4px against 145.2), so the only break this rule ever takes is the
 *     space before the นามสกุล. Breaking Thai mid-word is the complaint the
 *     nowrap was reached for in the first place;
 *   · 168px stays 168px. A column that held the longest name on one line would
 *     be 234, and ฝ่ายบุคคล's twelve columns have 8px of slack at 1440.
 *
 * And the phone block must not restate `white-space` on the same element: it
 * said `normal` there long before the wide rule did, and two copies of one
 * declaration is how the two screens come to disagree.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** CRLF here, LF on the Linux box that serves the same commit — normalised so
    the assertions are about the CSS and not about the checkout. */
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');
const jsx = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8').replace(/\r\n/g, '\n');

const PHONE_AT = css.indexOf('@media screen and (max-width: 860px) {');
assert.ok(PHONE_AT > 0, 'the 860px block is not where the sheet says it is');
const wide = css.slice(0, PHONE_AT);
const phone = css.slice(PHONE_AT);

/** One rule, from its selector to the end of its declarations. */
function rule(half, selector) {
  const at = half.indexOf(selector);
  assert.ok(at > 0, `${selector} — no such rule`);
  return half.slice(at, half.indexOf('}', at));
}

test('the name is allowed a second line on the wide layout', () => {
  const decl = rule(wide, '.queue-table td.who-col .who-name {');
  assert.match(decl, /white-space:\s*normal/,
    'the employee name must be allowed to wrap — nowrap paints it over the date column');
});

test('and it wraps at the space, not inside a Thai word', () => {
  const decl = rule(wide, '.queue-table td.who-col .who-name {');
  assert.doesNotMatch(decl, /overflow-wrap|word-break|hyphens/,
    'no token on the roster is wider than this cell, so a mid-word break is a bug, not a fallback');
});

test('the date and the span keep their nowrap, and the name is not among them', () => {
  const at = wide.indexOf('.queue-table td.when-col,');
  assert.ok(at > 0, 'the queue nowrap rule has moved');
  const decl = wide.slice(at, wide.indexOf('}', at));
  assert.match(decl, /white-space:\s*nowrap/);
  assert.doesNotMatch(decl, /who-name/,
    'the name is back in the nowrap list — that is the bug reported on 2026-09-10');
});

test('the phone block does not restate white-space on the same element', () => {
  const decl = rule(phone, '.queue-table td.who-col .who-name {');
  assert.doesNotMatch(decl, /white-space/,
    'the wide rule says normal; a second copy here is one more place for the two to disagree');
  assert.match(decl, /font:\s*600 15px/, 'the phone still sets the card-sized face');
});

test('the column is still 168px, which is what the wrap is measured against', () => {
  assert.match(rule(css, 'th.who-col {'), /width:\s*168px/,
    'widening this column pushes ฝ่ายบุคคล\u2019s twelve into sideways scrolling at 1440 — re-measure before changing it');
});

test('the cell still draws the name in its own element for the rule to reach', () => {
  assert.match(jsx, /<div className="who-name">/,
    'the name must stay its own block — a bare text node cannot be wrapped without the code beside it');
  assert.match(jsx, /<span className="nb">\{e\.employee\?\.code\}<\/span>/,
    'the employee code is the one part of this cell that may not break');
});

/**
 * ── and the second half, which is not CSS ────────────────────────────────
 * `white-space: normal` alone puts the break in the wrong place. Chrome fills
 * the line greedily and Thai offers a break between every pair of words, space
 * or no space, so the surname was cut in half and the space was left idling at
 * the end of line one. `word-break: keep-all` and `line-break: strict` were
 * both tried against the same rows and moved nothing. What decides it is the
 * markup: every word in `.nb`, every space outside one.
 */
test('the name is drawn as unbreakable words with the spaces between them', () => {
  const at = jsx.indexOf('function WhoName({ name })');
  assert.ok(at > 0, 'WhoName is gone — the name is back to one text node');
  const body = jsx.slice(at, jsx.indexOf('\nfunction ', at + 1));
  assert.match(body, /String\(name \|\| ''\)\.split\(' '\)/,
    'the split is on the space, which is the only break the cell is allowed');
  assert.match(body, /<span key=\{i\} className="nb">\{word\}<\/span>/,
    'each word must carry .nb — that is what forbids the break inside a Thai word');
  assert.match(body, /\.\.\.\(i \? \[' '\] : \[\]\)/,
    'the space must be its own node OUTSIDE the span, or there is nothing left to break at');
  assert.match(jsx, /<div className="who-name"><WhoName name=\{e\.employee\?\.name\} \/><\/div>/,
    'the cell must render the name through WhoName');
});

test('.nb is still the class that means "never broken"', () => {
  assert.match(rule(css, '.nb {'), /white-space:\s*nowrap/,
    'WhoName leans on .nb; if that stops meaning nowrap the names break mid-word again');
});
