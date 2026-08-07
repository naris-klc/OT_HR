import test from 'node:test';
import assert from 'node:assert/strict';
import { latestPerChain } from '../lib/entries.js';

const entry = (id, over = {}) => ({ _id: id, refiledFrom: null, ...over });

test('a month of ordinary requests loses nothing', () => {
  const list = [entry('a'), entry('b'), entry('c')];
  const { shown, hidden } = latestPerChain(list);
  assert.deepEqual(shown.map((e) => e._id), ['a', 'b', 'c']);
  assert.equal(hidden.length, 0);
});

test('the refused request folds into the one that replaced it', () => {
  const parent = entry('p');
  const child = entry('c', { refiledFrom: 'p' });
  const { shown, hidden } = latestPerChain([child, parent]);
  assert.deepEqual(shown.map((e) => e._id), ['c']);
  assert.deepEqual(hidden.map((e) => e._id), ['p']);
});

test('order is the order it came in — the filter only removes', () => {
  const list = [entry('a'), entry('c', { refiledFrom: 'p' }), entry('p'), entry('b')];
  const { shown } = latestPerChain(list);
  assert.deepEqual(shown.map((e) => e._id), ['a', 'c', 'b']);
});

test('refiledFrom populated to a document reads the same as a bare id', () => {
  const child = entry('c', { refiledFrom: { _id: 'p', workDate: '2026-08-08' } });
  const { shown, hidden } = latestPerChain([child, entry('p')]);
  assert.deepEqual(shown.map((e) => e._id), ['c']);
  assert.deepEqual(hidden.map((e) => e._id), ['p']);
});

test('ObjectId-shaped ids compare by value, not by reference', () => {
  const oid = (s) => ({ toString: () => s });
  const child = entry(oid('c'), { refiledFrom: oid('p') });
  const { shown, hidden } = latestPerChain([child, entry(oid('p'))]);
  assert.equal(shown.length, 1);
  assert.equal(String(hidden[0]._id), 'p');
});

/**
 * The rule that keeps a refusal from vanishing. A re-filing may carry a
 * corrected date that lands it in the next month, or fall outside `limit` — and
 * a parent hidden with no child on screen would be a refusal removed from the
 * record with nothing left pointing at it.
 */
test('a replaced request whose replacement is not in the set stays visible', () => {
  const parent = entry('p', { resubmittedTo: 'c' });
  const { shown, hidden } = latestPerChain([parent]);
  assert.deepEqual(shown.map((e) => e._id), ['p']);
  assert.equal(hidden.length, 0);
});

test('the child of a hidden parent is itself hidden if IT was replaced too', () => {
  // Cannot happen while refileState caps the chain at two, but the filter must
  // not depend on that: it folds every request some other request points at.
  const list = [
    entry('g'),
    entry('c', { refiledFrom: 'g' }),
    entry('gc', { refiledFrom: 'c' }),
  ];
  const { shown, hidden } = latestPerChain(list);
  assert.deepEqual(shown.map((e) => e._id), ['gc']);
  assert.deepEqual(hidden.map((e) => e._id), ['g', 'c']);
});

test('an empty month is empty on both sides', () => {
  const { shown, hidden } = latestPerChain([]);
  assert.deepEqual(shown, []);
  assert.deepEqual(hidden, []);
});
