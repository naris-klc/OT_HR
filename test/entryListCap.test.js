import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, capFor, takeCapped,
} from '../lib/entries.js';

/**
 * A LIST NEVER STOPS SHORT WITHOUT SAYING SO.
 *
 * /api/entries has always ended at 500 rows and never mentioned it. No screen
 * passes `limit`, so 500 was every one of their ceilings, and the rows lost
 * were the oldest — the query sorts by `workDate` descending, so the first
 * thing a full queue drops is the requests that have waited longest for a
 * signature.
 *
 * The badge beside that queue is counted with `countDocuments`, deliberately,
 * so that it cannot disagree with the screen it opens. The silent ceiling is
 * what broke that: 620 on the badge, 500 in the table, and nothing anywhere
 * saying which to believe. These tests pin the two halves of the fix — the
 * ceiling is bounded and predictable, and a list that hit it knows it did.
 *
 * Run with: npm test
 */

test('no limit asked for is the default ceiling, not no ceiling', () => {
  for (const asked of [undefined, null, '', 'ทั้งหมด', NaN]) {
    assert.equal(capFor(asked), DEFAULT_LIST_LIMIT, String(asked));
  }
});

test('nought and negatives are not a ceiling of nought', () => {
  // `?limit=0` reads as "no opinion", the same as omitting it. A literal zero
  // would return an empty queue that looks exactly like a cleared one.
  for (const asked of ['0', 0, '-1', -500]) {
    assert.equal(capFor(asked), DEFAULT_LIST_LIMIT, String(asked));
  }
});

test('a caller may raise the ceiling, up to the maximum and no further', () => {
  assert.equal(capFor('2000'), 2000);
  assert.equal(capFor(MAX_LIST_LIMIT), MAX_LIST_LIMIT);
  assert.equal(capFor('999999'), MAX_LIST_LIMIT);
});

test('Infinity is not a number a query string may ask for', () => {
  // `?limit=Infinity` parses to a real value that clamping would honour as
  // "the maximum". It is treated as no opinion instead: raising the ceiling is
  // an explicit act by a screen that knows what it is paying for, and a
  // ceiling can only ever be raised by a figure somebody actually typed.
  assert.equal(capFor(Infinity), DEFAULT_LIST_LIMIT);
  assert.equal(capFor('Infinity'), DEFAULT_LIST_LIMIT);
});

test('a fractional limit floors rather than reaching mongoose as a fraction', () => {
  assert.equal(capFor('250.7'), 250);
});

test('a full page reports that it is full', () => {
  // The fetch asks for cap + 1. That one extra document is the whole signal.
  const fetched = Array.from({ length: 11 }, (_, i) => i);
  const { rows, truncated } = takeCapped(fetched, 10);
  assert.equal(truncated, true);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'the extra row is dropped, not shown');
});

test('a page sitting exactly on the ceiling is not truncated', () => {
  // Fetching cap + 1 and getting cap back means there is no cap + 1th row.
  const { rows, truncated } = takeCapped(Array.from({ length: 10 }, (_, i) => i), 10);
  assert.equal(truncated, false);
  assert.equal(rows.length, 10);
});

test('a short page is untouched and unflagged', () => {
  const { rows, truncated } = takeCapped([1, 2, 3], 500);
  assert.equal(truncated, false);
  assert.deepEqual(rows, [1, 2, 3]);
});

test('an empty queue is an empty answer, not a truncated one', () => {
  const { rows, truncated } = takeCapped([], 500);
  assert.equal(truncated, false);
  assert.deepEqual(rows, []);
});

test('what comes back never exceeds what was asked for', () => {
  // The property the two functions exist to hold together: whatever a caller
  // puts in `?limit=`, the response is bounded and the boundary is announced.
  for (const asked of ['', '10', '5000', '999999', '-3', 'x']) {
    const cap = capFor(asked);
    const { rows, truncated } = takeCapped(Array.from({ length: 6000 }, (_, i) => i), cap);
    assert.ok(rows.length <= cap, `${asked} — returned more rows than the cap`);
    assert.ok(cap <= MAX_LIST_LIMIT, `${asked} — cap above the maximum`);
    assert.equal(truncated, true, `${asked} — 6000 rows fits under no ceiling this route offers`);
  }
});
