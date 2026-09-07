import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, capFor, takeCapped,
  byEmployeeThenLatest,
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

// ── the order the rows come back in ─────────────────────────────────────────

/**
 * เรียงใบตามรหัสพนักงาน — asked for on 2026-09-07 for EVERY บทบาท, widening
 * what 2026-09-03 did to ตรวจสอบประจำเดือน and รายงาน OT ฝ่ายบัญชี.
 *
 * These live in this file rather than in one of their own because they are a
 * property of the same list: `capFor`/`takeCapped` decide which rows come back,
 * `byEmployeeThenLatest` decides how they are laid out, and the two have to be
 * read together — the query still orders by date, so the rows a full list drops
 * are still the oldest, and NOT whoever falls past the middle of the alphabet.
 */

const row = (code, workDate, startTime = '17:00', createdAt = '2026-08-01T00:00:00Z') => ({
  employee: { code },
  workDate,
  startTime,
  createdAt,
});

const codesOf = (rows) => rows.map((r) => r.employee?.code);

test('one person’s ใบ come back together, the people in numeric code order', () => {
  /**
   * The register spells one shape two ways, so this is the same case
   * `compareCodes` exists for: character by character, PM00416 climbs above
   * PM-0412 because the padding zero beats the digit it pads.
   */
  const rows = [
    row('PM-0620', '2026-08-10'),
    row('PM00416', '2026-08-11'),
    row('PM-0412', '2026-08-09'),
    row('PM00416', '2026-08-03'),
    row('PM-0412', '2026-08-20'),
  ].sort(byEmployeeThenLatest);

  assert.deepEqual(
    codesOf(rows),
    ['PM-0412', 'PM-0412', 'PM00416', 'PM00416', 'PM-0620'],
  );
});

test('inside one person the dates stay newest first — รายการล่าสุด is the latest', () => {
  /**
   * `components/EmployeeView.jsx` draws รายการล่าสุด as the first five rows of
   * this list. Ascending dates would put the five OLDEST requests of the month
   * under a heading that says ล่าสุด, with nothing on the card saying so.
   */
  const rows = [
    row('PM-0412', '2026-08-03'),
    row('PM-0412', '2026-08-20'),
    row('PM-0412', '2026-08-11'),
  ].sort(byEmployeeThenLatest);

  assert.deepEqual(rows.map((r) => r.workDate), ['2026-08-20', '2026-08-11', '2026-08-03']);
});

test('a one-person list is exactly the order it always had — ?scope=mine is untouched', () => {
  // One code in the list means the first key decides nothing, so what is left
  // is the date order the mongo sort gave. Pinned because บันทึกและประวัติ OT
  // is the screen most people open and it was not asked to change.
  const mine = [
    row('PM-0412', '2026-08-20', '17:00'),
    row('PM-0412', '2026-08-11', '18:00'),
    row('PM-0412', '2026-08-11', '08:00'),
    row('PM-0412', '2026-08-03', '17:00'),
  ];
  assert.deepEqual([...mine].sort(byEmployeeThenLatest), mine);
});

test('two ใบ on one date are split by the clock, and then by when they were filed', () => {
  /**
   * A person can hold two requests on one date once an overnight session is
   * involved, and a re-filing can match on the clock as well. Two rows equal on
   * every key are two rows `.sort()` may return either way round — a list that
   * reorders itself between two reads of a month nobody touched.
   */
  const rows = [
    row('PM-0412', '2026-08-11', '08:00', '2026-08-11T09:00:00Z'),
    row('PM-0412', '2026-08-11', '17:00', '2026-08-11T09:00:00Z'),
    row('PM-0412', '2026-08-11', '08:00', '2026-08-12T09:00:00Z'),
  ].sort(byEmployeeThenLatest);

  assert.deepEqual(
    rows.map((r) => `${r.startTime}/${r.createdAt}`),
    [
      '17:00/2026-08-11T09:00:00Z',
      '08:00/2026-08-12T09:00:00Z',
      '08:00/2026-08-11T09:00:00Z',
    ],
  );
});

test('a row whose employee no longer resolves is placed, not thrown over', () => {
  /**
   * The same row `lib/accountingRows.js` calls ไม่ถูกนับ — an entry pointing at
   * an employee `populate` could not fill in. It reaches this list too, and a
   * comparator that threw on it would take the whole queue down rather than
   * lose one row.
   */
  const rows = [
    row('PM-0412', '2026-08-11'),
    { workDate: '2026-08-12', startTime: '17:00' },
    { employee: null, workDate: '2026-08-13', startTime: '17:00' },
  ].sort(byEmployeeThenLatest);

  assert.equal(rows.length, 3);
  // No code sorts before any code, and the two nameless rows keep a date order
  // between them rather than an arbitrary one.
  assert.deepEqual(rows.map((r) => r.workDate), ['2026-08-13', '2026-08-12', '2026-08-11']);
});
