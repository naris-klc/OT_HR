import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { approvalPermission } from '../lib/delegation.js';

/**
 * อนุมัติทีละใบ จากในหน้า ตรวจสอบใบของพนักงาน — THE OTHER HALF OF THE BATCH.
 *
 * (It was ยืนยันทีละใบ until 2026-09-11; see the word test at the bottom.)
 *
 * ── WHY THIS IS NOT A SECOND WAY TO DO THE SAME THING ───────────────────────
 *
 * ตรวจสอบประจำเดือน confirms people in batches, and it deliberately **refuses
 * to tick anybody the scan comparison flagged** (§5.2): a row nobody has looked
 * at should not be signable with one press, and the way through it is to open
 * the person and read the punch times printed beside the request that claimed
 * them.
 *
 * WITHOUT THIS FILE'S FEATURE THAT IS A DEAD END. The reader opens the person,
 * reads exactly what they came to read, decides the row is fine — and then has
 * to cross to คิวรออนุมัติ, find the same row among everybody else's, act on it
 * there, and come back. That is the *"เสียเวลาสลับหน้าไปมา"* the whole round was
 * asked to end, and §5.2 would have manufactured more of it rather than less.
 *
 * So the two features are one feature: **the batch is the fast path for rows
 * nothing is wrong with, and this is the considered path for the rest.** Ship
 * either alone and the screen is worse than it was.
 *
 * ── AND FOR THE THIRD TIME, THE SERVER DECIDES ──────────────────────────────
 *
 * `decide=check` carries `approvalPermission`'s verdict beside each row — the
 * same decider the approve route asks, and the same one the monthly report asks
 * for `approvable`. Three screens, one rule. §6 (one ใบ needs two people) is a
 * fact about one entry and one reader TOGETHER; a browser cannot see it, and
 * every attempt to shortcut it with `status === 'pending_hr'` offers a control
 * that answers 409.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const route = read('app/api/entries/route.js');
const list = read('components/HrEntries.jsx');

// ── 1. the route's verdict ──────────────────────────────────────────────────

test('decide=check is opt-in, and it is approvalPermission that answers', () => {
  assert.match(route, /scan, decide,\s*\n\s*\} = query\(req\);/);
  assert.match(route, /if \(decide === 'check' && entries\.length && mayCorrectEntries\(user\)\) \{/);
  assert.match(route, /const may = approvalPermission\(\{ user, entry, delegations: \[\] \}\);/);
  // A cheap pre-filter in front of the real decider, never instead of it.
  assert.match(route, /if \(entry\.status !== 'pending_hr'\) \{ entry\.decide = null; continue; \}/);
});

test('the refusal travels with the verdict, in the route’s own words', () => {
  // ⚠ A greyed control with no explanation is the failure `actionable` was
  // written to fix on คิวรออนุมัติ. Here the likeliest reason is §6, which is
  // not something a reader can deduce from a dead button — so the sentence the
  // route would have answered with is carried to the screen instead.
  assert.match(route, /why: may\.ok \? '' : may\.error,/);
  assert.match(route, /needsReason: may\.ok \? needsOverCeilingReason\(entry\) : false,/);
});

test('it is offered to ฝ่ายบุคคล and ผู้ดูแลระบบ only', () => {
  // The three signers and การเงิน sign `pending_mgr`, which belongs to
  // รออนุมัติ OT. Offering them a control here would be offering a 409.
  assert.match(route, /mayCorrectEntries,\s*\n\} from '@\/lib\/entries\.js';/);
  // …and `delegations: []` is sound for the readers it IS offered to: in the
  // `pending_hr` branch an `isHr` reader is never asked for a claim.
  const hr = { _id: 'hr9', role: 'hr' };
  const entry = {
    _id: 'x1',
    employee: { _id: 'e9', role: 'employee', code: 'PM00119' },
    department: { _id: 'd9' },
    status: 'pending_hr',
    totals: { otHours: 4 },
  };
  assert.equal(approvalPermission({ user: hr, entry, delegations: [] }).ok, true);
  // …and §6 still bites, which is the whole reason a status test will not do.
  const signedByThem = { ...entry, managerDecision: { by: 'hr9' } };
  assert.equal(approvalPermission({ user: hr, entry: signedByThem, delegations: [] }).ok, false);
});

// ── 2. the button ───────────────────────────────────────────────────────────

test('every row gets an อนุมัติ — green where the verdict says yes, grey where it does not', () => {
  /**
   * ⚠ THIS TEST READ "draws a button only where it says yes" UNTIL 2026-09-11,
   * and it asserted `{e.decide && (e.decide.ok ? (` plus the ABSENCE of
   * `mayEdit` from the block. Both were reversed the same day, in one
   * instruction: *ปุ่ม "ยืนยัน" เปลี่ยนเป็นคำว่า "อนุมัติ" และให้แสดงทุกแถว ถ้า
   * กดได้เป็นสีเขียว ถ้า disable ไม่มีสี*.
   *
   * The old shape put three different things down one column — a live button, a
   * grey sentence, and on a `pending_mgr` row nothing at all — so finding the
   * one press meant reading every cell. One shape in two states can be scanned.
   */
  assert.match(list, /&scan=check&decide=check/);
  assert.match(list, /\{mayEdit && \(e\.decide\?\.ok \? \(/);
  assert.match(list, /onClick=\{\(\) => confirmEntry\(e\)\}/);

  // GREEN IS PLAIN `.btn`, which is the filled one — `btn ghost` is the white
  // card and would be neither green nor obviously the row's main act. The dead
  // one is the SAME class plus `disabled`, so the browser's own state does the
  // colour and no rule in this app has to name a second grey.
  const from = list.indexOf('{mayEdit && (e.decide?.ok');
  const block = list.slice(from, list.indexOf('{!mayEdit ? null : closed', from));
  assert.match(block, /<button\s+className="btn sm with-icon"\s+onClick=/);
  assert.match(block, /<button className="btn sm with-icon" disabled aria-hidden="true">/);
  assert.ok(!block.includes('btn ghost'), 'the approve button went back to a ghost');
  assert.equal((block.match(/อนุมัติ/g) || []).length >= 2, true);

  // ⚠ AND IT IS `mayEdit`-GATED NOW, which is the one gate it GAINED. It read
  // "NOT gated on `mayEdit`: confirming is not correcting" until 2026-09-11 —
  // true while the button was drawn only where it could be pressed, since the
  // route sends `decide` to `mayCorrectEntries` readers alone and a การเงิน
  // reader therefore saw nothing. Drawing every row would hand that reader a
  // column of grey buttons for an act no screen will ever offer them.
  assert.match(list, /\{mayEdit && \(/);
});

test('a dead อนุมัติ carries its reason on the wrapper, because the button cannot', () => {
  /**
   * A DISABLED BUTTON DISPATCHES NO POINTER EVENTS, so a `title` on the button
   * never opens — the hover falls through to the ancestor. That is why the span
   * exists at all, and it is the same arrangement `.act-watch` uses on
   * คิวรออนุมัติ OT.
   *
   * ⚠ THE SENTENCE USED TO BE THE WHOLE CONTROL. This read
   * `<span className="cell-sub th" title={e.decide.why}>ยืนยันไม่ได้</span>`
   * until 2026-09-11 — words instead of a dead control, which was the right
   * answer while only SOME rows could be refused. It is not the answer once
   * every row carries the button: the words would be the odd cell out.
   */
  assert.match(list, /<span\s+className="act-why"\s+title=\{whyNotApprovable\(e\)\}\s+aria-label=\{whyNotApprovable\(e\)\}\s+role="note"\s*>/);
  // The wrapper is the hover target and needs a box of its own; without this it
  // is a text box round a flex child and sits off the row's baseline.
  const css = read('app/styles.css');
  assert.match(css, /\.entry-actions \.act-why \{ display: inline-flex; flex: none; \}/);

  /**
   * ── FOUR SENTENCES FOR THE FOUR STATUSES THE ROUTE DOES NOT JUDGE ─────────
   *
   * `decide` is `null` on everything but `pending_hr`, so those rows have no
   * server verdict to quote and this screen writes them. Where there IS a
   * verdict, `decide.why` is used verbatim — the route's own words, so the
   * screen and a 409 cannot read as two different rules.
   */
  assert.match(list, /function whyNotApprovable\(entry\) \{/);
  assert.match(list, /if \(entry\.decide\) return entry\.decide\.ok \? '' : entry\.decide\.why;/);
  assert.match(list, /if \(entry\.status === 'pending_mgr'\) \{/);
  assert.match(list, /ใบนี้ยังอยู่ที่ขั้นหัวหน้าแผนก — เมื่อหัวหน้าเซ็นแล้วจึงอนุมัติได้ที่นี่/);
  assert.match(list, /if \(entry\.status === 'approved'\) return 'ใบนี้อนุมัติแล้ว';/);
  assert.match(list, /if \(entry\.status === 'rejected'\) return 'ใบนี้ถูกไม่อนุมัติแล้ว ไม่มีอะไรให้อนุมัติ';/);
  assert.match(list, /if \(entry\.status === 'cancelled'\) return 'ใบนี้ถูกยกเลิกแล้ว ไม่มีอะไรให้อนุมัติ';/);
});

test('the word is อนุมัติ on both screens that sign the same ใบ', () => {
  // ⚠ IT WAS `ยืนยัน` HERE UNTIL 2026-09-11, while คิวรออนุมัติ OT had already
  // stopped calling it that — two screens, one act, two words. `ยืนยัน` keeps
  // the meaning it actually has, *are you sure*, and nothing else.
  // ON THE RENDERED TEXT ONLY. The comments in that file still quote both old
  // strings, deliberately — a superseded wording is kept and marked here rather
  // than deleted, so the next reader knows the screen was reworded and not
  // written this way from the start.
  assert.ok(!list.includes("ยืนยัน{e.decide"), 'ยืนยัน came back as a button label');
  assert.ok(!list.includes('>ยืนยันไม่ได้</span>'), 'the old refusal sentence is still drawn');
  assert.match(list, /\? 'ใบนี้เกินเพดาน — ต้องระบุเหตุผลก่อนอนุมัติ'/);
  assert.match(list, /: 'อนุมัติใบนี้ · จะเข้าสู่รายงานส่งออกทันที'\}/);
});

test('a ceiling row still owes a sentence here, and it is the same sentence', () => {
  // Imported from lib/caps.js, never typed out — the same protection
  // components/MonthConfirm.jsx keeps for the batch dialog.
  assert.match(list, /import \{ describeBreaches, OVER_CEILING_REASON_APPROVE \} from '@\/lib\/caps\.js';/);
  assert.match(list, /window\.prompt\(\[\s*\n\s*OVER_CEILING_REASON_APPROVE,/);
  // Cancelling, or an empty line, cancels the approval — the route would refuse
  // it anyway, and a reader should not learn a rule by watching a request fail.
  assert.match(list, /if \(!note \|\| !note\.trim\(\)\) return;/);
  assert.match(list, /อนุมัติ\{e\.decide\.needsReason \? ' \*' : ''\}/);
});

test('settling a row re-reads the month behind this screen', () => {
  // ⚠ `onChanged` is not housekeeping. It is what refreshes `approvable` on the
  // table underneath — so a reader who comes back out finds the tick-box for
  // this person alive, instead of still greyed for a row they just settled.
  const fn = list.slice(list.indexOf('async function confirmEntry(entry)'));
  const body = fn.slice(0, fn.indexOf('async function voidEntry'));
  assert.match(body, /await api\.post\(`\/entries\/\$\{entry\._id\}\/approve`, note \? \{ note: note\.trim\(\) \} : undefined\);/);
  assert.match(body, /await load\(\);/);
  assert.match(body, /onChanged\?\.\(\);/);
});
