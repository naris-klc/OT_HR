import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { approvalPermission } from '../lib/delegation.js';

/**
 * ยืนยันทีละใบ จากในหน้า ตรวจสอบใบของพนักงาน — THE OTHER HALF OF THE BATCH.
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

test('the list asks for the verdict and draws a button only where it says yes', () => {
  assert.match(list, /&scan=check&decide=check/);
  assert.match(list, /\{e\.decide && \(e\.decide\.ok \? \(/);
  assert.match(list, /onClick=\{\(\) => confirmEntry\(e\)\}/);
  // NOT gated on `mayEdit`: confirming is not correcting, and the route already
  // sends `null` to anybody it did not offer this to.
  const from = list.indexOf('{e.decide && (e.decide.ok');
  const block = list.slice(from, list.indexOf('ยืนยันไม่ได้', from));
  assert.ok(!block.includes('mayEdit'), 'the button borrowed the editor’s permission');
});

test('a row this reader may not sign says so in words, not as a dead control', () => {
  // `.cell-sub.th` is this cell's own voice for a statement about the row —
  // the same one แก้ไขไม่ได้ uses — and the `title` is the route's sentence, so
  // the screen and a 409 cannot read as two different rules.
  assert.match(list, /<span className="cell-sub th" title=\{e\.decide\.why\}>ยืนยันไม่ได้<\/span>/);
});

test('a ceiling row still owes a sentence here, and it is the same sentence', () => {
  // Imported from lib/caps.js, never typed out — the same protection
  // components/MonthConfirm.jsx keeps for the batch dialog.
  assert.match(list, /import \{ describeBreaches, OVER_CEILING_REASON_APPROVE \} from '@\/lib\/caps\.js';/);
  assert.match(list, /window\.prompt\(\[\s*\n\s*OVER_CEILING_REASON_APPROVE,/);
  // Cancelling, or an empty line, cancels the approval — the route would refuse
  // it anyway, and a reader should not learn a rule by watching a request fail.
  assert.match(list, /if \(!note \|\| !note\.trim\(\)\) return;/);
  assert.match(list, /ยืนยัน\{e\.decide\.needsReason \? ' \*' : ''\}/);
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
