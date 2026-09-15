import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * รออนุมัติ และ คำขอถอนใบ — สองกองบนการ์ดเดียว สลับด้วยชิป.
 *
 * Asked on 2026-09-15: *"ถ้าเอาไปแสดงรวมกับตาราง รออนุมัติ ได้หรือไม่"*, and
 * the answer is a SWITCH rather than a merge. What was refused, and why, is the
 * thing this file exists to keep refused:
 *
 * ONE LIST WITH BOTH KINDS OF ROW IN IT WOULD HAVE COST EVERY CONTROL ON THE
 * QUEUE. The tick boxes, เลือกทั้งหมด, the batch bar and the สะสม / เพดาน
 * column all belong to a signature that has not been given yet. A withdrawal
 * request is an `approved` entry whose hours are already in the month's totals,
 * and the decision is whether to take them back out — so every one of those
 * controls would have had to learn to skip those rows, and the card would have
 * carried two buttons headed "ทั้งหมด" acting on two different lists. Two
 * tables that are never on screen together need none of that.
 *
 * WHAT IS PINNED HERE is the switch: that the chip bar exists only while there
 * is a second pile, that the queue's own machinery is not drawn behind the
 * other chip, and that the head's one button belongs to the pile on screen.
 *
 * The rows themselves are test/withdrawalRowLayout.test.js's.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const queue = read('components/ApprovalQueue.jsx');
const panel = read('components/WithdrawalRequests.jsx');
const css = read('app/styles.css');
/** The commentary quotes the Thai it is about, so an assertion that a word is
    NOT on the screen has to read the code without it. */
const code = queue.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ── the control itself ──────────────────────────────────────────────────────

/**
 * `.queue-tabs` WAS DEAD CSS FROM 2026-09-03 TO 2026-09-15 and is used again
 * rather than written again. It was built for ใบรอยืนยัน beside วันเกิดรอตรวจ;
 * when the birthday pile went, `components/QueueTabs.jsx` was deleted and the
 * block stayed. Its own comment states the case for a segmented control over
 * underlined tabs — these switch what the whole panel is, and the sidebar owns
 * the underline idiom — which is the same case, with different nouns.
 */
test('the switch is the sheet\'s own segmented control, not a new one', () => {
  assert.match(queue, /<div className="queue-tabs"/);
  assert.match(css, /\.queue-tabs \{/);
  assert.match(css, /\.queue-tabs button\.active \{/);
  assert.match(css, /\.queue-tabs \.count \{/);
  // `role="tablist"` and a selected state on each, so the pair is one control
  // to a screen reader rather than two buttons that happen to be adjacent.
  assert.match(queue, /role="tablist"/);
  assert.equal((queue.match(/role="tab"\n/g) || []).length, 2);
  assert.equal((queue.match(/aria-selected=\{/g) || []).length, 2);
});

/**
 * NO SECOND PILE, NO SEGMENTED CONTROL — and the card's head is then exactly
 * the head it was before any of this.
 *
 * Two reasons, and the app has paid for both already. `WithdrawalRequests`
 * returned `null` on an empty list because a permanent empty panel for a thing
 * that happens a few times a month becomes furniture a reader learns to look
 * past; and `QueueTabs.jsx` was DELETED rather than left as a tab bar with one
 * tab in it. A chip reading `คำขอถอน 0` every day of the month is both of those
 * mistakes at once.
 */
test('the chip bar is drawn only while there is something behind the second chip', () => {
  assert.match(queue, /const hasWithdraw = !delegatedOnly && wOpen > 0;/);
  assert.match(queue, /\{hasWithdraw \? \(/);
  // …and the ordinary heading is the other branch, not a thing that was
  // deleted along the way.
  assert.match(queue, /<span className="t-name">\{queueName\}<\/span>/);
});

/**
 * IT OPENS ON THE QUEUE, ALWAYS. Asked for in those words. Landing on คำขอถอน
 * whenever the queue happened to be empty is the mistake `queueBadge` in
 * components/App.jsx already had to undo once, on 2026-08-28: a screen that
 * answers a question differently depending on what is in it leaves its reader
 * unable to tell "nothing here" from "you were taken somewhere else".
 */
test('the screen opens on รออนุมัติ and is never moved off it by the data', () => {
  assert.match(queue, /const \[pile, setPile\] = useState\('queue'\);/);
  // The only automatic move is BACK, when the last request is answered and the
  // chip that named the pile goes with it.
  assert.match(queue, /useEffect\(\(\) => \{ if \(wOpen === 0\) setPile\('queue'\); \}, \[wOpen\]\);/);
  assert.ok(!/setPile\('withdraw'\)[\s\S]{0,40}useEffect/.test(code),
    'something moves the reader to the other pile on its own');
});

// ── what each chip is answerable for ────────────────────────────────────────

/**
 * THE QUEUE'S MACHINERY IS NOT DRAWN BEHIND THE OTHER CHIP. This is the whole
 * of why the two lists are two tables: the filter bar, the batch bar, the
 * pager and the table itself are about rows waiting for a signature, and none
 * of them means anything on a request to take hours back off the books.
 */
test('the filter bar, the batch bar, the table and the pager are the queue\'s alone', () => {
  // The card's markup only — the import list at the top of the file names
  // half of these and is not a rendering of any of them.
  const card = code.slice(code.indexOf('<div className="card flush">'));
  const at = card.indexOf('{!onWithdraw && (');
  assert.ok(at > 0, 'the queue half is no longer behind its own guard');
  const held = card.slice(at);
  for (const own of ['queue-tools', 'batch-bar', 'queue-mobile-bar', 'queue-table', 'TablePager']) {
    assert.ok(held.includes(own), `${own} has escaped the queue's own branch`);
    assert.ok(!card.slice(0, at).includes(own), `${own} is drawn on both chips`);
  }
});

/**
 * AND `PolicyDriftBanner` IS THE ONE BANNER BOTH PILES GET. คำขอถอนใบ prints
 * hours too, and a reader granting one is taking exactly those hours off the
 * books — a drift notice that appeared on one chip and not the other would be
 * a warning that can be stepped around by pressing a chip.
 */
test('the policy drift banner is above the switch, not inside one branch', () => {
  const drift = code.indexOf('<PolicyDriftBanner');
  const guard = code.indexOf('{!onWithdraw && (');
  assert.ok(drift > 0 && guard > 0 && drift < guard,
    'the drift banner has moved inside the queue\'s own branch');
});

/**
 * THE PANEL KEEPS FETCHING WHILE IT IS NOT ON SCREEN, and must: the chip that
 * switches to it is built from the count it reports, so a component that
 * counted only once it was looked at could never be the thing that says to
 * look. `active` decides what is DRAWN, never what is loaded.
 */
test('the second pile is mounted whatever the chip says, and draws only when chosen', () => {
  assert.match(queue, /<WithdrawalRequests\n\s+user=\{user\}\n\s+active=\{onWithdraw\}/);
  assert.match(queue, /onCount=\{onWithdrawCount\}/);
  // The fetch is in an effect with no dependency on `active`…
  assert.match(panel, /useEffect\(\(\) => \{ load\(\); \}, \[\]\);/);
  // …and the early return that `active` drives comes AFTER the count has been
  // reported, or the chip could never appear.
  assert.ok(panel.indexOf('onCount?.(openCount, batchCount)') < panel.indexOf('if (!active) {'),
    'the count is reported behind the guard that hides the panel');
});

/**
 * THE FETCH ERROR OUTLIVES THE PANEL. A failed load leaves the list null, which
 * makes the count nought, which takes the chip away — and a missing chip reads
 * as *nobody has asked for anything*, which is the one wrong thing it could
 * say.
 */
test('a load that failed says so even from behind the other chip', () => {
  assert.match(panel, /if \(!active\) \{\n\s+return !rows && error/);
  assert.match(panel, /โหลดคำขอถอนใบไม่สำเร็จ/);
});

// ── the one button in the head ──────────────────────────────────────────────

/**
 * ONE BUTTON AT A TIME, AND IT BELONGS TO THE PILE ON SCREEN.
 * + บันทึก OT แทนพนักงาน files into the queue; อนุมัติให้ถอนทั้งหมด answers the
 * other pile. Drawing both would put two controls acting on two different lists
 * at the same corner of one card — which is the objection to merging the lists,
 * in miniature.
 */
test('the head carries the pile\'s own button and never both', () => {
  assert.match(queue, /\{onWithdraw \? \(/);
  assert.match(queue, /อนุมัติให้ถอนทั้งหมด/);
  assert.match(queue, /\+ บันทึก OT แทนพนักงาน/);
  // The batch button is no longer drawn by the component that owns the list.
  assert.ok(!/อนุมัติให้ถอนทั้งหมด/.test(panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/title="[^"]*"/g, '')
    .slice(0, panel.indexOf('{grantingAll && ('))),
  'the panel is drawing a batch button of its own as well');
});

/**
 * ABOVE TWO OR MORE, AND COUNTED OFF WHAT A PRESS WOULD ACTUALLY CLEAR.
 *
 * On a single request the button would do exactly what the button on the row
 * does, phrased as though it did more. And `wBatch` — the open requests THIS
 * READER can decide — rather than `wOpen`, because past a งวด's cutoff those
 * are not the same list: a button headed ทั้งหมด that clears part of the list
 * lies twice, in its name and again in the failure list the server hands back
 * for the rest.
 */
test('อนุมัติให้ถอนทั้งหมด is drawn above two or more, off the list it can clear', () => {
  assert.match(queue, /wBatch > 1 && \(/);
  // Amber OUTLINE. It commits nothing — it opens a list to read — and the table
  // below it holds a filled red on every row: a second filled thing in the head
  // would read as the same press said twice.
  assert.match(queue, /className="btn ghost warn sm withdraw-batch"/);
  const at = css.indexOf('.btn.ghost.warn {');
  assert.ok(at > 0, '.btn.ghost.warn — no such rule');
  const warn = css.slice(at, css.indexOf('}', at));
  assert.match(warn, /background: var\(--card\)/);
  assert.match(warn, /border-color: var\(--amber-line\)/);
});

/**
 * THE PRESS IS A COUNTER, NOT A BOOLEAN — the reason `openSignal` is one in
 * components/App.jsx. A boolean the parent has to set back to false leaves it
 * holding a piece of the child's state, and the two get out of step the first
 * time the dialog is closed from inside. `0` is "never pressed".
 */
test('the head opens the panel\'s own dialog by signal, and owns none of it', () => {
  assert.match(queue, /const \[batchSignal, setBatchSignal\] = useState\(0\);/);
  assert.match(queue, /onClick=\{\(\) => setBatchSignal\(\(n\) => n \+ 1\)\}/);
  assert.match(panel, /if \(batchSignal\) \{ setGrantingAll\(true\); setBatchNote\(''\); \}/);
  // The dialog, its list and its writes stay with the list they are about.
  assert.ok(!/grantingAll|batchNote/.test(code), 'the queue has taken a piece of the dialog\'s state');
});

// ── the count on each chip ──────────────────────────────────────────────────

/**
 * EACH CHIP CARRIES ITS OWN PILE; THE NAV BADGE CARRIES THE SUM — which is the
 * arrangement `.queue-tabs .count` describes in app/styles.css and which came
 * back with the control. The badge answers *is there anything for me over
 * there*, a question about the screen; these answer *which pile*.
 *
 * `mine.length` AND NOT `countLabel`. A chip has room for a figure, not for
 * `3 / 12 รายการ · รอหัวหน้า 3` — and putting a DIFFERENT number where the
 * fuller one used to be is the mistake this screen has been careful about
 * twice: one queue quoting two figures. So the chip carries the pile and
 * `countLabel` says the rest of it, whole, on the line below.
 */
test('the chips count one pile each, and countLabel is not made to fit one', () => {
  assert.match(queue, /\{entries && <span className="count">\{mine\.length\}<\/span>\}/);
  assert.match(queue, /<span className="count">\{wOpen\}<\/span>/);
  // Withheld until the list has arrived: a `0` on a chip is a claim about an
  // answer that has not come back.
  assert.ok(!/<span className="count">\{mine\.length \|\| 0\}/.test(queue));
  // The fuller figure is drawn once, in the hint, and only when the chips have
  // taken the two places it usually lives.
  assert.match(queue, /\{hasWithdraw && countLabel && ` · \$\{countLabel\}`\}/);
  assert.match(queue, /\{!hasWithdraw && countLabel && <span className="chip muted">/);
});

/**
 * THE NAV BADGE ALREADY COUNTS BOTH PILES, since 2026-09-03, and nothing here
 * changed it. Pinned as a pair with the chips because the two are one idea: the
 * sum gets you to the screen, the chips tell you which pile once you are there.
 */
test('and the badge in the nav is still the sum of the two', () => {
  const app = read('components/App.jsx');
  assert.match(app, /const queueBadge = \(ownPending, overlap = 0\) => ownPending\n\s*\+ Math\.max\(0, \(counts\.withdrawalOpen \|\| 0\) - overlap\);/);
  assert.match(app, /badge: queueBadge\(counts\.pendingMgr\),/);
  // ฝ่ายบุคคล's own overlap: an open request on a `pending_hr` entry is already
  // inside `pendingHr`, so it is taken off rather than counted twice.
  assert.match(app, /badge: queueBadge\(counts\.pendingHr, counts\.withdrawalOpenPendingHr\),/);
});
