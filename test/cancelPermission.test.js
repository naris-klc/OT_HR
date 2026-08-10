import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelPermission, editPermission, refileState } from '../lib/entries.js';
import { countsTowardCap } from '../lib/caps.js';

/**
 * Withdrawing one's own request: who may, when, and what it costs them.
 *
 * The line is the first signature. Until a manager has approved, the request is
 * the employee's own business; after that it carries somebody's decision and
 * only HR moves it.
 */

const employee = { _id: 'emp-1', role: 'employee' };
const other = { _id: 'emp-2', role: 'employee' };

const entry = (over = {}) => ({ employee: 'emp-1', status: 'pending_mgr', ...over });

test('the employee may withdraw their own request while it waits for the manager', () => {
  assert.deepEqual(cancelPermission(employee, entry()), { ok: true });
});

test('the first approval ends it — pending_hr is out of the employee’s hands', () => {
  const result = cancelPermission(employee, entry({ status: 'pending_hr' }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /ฝ่ายบุคคล/, 'the message has to say where to go instead');
});

test('an approved request is not withdrawn by the person it belongs to', () => {
  assert.equal(cancelPermission(employee, entry({ status: 'approved' })).ok, false);
});

test('a finished request cannot be withdrawn again', () => {
  for (const status of ['rejected', 'cancelled']) {
    const result = cancelPermission(employee, entry({ status }));
    assert.equal(result.ok, false, status);
    assert.equal(result.status, 409);
  }
});

test('somebody else’s pending request is not withdrawable', () => {
  const result = cancelPermission(other, entry());
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('an unpopulated employee id resolves the same as a populated document', () => {
  assert.deepEqual(cancelPermission(employee, entry({ employee: { _id: 'emp-1' } })), { ok: true });
});

/**
 * The two rules are meant to agree about who owns a request and until when.
 * They are written separately — withdrawing is not editing — so this is the
 * check that they have not drifted apart at the one point they share.
 */
test('withdrawing and editing open and close at the same moment', () => {
  for (const status of ['pending_mgr', 'pending_hr', 'approved', 'rejected', 'cancelled']) {
    const e = entry({ status });
    assert.equal(
      cancelPermission(employee, e).ok,
      editPermission(employee, e).ok,
      `the two rules disagree about the employee's rights at ${status}`,
    );
  }
});

// ── what a cancellation costs, and what it does not ─────────────────────────

test('a withdrawn request is closed to HR as well, which is why it is irreversible', () => {
  // The confirm dialog tells the employee "แก้กลับไม่ได้". This is the fact
  // behind that sentence: no role has a path back.
  const cancelled = entry({ status: 'cancelled' });
  assert.equal(cancelPermission(employee, cancelled).ok, false);
  assert.equal(editPermission(employee, cancelled).ok, false);
  assert.equal(editPermission({ _id: 'hr-1', role: 'hr' }, cancelled, 'พิมพ์ผิด').ok, false);
  assert.equal(editPermission({ _id: 'ad-1', role: 'admin' }, cancelled, 'พิมพ์ผิด').ok, false);
});

test('a withdrawn request eats no quota', () => {
  assert.equal(countsTowardCap({ status: 'cancelled' }), false);
});

/**
 * "ยกเลิกเอง" and "ถูกปฏิเสธแล้วส่งใหม่" are different things and must not
 * share a budget.
 *
 * The once-only re-filing lock exists because a refusal is a decision somebody
 * made, and answering it twice is arguing. Withdrawing one's own request is
 * neither a decision nor an argument — nobody had looked at it yet. So a
 * cancelled entry offers no re-file button, claims no lock, and leaves the
 * employee free to file the same evening again as often as they need to.
 */
test('withdrawing does not spend the once-only re-filing right', () => {
  assert.equal(refileState(entry({ status: 'cancelled' })), null);
  assert.equal(refileState(entry({ status: 'cancelled', resubmittedTo: null })), null);
});

test('a cancelled request is never itself re-filed — a new one starts blank', () => {
  // 'open' is what puts a ส่งใหม่ button on a row. A withdrawal must never
  // produce one: there is no refusal to correct, and the chain it would start
  // would spend a right the employee never used.
  assert.notEqual(refileState(entry({ status: 'cancelled' })), 'open');
  assert.notEqual(refileState(entry({ status: 'cancelled' })), 'used');
});

test('cancelling repeatedly is unlimited — no state accumulates to run out of', () => {
  // Nothing about a withdrawal is recorded on a counter, so ten cancelled
  // requests leave the eleventh exactly as free as the first.
  const history = Array.from({ length: 10 }, () => entry({ status: 'cancelled' }));
  for (const h of history) assert.equal(refileState(h), null);
  assert.deepEqual(cancelPermission(employee, entry()), { ok: true });
});
