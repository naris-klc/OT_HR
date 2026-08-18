import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  describeClash, findOverlaps, overlapMessage, overlapsWindow, sessionWindow,
} from '../lib/overlap.js';
import { OtValidationError } from '../src/lib/otEngine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * เวลาทับซ้อน — the rule, as arithmetic over two windows.
 *
 * Every case here is one that `latestPerSession` in lib/reports.js cannot see:
 * its key is the whole window, so it fires on two filings of exactly the same
 * session and on nothing else. The pair that started this — 17:00–19:00 and
 * 18:30–20:30 on one evening — is two different keys, and before this module
 * existed both counted, both printed and both went to accounting.
 *
 * No database anywhere below. `findOverlaps` takes the rows; lib/overlapQuery.js
 * is what reads them.
 */

const at = (workDate, startTime, endTime, extra = {}) => ({
  workDate, startTime, endTime, endsNextDay: false, ...extra,
});

// ── the timeline ────────────────────────────────────────────────────────────

test('a window is minutes on one timeline shared by every date', () => {
  const a = sessionWindow(at('2026-08-10', '17:00', '19:00'));
  const b = sessionWindow(at('2026-08-11', '17:00', '19:00'));
  assert.equal(b.start - a.start, 1440, 'one day apart is 1440 minutes apart');
  assert.equal(a.end - a.start, 120);
});

test('endsNextDay adds a whole day rather than being inferred from the times', () => {
  const overnight = sessionWindow(at('2026-08-10', '22:00', '02:00', { endsNextDay: true }));
  assert.equal(overnight.end - overnight.start, 240);

  // 22:00 → 22:00 with the flag set is the 24-hour session `computeSession`
  // allows. Inferred from the times it would be zero minutes long and would
  // therefore clash with nothing at all.
  const full = sessionWindow(at('2026-08-10', '22:00', '22:00', { endsNextDay: true }));
  assert.equal(full.end - full.start, 1440);
});

test('a date or a time it cannot read throws the engine own refusal', () => {
  assert.throws(() => sessionWindow(at('2026-13-01', '17:00', '19:00')), OtValidationError);
  assert.throws(() => sessionWindow(at('2026-08-10', '25:00', '19:00')), OtValidationError);
});

// ── the comparison ──────────────────────────────────────────────────────────

test('sessions that touch do not overlap', () => {
  // Clocking off one job and onto another at 19:00 is the commonest legitimate
  // pair of requests in the building. A `<=` here would refuse it.
  const a = sessionWindow(at('2026-08-10', '17:00', '19:00'));
  const b = sessionWindow(at('2026-08-10', '19:00', '21:00'));
  assert.equal(overlapsWindow(a, b), false);
  assert.equal(overlapsWindow(b, a), false);
});

test('the pair this module was written for is caught, with the span', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00'), status: 'pending_mgr' }];
  const [clash] = findOverlaps(at('2026-08-10', '18:30', '20:30'), existing);
  assert.ok(clash, '18:30–20:30 must clash with 17:00–19:00');
  assert.equal(clash.minutes, 30);
});

test('one session wholly inside another is caught', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '21:00') }];
  const [clash] = findOverlaps(at('2026-08-10', '18:00', '19:00'), existing);
  assert.equal(clash.minutes, 60);
});

test('the identical window is caught — and is what latestPerSession also drops', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00') }];
  const [clash] = findOverlaps(at('2026-08-10', '17:00', '19:00'), existing);
  assert.equal(clash.minutes, 120);
});

test('the same window on a different day does not clash', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00') }];
  assert.equal(findOverlaps(at('2026-08-11', '17:00', '19:00'), existing).length, 0);
});

// ── midnight, which is the whole reason this is not a string comparison ─────

test('an overnight shift is caught by a request filed against the following day', () => {
  // 9 Aug 22:00 → 10 Aug 02:00, against a fresh 10 Aug 01:00–03:00. Two
  // different workDates, so no key comparison could ever have found this.
  const existing = [{
    _id: 'a', ...at('2026-08-09', '22:00', '02:00', { endsNextDay: true }),
  }];
  const [clash] = findOverlaps(at('2026-08-10', '01:00', '03:00'), existing);
  assert.ok(clash, 'yesterday overnight shift reaches into today');
  assert.equal(clash.minutes, 60);
});

test('a new overnight shift is caught by a request already filed on the next day', () => {
  const existing = [{ _id: 'a', ...at('2026-08-11', '01:00', '03:00') }];
  const [clash] = findOverlaps(
    at('2026-08-10', '22:00', '02:00', { endsNextDay: true }),
    existing,
  );
  assert.equal(clash.minutes, 60);
});

test('an overnight shift ending exactly where the next begins does not clash', () => {
  const existing = [{ _id: 'a', ...at('2026-08-11', '02:00', '05:00') }];
  assert.equal(
    findOverlaps(at('2026-08-10', '22:00', '02:00', { endsNextDay: true }), existing).length,
    0,
  );
});

/**
 * WHY lib/overlapQuery.js QUERIES ONE DAY EITHER SIDE AND NO MORE.
 *
 * `computeSession` refuses anything over 24 hours, so a session reaches at
 * most one midnight past its own `workDate` — in both directions. This pins
 * that bound: the longest session the engine permits, filed two days away,
 * still cannot touch us.
 */
test('nothing two days away can reach us, which is what bounds the query', () => {
  const existing = [
    { _id: 'a', ...at('2026-08-08', '00:00', '00:00', { endsNextDay: true }) },
    { _id: 'b', ...at('2026-08-12', '00:00', '00:00', { endsNextDay: true }) },
  ];
  assert.equal(findOverlaps(at('2026-08-10', '00:00', '23:59'), existing).length, 0);
});

// ── the awkward rows ────────────────────────────────────────────────────────

test('excludeId keeps an edit from being refused by the entry it is editing', () => {
  const existing = [{ _id: 'self', ...at('2026-08-10', '17:00', '19:00') }];
  assert.equal(findOverlaps(at('2026-08-10', '17:00', '19:30'), existing).length, 1);
  assert.equal(
    findOverlaps(at('2026-08-10', '17:00', '19:30'), existing, { excludeId: 'self' }).length,
    0,
  );
});

test('a stored row whose own times cannot be read is skipped, not thrown on', () => {
  // One malformed historic document must not make it impossible to file any
  // new OT within a day of it — that is a worse failure than the one this
  // module prevents, and the row is already visible on every list screen.
  const existing = [
    { _id: 'bad', workDate: '2026-08-10', startTime: '??', endTime: '19:00' },
    { _id: 'good', ...at('2026-08-10', '18:00', '20:00') },
  ];
  const found = findOverlaps(at('2026-08-10', '17:00', '19:00'), existing);
  assert.equal(found.length, 1);
  assert.equal(found[0].entry._id, 'good');
});

test('every clash is reported, in the order of the day', () => {
  const existing = [
    { _id: 'late', ...at('2026-08-10', '20:00', '22:00') },
    { _id: 'early', ...at('2026-08-10', '16:00', '18:00') },
  ];
  const found = findOverlaps(at('2026-08-10', '17:00', '21:00'), existing);
  assert.deepEqual(found.map((c) => c.entry._id), ['early', 'late']);
  assert.deepEqual(found.map((c) => c.minutes), [60, 60]);
});

// ── what the person filing it reads ─────────────────────────────────────────

test('the refusal names the existing entry the way its own row prints it', () => {
  const existing = [{ _id: 'a', ...at('2026-08-10', '17:00', '19:00'), status: 'pending_mgr' }];
  const found = findOverlaps(at('2026-08-10', '18:30', '20:30'), existing);
  const line = describeClash(found[0], { statusLabel: (s) => ({ pending_mgr: 'รอหัวหน้า' }[s]) });

  assert.match(line, /2026-08-10/);
  assert.match(line, /17:00–19:00/);
  assert.match(line, /รอหัวหน้า/);
  assert.match(line, /30 นาที/);
});

test('an overnight neighbour says so, or it reads as a session running backwards', () => {
  const found = findOverlaps(at('2026-08-10', '01:00', '03:00'), [
    { _id: 'a', ...at('2026-08-09', '22:00', '02:00', { endsNextDay: true }) },
  ]);
  assert.match(describeClash(found[0]), /ข้ามคืน/);
});

test('the message names every clash rather than the first', () => {
  const found = findOverlaps(at('2026-08-10', '17:00', '21:00'), [
    { _id: 'a', ...at('2026-08-10', '16:00', '18:00') },
    { _id: 'b', ...at('2026-08-10', '20:00', '22:00') },
  ]);
  const message = overlapMessage(found);
  assert.equal(message.split('\n').filter((l) => l.startsWith('•')).length, 2);
  assert.match(message, /ทับซ้อน/);
});

// ── the routes that have to ask ─────────────────────────────────────────────

/**
 * EVERY PATH THAT WRITES A SESSION ASKS WHETHER THOSE MINUTES ARE ALREADY
 * CLAIMED.
 *
 * The same shape of pin — and the same admission — as
 * test/periodLockRoutes.test.js: the check needs a database read, so it could
 * not live inside a pure rule, and it is a helper called at the top of each
 * route instead. A route that forgets the call is a route with no overlap
 * check, and nothing in the language would say so. This is what says so.
 *
 * IF YOU ADD A PATH THAT WRITES `workDate` / `startTime` / `endTime`, add it
 * here — and if it deliberately does not need the check, say why in the list
 * rather than leaving it out.
 *
 * `app/api/settings/recompute` is deliberately absent: a policy replay recomputes
 * the hours of sessions that are already stored and moves no times, so it can
 * neither create an overlap nor resolve one.
 */
const OVERLAP_GUARDED = [
  ['app/api/entries/route.js', 'filing a new request'],
  ['app/api/entries/[id]/route.js', "an employee's own edit and HR's correction"],
  ['app/api/birthday/entries/route.js', 'ฝ่ายบุคคล filing from the scan record'],
];

for (const [file, what] of OVERLAP_GUARDED) {
  test(`${file} refuses times that clash with a live request`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /refuseOverlap\(/, `${what} — no overlap check at all`);
  });
}

test('the edit path excludes the entry it is editing, or nothing could be edited', () => {
  const src = readFileSync(join(ROOT, 'app/api/entries/[id]/route.js'), 'utf8');
  assert.match(
    src,
    /refuseOverlap\([\s\S]{0,200}?excludeId/,
    'without excludeId every PATCH is refused by the entry it is rewriting',
  );
});
