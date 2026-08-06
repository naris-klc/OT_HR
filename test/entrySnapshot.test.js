import test from 'node:test';
import assert from 'node:assert/strict';

import { sameSession, sameValue, ENTERED_FIELDS } from '../lib/entries.js';

/**
 * The rule that decides whether an edit keeps a `history.before` snapshot.
 *
 * It has to say "unchanged" for the shape differences between a stored entry
 * and a freshly-parsed payload, and "changed" for anything the employee
 * actually typed — a snapshot skipped is a version of the form gone for good.
 */

const SESSION = {
  workDate: '2026-08-03',
  startTime: '17:00',
  endTime: '20:00',
  endsNextDay: false,
  noBreakTaken: false,
  description: 'สอบเทียบชุด PM-3000',
};

test('a save that changed nothing is not treated as an edit', () => {
  assert.equal(sameSession(SESSION, { ...SESSION }), true);
});

test('every entered field on its own marks the entry as changed', () => {
  const moved = {
    workDate: '2026-08-04',
    startTime: '18:00',
    endTime: '21:00',
    endsNextDay: true,
    noBreakTaken: true,
    description: 'สอบเทียบชุด PM-4000',
  };
  for (const field of ENTERED_FIELDS) {
    assert.equal(
      sameSession(SESSION, { ...SESSION, [field]: moved[field] }),
      false,
      field,
    );
  }
});

test('a missing boolean and an explicit false are the same answer', () => {
  const { endsNextDay, noBreakTaken, ...withoutFlags } = SESSION;
  assert.equal(sameSession(SESSION, withoutFlags), true);
  assert.equal(sameValue(undefined, false), true);
  assert.equal(sameValue(undefined, true), false);
});

test('an absent description and an empty one are the same answer', () => {
  assert.equal(sameValue(undefined, ''), true);
  assert.equal(sameValue(null, ''), true);
});

test('recomputed hours alone are not an edit — they follow from the fields', () => {
  assert.equal(
    sameSession({ ...SESSION, otHours: 3 }, { ...SESSION, otHours: 6 }),
    true,
  );
});

test('a version that was never captured is never claimed to be unchanged', () => {
  assert.equal(sameSession(null, SESSION), false);
  assert.equal(sameSession(SESSION, undefined), false);
});
