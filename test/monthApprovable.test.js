import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { approvalPermission } from '../lib/delegation.js';
import { needsOverCeilingReason } from '../lib/caps.js';

/**
 * ใบที่กดยืนยันได้จากหน้า ตรวจสอบประจำเดือน — WHICH ROWS, AND WHO DECIDES.
 *
 * ── THE ONE MISTAKE THIS FILE EXISTS TO PREVENT ─────────────────────────────
 *
 * `status === 'pending_hr'` is the obvious way to answer "may this be confirmed
 * from here", and it is **wrong**, twice over:
 *
 *   · **§6 is not a rule about statuses.** One request needs two people, so
 *     whoever signed the หัวหน้า step is out of the ฝ่ายบุคคล step of that same
 *     request — `signedManagerStep` in lib/delegation.js. That is a fact about
 *     one entry and one reader TOGETHER, and no filter over a status field can
 *     see it. A screen that offers such a row gets a 409 on press.
 *   · **`pendingCount` is not `pendingHrCount`.** The field this route already
 *     had counts `status !== 'approved'`, which sweeps in `pending_mgr` — rows
 *     waiting on a หัวหน้า, that ฝ่ายบุคคล may not sign at all. A tick-box built
 *     on it is a tick-box that answers *ต้องผ่านการอนุมัติจากหัวหน้าก่อน*.
 *
 * So the route asks `approvalPermission` — the same decider the approve route
 * itself asks — and the screen offers exactly what the server will accept. The
 * first two tests below run that decider on real-shaped entries rather than
 * reading the source, because the claim being made is about behaviour.
 *
 * ── AND WHY THE COST IS SMALL ───────────────────────────────────────────────
 *
 * `delegations: []`. Read the `pending_hr` branch: for an `isHr` reader the
 * claim is never consulted, so a delegation could not change one of these
 * answers if it were fetched. It is what components/ApprovalQueue.jsx says in
 * four words — *the HR confirmation queue is nobody's to lend*.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const route = read('app/api/reports/monthly/[period]/route.js');

const HR = { _id: 'hr1', role: 'hr' };
const OTHER_HR = { _id: 'hr2', role: 'hr' };
const FINANCE = { _id: 'fin1', role: 'finance' };

/**
 * `code` IS NOT DECORATION ON THIS FIXTURE.
 *
 * `approvalPermission` reaches `entryCompany`, which THROWS on an entry whose
 * employee was not populated — *"a route that reaches this without its employee
 * has a bug in its query, and that is a thing to fix rather than to absorb"*.
 * The monthly route populates `'code name position birthDate company'`, so the
 * real caller is safe; a fixture without it would be testing a shape the route
 * never produces.
 */
const entry = (over) => ({
  _id: 'e1',
  employee: { _id: 'emp1', role: 'employee', code: 'PM00112' },
  department: { _id: 'dep1' },
  status: 'pending_hr',
  totals: { otHours: 6 },
  ...over,
});

// ── 1. the rule, run rather than read ───────────────────────────────────────

test('ฝ่ายบุคคล may confirm a รอ HR row from this screen, with no delegation fetched', () => {
  const may = approvalPermission({ user: HR, entry: entry(), delegations: [] });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'hr');
});

test('รอหัวหน้า is not this screen’s to sign, and the refusal says why', () => {
  // The row IS pending and IS in the month at the default สถานะที่นับ, so a
  // count of "everything not yet approved" would have offered it.
  const may = approvalPermission({ user: HR, entry: entry({ status: 'pending_mgr' }), delegations: [] });
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /ต้องผ่านการอนุมัติจากหัวหน้าก่อน/);
});

test('§6 — the person who signed the หัวหน้า step is refused the ฝ่ายบุคคล step', () => {
  // ⚠ THE CASE A STATUS FILTER CANNOT SEE. Same status, same month, same
  // department — and one reader may sign it while another may not.
  // `managerDecision.by` — who PRESSED the first button. Not `onBehalfOf`: a
  // stand-in signing on a manager's authority is still their own signature, and
  // the manager named in `onBehalfOf` never touched the entry.
  const signed = entry({ managerDecision: { by: 'hr1' } });
  const mine = approvalPermission({ user: HR, entry: signed, delegations: [] });
  const theirs = approvalPermission({ user: OTHER_HR, entry: signed, delegations: [] });
  assert.equal(mine.ok, false, 'one person signed both steps of one request');
  assert.equal(mine.status, 409);
  assert.match(mine.error, /ใบหนึ่งต้องผ่านผู้เซ็นสองคน/);
  assert.equal(theirs.ok, true, 'a second ฝ่ายบุคคล is exactly who §6 asks for');
});

test('a filer does not confirm their own request', () => {
  const own = entry({ employee: { _id: 'hr1', role: 'hr' } });
  // ⚠ ฝ่ายบุคคล ARE the documented exception here (the login is shared by the
  // whole department, so "the same person twice" is not checkable), which is
  // why this row is asserted with a การเงิน instead — the general rule is what
  // matters, and it is the reason the screen must not build its own.
  const may = approvalPermission({
    user: FINANCE,
    entry: { ...own, employee: { _id: 'fin1', role: 'finance', code: 'PM00120' } },
    delegations: [],
  });
  assert.equal(may.ok, false);
  assert.match(may.error, /ใบคำขอของตนเอง/);
});

test('needsOverCeilingReason is what decides whether a sentence is owed', () => {
  assert.equal(needsOverCeilingReason(entry()), false);
  assert.equal(needsOverCeilingReason(entry({ capExceeded: true })), true);
  // A waived row answers NO: the exception was already granted in writing, and
  // asking the next signer to justify it again is asking them to re-decide
  // something that is not theirs.
  assert.equal(needsOverCeilingReason(entry({ capExceeded: false, capOverride: true })), false);
});

// ── 2. the route asks that rule, and not a status test ──────────────────────

test('the route decides with approvalPermission, per entry, per reader', () => {
  assert.match(route, /import \{ approvalPermission \} from '@\/lib\/delegation\.js';/);
  assert.match(route, /const may = approvalPermission\(\{ user, entry, delegations: \[\] \}\);/);
  assert.match(route, /if \(!may\.ok\) continue;/);
  // The status test is a cheap pre-filter in front of the real decider, never
  // instead of it — everything that survives it still has to be granted.
  assert.match(route, /if \(entry\.status !== 'pending_hr'\) continue;/);
});

test('the two counts are kept apart, and neither is pendingCount', () => {
  // Rows AT the step, whoever is reading…
  assert.match(route, /pendingHrCount: group\.entries\.filter\(\(e\) => e\.status === 'pending_hr'\)\.length,/);
  // …and rows this reader may actually move. On nearly every month they are
  // equal; the day they differ, §6 is the difference and it has a name.
  assert.match(route, /approvable: approvableOf\(group\.entries\),/);
  // The old field is untouched and still means what it meant. It is not
  // repurposed, because something else reads it: the ค้าง n line on the row.
  assert.match(route, /pendingCount: group\.entries\.filter\(\(e\) => e\.status !== 'approved'\)\.length,/);
});

test('the payload carries what a batch needs and nothing it does not', () => {
  // ids to POST, a count and hours to say out loud before anybody presses, and
  // the number of rows that will make the dialog demand a sentence.
  for (const field of ['ids', 'count:', 'hours:', 'capOver', 'capped']) {
    assert.ok(route.includes(field), `approvable lost ${field}`);
  }
  assert.match(route, /hours \+= entry\.totals\?\.otHours \|\| 0;/);
  // ⚠ NOT A COUNT ANY MORE. The dialog it feeds demands a SENTENCE for these
  // rows, and คิวรออนุมัติ's confirm box settled what follows from that:
  // *เมื่อบังคับให้เขียนเหตุผล ก็ต้องให้ข้อมูลพอที่จะเขียนได้*. So the route
  // names them — with `describeBreaches`, the same function the queue calls in
  // the browser, asked on whichever side is holding the entry.
  assert.match(route, /if \(needsOverCeilingReason\(entry\)\) \{/);
  assert.match(route, /capOver \+= 1;/);
  assert.match(route, /text: describeBreaches\(entry\)\.map\(\(b\) => b\.text\)\.join\(' · '\) \|\| 'เกินเพดานแผนก',/);
  // Rounded where every other figure in this app is.
  assert.match(route, /hours: Math\.round\(hours \* 100\) \/ 100,/);
});

test('the three signers and การเงิน are offered nothing, because they sign nothing here', () => {
  // Their step is `pending_mgr` and it belongs to รออนุมัติ OT. A field naming
  // rows they cannot act on is an offer with nothing behind it.
  assert.match(route, /const maySign = mayCorrectEntries\(user\);/);
  assert.match(route, /if \(!maySign\) return null;/);
  assert.match(route, /mayCorrectEntries \} from '@\/lib\/entries\.js';/);
});
