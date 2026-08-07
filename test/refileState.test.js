import test from 'node:test';
import assert from 'node:assert/strict';
import { refileState } from '../lib/entries.js';

const entry = (over = {}) => ({
  status: 'rejected',
  refiledFrom: null,
  resubmittedTo: null,
  ...over,
});

test('a request nobody refused has nothing to re-file', () => {
  for (const status of ['pending_mgr', 'pending_hr', 'approved', 'cancelled']) {
    assert.equal(refileState(entry({ status })), null, status);
  }
});

test('refused once, never replaced — this is the one chance', () => {
  assert.equal(refileState(entry()), 'open');
});

test('the chance is spent the moment a replacement exists', () => {
  assert.equal(refileState(entry({ resubmittedTo: 'child-1' })), 'used');
});

test('a replacement that was refused too is the end of it', () => {
  assert.equal(refileState(entry({ refiledFrom: 'parent-1' })), 'final');
});

/**
 * The two-level ceiling is not a rule anyone has to remember to check — it
 * falls out of the shape. A request that already has a parent can never be
 * offered a child, so a chain cannot reach three.
 */
test('a replacement is never offered a replacement of its own', () => {
  const child = entry({ refiledFrom: 'parent-1' });
  assert.equal(refileState(child), 'final');
  assert.notEqual(refileState(child), 'open');
});

test('a half-written row — parent and child pointers both set — still reads as final', () => {
  // Should not occur: the claim filter refuses a parent that has refiledFrom.
  // If it ever does, "closed" is the safe reading, not "here is another go".
  assert.equal(refileState(entry({ refiledFrom: 'p', resubmittedTo: 'c' })), 'final');
});

test('a missing entry does not throw', () => {
  assert.equal(refileState(null), null);
  assert.equal(refileState(undefined), null);
});

test('entries written before the fields existed read as open, not locked', () => {
  // No resubmittedTo key at all — an older document. The employee keeps the
  // chance rather than silently losing it to a schema change.
  assert.equal(refileState({ status: 'rejected' }), 'open');
});
