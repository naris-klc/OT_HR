import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSE_ROLES, PENDING_STATUSES, REOPEN_ROLES,
  closeRefusal, isPeriod, isPeriodClosed, lockRefusal, lockSummary, periodOf, reopenRefusal,
} from '../lib/periodLock.js';

/**
 * ปิดแล้วปิดเลย — AND ONLY AN ADMINISTRATOR OPENS IT AGAIN.
 *
 * HR's answer, 2026-08-13. Until now ฝ่ายบุคคล could correct an approved entry
 * at any time, months after the figure was exported and paid, and nothing in
 * the system said a month was finished — so nothing could refuse. The file on
 * the accounts team's desk and the rows here could drift apart permanently and
 * silently.
 *
 * These pin the rules, not the plumbing. Every function under test takes the
 * lock document and the counts it needs, so the question "may this signed-off
 * month change" is answerable without a database — which is the reason the
 * rules are in lib/periodLock.js and not spread across six route handlers.
 *
 * Run with: npm test
 */

const CLOSED = { period: '2026-08', state: 'closed', closedByName: 'ฝ่ายบุคคล' };
const REOPENED = {
  period: '2026-08', state: 'open', closedByName: 'ฝ่ายบุคคล',
  reopenedAt: new Date('2026-08-13'), reopenedByName: 'ผู้ดูแลระบบ',
};
const hr = { role: 'hr' };
const admin = { role: 'admin' };
const manager = { role: 'manager' };
const employee = { role: 'employee' };

// ── which month is this ─────────────────────────────────────────────────────

test('a work date belongs to the month it falls in, whatever the shift did', () => {
  assert.equal(periodOf('2026-08-31'), '2026-08');
  // An overnight shift is filed on the day it STARTED — the same slice the
  // entry model stamps — so a request that runs into September is August's.
  assert.equal(periodOf('2026-08-31'), periodOf('2026-08-01'));
  assert.equal(periodOf(''), '');
  assert.equal(periodOf(undefined), '');
});

test('a period is four digits and a real month', () => {
  // The routes validate their `[period]` segment with this. '2026-13' reaching
  // a countDocuments would simply return nothing, which reads on screen as a
  // month with no overtime in it rather than as a typo.
  assert.equal(isPeriod('2026-08'), true);
  assert.equal(isPeriod('2026-12'), true);
  assert.equal(isPeriod('2026-01'), true);
  for (const bad of ['2026-13', '2026-00', '2026-8', '26-08', '2026-08-01', '', null, undefined]) {
    assert.equal(isPeriod(bad), false, String(bad));
  }
});

// ── is it closed ────────────────────────────────────────────────────────────

test('a period with no lock document has never been closed', () => {
  // Every month that existed before this feature shipped is in this state, and
  // must stay exactly as editable as it was yesterday.
  assert.equal(isPeriodClosed(null), false);
  assert.equal(isPeriodClosed(undefined), false);
});

test('a reopened period is open — the close is history, not the state', () => {
  assert.equal(isPeriodClosed(CLOSED), true);
  assert.equal(isPeriodClosed(REOPENED), false);
});

// ── the refusal ─────────────────────────────────────────────────────────────

test('an open month refuses nothing', () => {
  assert.equal(lockRefusal({ lock: null, period: '2026-08', verb: 'แก้ไข' }), null);
  assert.equal(lockRefusal({ lock: REOPENED, period: '2026-08', verb: 'แก้ไข' }), null);
});

test('a closed month refuses, and says which month in words', () => {
  const refusal = lockRefusal({ lock: CLOSED, period: '2026-08', verb: 'แก้ไข' });
  assert.equal(refusal.status, 409);
  assert.match(refusal.error, /สิงหาคม 2569/, 'the month is named in Thai, as every other screen names it');
  assert.match(refusal.error, /ผู้ดูแลระบบ/, 'it does not say who can undo this');
});

test('the refusal names the action that was refused', () => {
  // So the sentence answers the button that was pressed rather than making a
  // general statement about the month.
  for (const verb of ['แก้ไข', 'ยกเลิก', 'อนุมัติ', 'ไม่อนุมัติ', 'บันทึกรายการย้อนหลัง']) {
    assert.match(lockRefusal({ lock: CLOSED, period: '2026-08', verb }).error, new RegExp(verb));
  }
});

test('it is 409 and never 403 — the right is there, the month is not', () => {
  // 403 sends somebody to ask for a role they already have. 409 sends them to
  // the person who can open the period, which is the actual next step.
  assert.equal(lockRefusal({ lock: CLOSED, period: '2026-08' }).status, 409);
});

// ── closing ─────────────────────────────────────────────────────────────────

test('ฝ่ายบุคคล and ผู้ดูแลระบบ close a month; nobody else does', () => {
  assert.deepEqual([...CLOSE_ROLES], ['hr', 'admin']);
  assert.equal(closeRefusal({ user: hr, lock: null, period: '2026-08' }), null);
  assert.equal(closeRefusal({ user: admin, lock: null, period: '2026-08' }), null);
  assert.equal(closeRefusal({ user: manager, lock: null, period: '2026-08' }).status, 403);
  assert.equal(closeRefusal({ user: employee, lock: null, period: '2026-08' }).status, 403);
});

test('a month with requests still waiting cannot be closed', () => {
  /**
   * The rule that makes this more than a role check. A month closed over
   * pending requests strands them completely — they cannot be approved,
   * refused or withdrawn, because all three paths check the lock — and the
   * only way out is an administrator reopening the month to fix a mistake the
   * system could have declined to make.
   */
  const refusal = closeRefusal({ user: hr, lock: null, pendingCount: 3, period: '2026-08' });
  assert.equal(refusal.status, 409);
  assert.match(refusal.error, /3 ใบ/, 'it does not say how many are in the way');
  assert.match(refusal.error, /สิงหาคม 2569/);
});

test('refused and withdrawn requests do not block a close', () => {
  // A month full of refusals is a month that has been dealt with. Only the two
  // waiting states count.
  assert.deepEqual([...PENDING_STATUSES], ['pending_mgr', 'pending_hr']);
  assert.equal(closeRefusal({ user: hr, lock: null, pendingCount: 0, period: '2026-08' }), null);
});

test('closing an already-closed month is refused rather than done twice', () => {
  // Not idempotence — a second close would write a second event saying
  // something that already happened.
  const refusal = closeRefusal({ user: hr, lock: CLOSED, period: '2026-08' });
  assert.equal(refusal.status, 409);
  assert.match(refusal.error, /ปิดอยู่แล้ว/);
});

test('a reopened month can be closed again, by HR, without an administrator', () => {
  // Reopening is the guarded direction. Putting a month back the way it was
  // needs no special authority.
  assert.equal(closeRefusal({ user: hr, lock: REOPENED, pendingCount: 0, period: '2026-08' }), null);
});

// ── reopening ───────────────────────────────────────────────────────────────

test('only ผู้ดูแลระบบ reopens — including not ฝ่ายบุคคล, who closed it', () => {
  /**
   * The asymmetry is the design. If the role that closes can also open, closing
   * is a preference rather than a control: the same person decides both, alone.
   * Split, a correction to a closed month always passes a second pair of hands.
   */
  assert.deepEqual([...REOPEN_ROLES], ['admin']);
  assert.equal(reopenRefusal({ user: hr, lock: CLOSED, reason: 'แก้ใบ PM-0412', period: '2026-08' }).status, 403);
  assert.equal(reopenRefusal({ user: admin, lock: CLOSED, reason: 'แก้ใบ PM-0412', period: '2026-08' }), null);
});

test('reopening without a reason is refused', () => {
  // The one path by which a signed-off, exported, possibly paid figure may
  // change. "Why" cannot be reconstructed from the entries afterwards.
  for (const reason of [undefined, null, '', '   ']) {
    const refusal = reopenRefusal({ user: admin, lock: CLOSED, reason, period: '2026-08' });
    assert.equal(refusal.status, 400, JSON.stringify(reason));
    assert.match(refusal.error, /เหตุผล/);
  }
});

test('a month that was never closed cannot be reopened', () => {
  assert.equal(reopenRefusal({ user: admin, lock: null, reason: 'x', period: '2026-08' }).status, 409);
  assert.equal(reopenRefusal({ user: admin, lock: REOPENED, reason: 'x', period: '2026-08' }).status, 409);
});

test('the role check comes before the reason check', () => {
  // A manager who types a reason should be told they may not do this at all,
  // not asked for a better reason.
  assert.equal(reopenRefusal({ user: manager, lock: CLOSED, reason: '', period: '2026-08' }).status, 403);
});

// ── what the screens say ────────────────────────────────────────────────────

test('the state reads as one sentence, in the same words everywhere', () => {
  assert.equal(lockSummary(null, '2026-08').closed, false);
  assert.match(lockSummary(null, '2026-08').text, /ยังไม่เคยปิด/);

  assert.equal(lockSummary(CLOSED, '2026-08').closed, true);
  assert.match(lockSummary(CLOSED, '2026-08').text, /ปิดแล้วโดย ฝ่ายบุคคล/);

  // A reopened month says so rather than reading as one that was never closed —
  // the difference matters to whoever has to remember to close it again.
  assert.equal(lockSummary(REOPENED, '2026-08').closed, false);
  assert.match(lockSummary(REOPENED, '2026-08').text, /เปิดอีกครั้งโดย ผู้ดูแลระบบ/);
  assert.match(lockSummary(REOPENED, '2026-08').text, /ปิดใหม่/);
});
