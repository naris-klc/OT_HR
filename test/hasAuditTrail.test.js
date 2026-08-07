import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAuditTrail } from '../lib/entries.js';

const ev = (action) => ({ action, at: new Date('2026-08-07T10:00:00Z') });

test('a request nobody has touched since filing has nothing to open', () => {
  assert.equal(hasAuditTrail({ history: [ev('submit')] }), false);
});

test('anything past the original filing counts — not only edits', () => {
  for (const second of ['edit', 'hr_edit', 'recompute', 'approve_mgr', 'reject_mgr']) {
    assert.equal(hasAuditTrail({ history: [ev('submit'), ev(second)] }), true, second);
  }
});

/**
 * The regression this file exists for. A request filed to replace a refused
 * one logs a single `submit` of its own, so counting its own history reported
 * "no history" on exactly the rows carrying a refusal worth reading.
 */
test('a re-filed request has a trail even before anything happens to it', () => {
  const child = { history: [ev('submit')], refiledFrom: 'parent-1' };
  assert.equal(hasAuditTrail(child), true);
});

test('the parent link counts whether or not it has been populated', () => {
  assert.equal(hasAuditTrail({ history: [ev('submit')], refiledFrom: 'parent-1' }), true);
  assert.equal(
    hasAuditTrail({ history: [ev('submit')], refiledFrom: { _id: 'parent-1' } }),
    true,
  );
});

test('an explicit null parent is not a parent', () => {
  assert.equal(hasAuditTrail({ history: [ev('submit')], refiledFrom: null }), false);
});

test('an entry with no history at all does not throw', () => {
  assert.equal(hasAuditTrail({}), false);
  assert.equal(hasAuditTrail(null), false);
  assert.equal(hasAuditTrail(undefined), false);
});
