import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { queueCapUsage } from '../src/services/otService.js';
import { capFigure, overCap, usageInMonth } from '../lib/caps.js';
import { latestPerSession } from '../lib/reports.js';
import { BUCKETS } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * The running total the approval queue puts beside a row.
 *
 * Every case here is about one of two things: whether the queue's figure is the
 * SAME figure ตรวจสอบรายเดือน prints for that person and month, and whether the
 * queue can be made to ask the database once per row.
 *
 * No mongoose. `queueCapUsage` takes its reader as an argument, so these tests
 * hand it a fixture and a call counter — which means the batching itself is
 * under test rather than assumed from the shape of the code.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY = { ...DEFAULT_POLICY };

// ── a fixture database ──────────────────────────────────────────────────────

/**
 * Enough of a query engine to answer the two filters `queueCapUsage` builds:
 * `status: { $in }` at the top with an `$or` of `{ period, employee: { $in } }`
 * or `{ employee: { $in }, workDate: { $gte, $lte } }` under it.
 *
 * Written out rather than stubbed to return everything, because two of the
 * rules below (a refused request counts nowhere; an entry belongs to its own
 * month) live IN the filter — a fake that ignored it would pass them by
 * accident and go on passing them after the filter was deleted.
 */
function matches(entry, clause) {
  return Object.entries(clause).every(([field, cond]) => {
    const value = field === 'employee' ? String(entry.employee) : entry[field];
    if (cond && typeof cond === 'object') {
      if ('$in' in cond) return cond.$in.map(String).includes(String(value));
      if ('$gte' in cond && !(value >= cond.$gte)) return false;
      if ('$lte' in cond && !(value <= cond.$lte)) return false;
      return true;
    }
    return String(value) === String(cond);
  });
}

function reader(dataset) {
  const calls = [];
  const find = async (filter) => {
    calls.push(filter);
    const { $or, ...top } = filter;
    return dataset.filter((e) => matches(e, top) && (!$or || $or.some((c) => matches(e, c))));
  };
  return { find, calls };
}

let seq = 0;

/** One computed entry, in the shape a lean read hands back. */
function entry({
  id, employee = 'emp1', workDate = '2026-08-06', otHours = 3,
  status = 'pending_mgr', startTime = '18:00', endTime = '21:00', endsNextDay = false,
  segments, createdAt = '2026-08-06T10:00:00.000Z', department,
} = {}) {
  seq += 1;
  return {
    _id: id || `entry-${seq}`,
    employee,
    department,
    period: workDate.slice(0, 7),
    workDate,
    startTime,
    endTime,
    endsNextDay,
    status,
    createdAt,
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: otHours,
      [BUCKETS.OT15_HOLIDAY]: 0,
      [BUCKETS.OT3_HOLIDAY]: 0,
    },
    totals: { otHours, clockHours: otHours, weightedHours: otHours * 1.5 },
    segments: segments || [{
      date: workDate, hours: otHours, minutes: otHours * 60,
      bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5,
    }],
  };
}

/** A department as the queue rows carry it, populated. */
const dept = (monthlyCapHours = null, weeklyCapHours = null) => ({
  _id: 'dept1', name: 'ผลิต', monthlyCapHours, weeklyCapHours,
});

/**
 * What ตรวจสอบรายเดือน prints for one person's month — the report route's own
 * steps, in its own order: filter to the period, drop superseded filings,
 * count. If the queue disagrees with this, the two screens disagree.
 */
function monthlyReviewFigure(dataset, employee, period) {
  const mine = dataset.filter((e) => (
    String(e.employee) === employee
    && e.period === period
    && ['pending_mgr', 'pending_hr', 'approved'].includes(e.status)
  ));
  return usageInMonth(latestPerSession(mine).shown, POLICY).usedHours;
}

// ── the two screens quote the same number ───────────────────────────────────

test('the queue shows the figure ตรวจสอบรายเดือน shows for the same person and month', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(40) });
  const dataset = [
    entry({ employee: 'emp1', workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    entry({ employee: 'emp1', workDate: '2026-08-11', otHours: 7.5, status: 'pending_hr' }),
    row,
  ];

  const { find } = reader(dataset);
  const usage = await queueCapUsage([row], { policy: POLICY, find });

  assert.equal(
    usage.get('live').month.usedHours,
    monthlyReviewFigure(dataset, 'emp1', '2026-08'),
  );
  assert.equal(usage.get('live').month.usedHours, 16.5);
  assert.equal(usage.get('live').month.capHours, 40);
});

/**
 * And the agreement is structural, not a coincidence these fixtures happen to
 * produce: both screens count with `usageInMonth`, and neither carries a second
 * copy of the three steps it performs.
 *
 * Read as text because the route resolves `@/…` through the Next alias, which
 * `node --test` does not — the same reason test/rejectedNeverCounted.test.js
 * reads its files.
 */
test('both screens count with the shared function rather than each with its own', () => {
  const review = readFileSync(join(ROOT, 'app/api/reports/monthly/[period]/route.js'), 'utf8');
  const service = readFileSync(join(ROOT, 'src/services/otService.js'), 'utf8');

  assert.match(review, /usageInMonth\(/, 'ตรวจสอบรายเดือน no longer counts with the shared function');
  assert.match(service, /usageInMonth\(/, 'the queue/cap figures no longer count with the shared function');
  assert.doesNotMatch(review, /capUsage\(summariseEntries/, 'the review screen grew its own copy back');
  assert.doesNotMatch(service, /capUsage\(summariseEntries\(shown/, 'the service grew its own copy back');
});

// ── the row is already in the number ────────────────────────────────────────

/**
 * `pending_mgr` counts against a ceiling from the moment it is filed, so the
 * request being decided is INSIDE the total shown beside it. The screen has to
 * be able to say so, which means the loader has to report it — the alternative
 * is a reviewer adding the two together and refusing a request that was fine.
 */
test('the row being reviewed is counted in its own running total, and says so', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    row,
  ]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.counted, true);
  assert.equal(usage.month.adding, 3);
  assert.equal(usage.month.usedHours, 9, 'the pending request is missing from its own total');
});

test('a filing superseded by a later one for the same session is not claimed to be included', async () => {
  // The same employee, date and clock window filed twice. Only the later one
  // counts (latestPerSession), so the earlier row must not tell the reviewer
  // its hours are in the figure.
  const early = entry({
    id: 'early', workDate: '2026-08-06', otHours: 3, department: dept(40),
    createdAt: '2026-08-06T09:00:00.000Z',
  });
  const late = entry({
    id: 'late', workDate: '2026-08-06', otHours: 4, department: dept(40),
    createdAt: '2026-08-06T18:00:00.000Z',
  });
  const { find } = reader([early, late]);

  const usage = await queueCapUsage([early, late], { policy: POLICY, find });
  assert.equal(usage.get('early').counted, false);
  assert.equal(usage.get('early').month.adding, 0);
  assert.equal(usage.get('late').counted, true);
  // One session, counted once — at the later filing's hours.
  assert.equal(usage.get('early').month.usedHours, 4);
  assert.equal(usage.get('late').month.usedHours, 4);
});

// ── refused and withdrawn hours count nowhere ───────────────────────────────

test('rejected and cancelled requests are not in the running total', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }),
    entry({ workDate: '2026-08-04', otHours: 8, status: 'rejected' }),
    entry({ workDate: '2026-08-05', otHours: 9, status: 'cancelled' }),
    row,
  ]);

  const usage = await queueCapUsage([row], { policy: POLICY, find });
  assert.equal(usage.get('live').month.usedHours, 9, 'a refused or withdrawn request ate into the month');
});

// ── each row against its own month ──────────────────────────────────────────

/**
 * The เดือน filter offers ทุกเดือน, so one queue holds rows from several
 * periods. Each has to be measured against the month IT belongs to — a row for
 * 1 สิงหาคม compared against July's total is a number that is wrong in a way
 * nothing on the screen would reveal.
 */
test('a queue holding two months measures each row against its own month', async () => {
  const august = entry({ id: 'aug', workDate: '2026-08-01', otHours: 3, department: dept(40) });
  const july = entry({ id: 'jul', workDate: '2026-07-28', otHours: 3, department: dept(40) });
  const { find } = reader([
    entry({ workDate: '2026-07-06', otHours: 20, status: 'approved' }),
    entry({ workDate: '2026-08-04', otHours: 5, status: 'approved' }),
    august,
    july,
  ]);

  const usage = await queueCapUsage([august, july], { policy: POLICY, find });
  assert.equal(usage.get('aug').month.period, '2026-08');
  assert.equal(usage.get('aug').month.usedHours, 8);
  assert.equal(usage.get('jul').month.period, '2026-07');
  assert.equal(usage.get('jul').month.usedHours, 23);
});

/**
 * A shift that opens on the last night of a month and closes in the next one.
 *
 * The report divides the year by the stored `period`, which is `workDate`
 * sliced — so BOTH halves count in August, and the queue has to divide it the
 * same way or its total will not match the sheet HR signs. This is deliberately
 * NOT how the weekly window treats the same entry (see below): a week is a
 * range of dates, a month is a field.
 */
test('a shift crossing month-end counts wholly in the month it started', async () => {
  const overnight = entry({
    id: 'overnight',
    workDate: '2026-08-31',
    startTime: '22:00',
    endTime: '02:00',
    endsNextDay: true,
    otHours: 4,
    department: dept(40),
    segments: [
      { date: '2026-08-31', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
      { date: '2026-09-01', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
    ],
  });
  const september = entry({ id: 'sep', workDate: '2026-09-04', otHours: 5, department: dept(40) });
  const { find } = reader([overnight, september]);

  const usage = await queueCapUsage([overnight, september], { policy: POLICY, find });

  assert.equal(usage.get('overnight').month.period, '2026-08');
  assert.equal(usage.get('overnight').month.usedHours, 4, 'the September half was cut off the August total');
  // And September carries only September's own request — not the two hours the
  // August shift spilled into it.
  assert.equal(usage.get('sep').month.period, '2026-09');
  assert.equal(usage.get('sep').month.usedHours, 5);
});

// ── an unset ceiling ────────────────────────────────────────────────────────

test('a department with no monthly ceiling still shows its running total, and no "/ 0"', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(null) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }), row]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.month.capHours, null);
  assert.equal(usage.month.exceeded, false);
  assert.equal(usage.month.usedHours, 9, 'the total was hidden along with the missing ceiling');

  // What the screen prints from those two values.
  assert.equal(capFigure(usage.month.usedHours, usage.month.capHours), '9');
  assert.doesNotMatch(capFigure(usage.month.usedHours, usage.month.capHours), /\//);
  assert.equal(capFigure(16.5, 40), '16.5 / 40');
});

test('a typed ceiling of zero is a real ceiling and prints as one', () => {
  // The distinction a `|| null` would destroy in either direction.
  assert.equal(capFigure(3, 0), '3 / 0');
  assert.equal(overCap(3, 0), true);
  assert.equal(overCap(3, null), false);
});

// ── over the ceiling ────────────────────────────────────────────────────────

test('over the ceiling is flagged on the same test the review screen uses', async () => {
  const row = entry({ id: 'live', otHours: 3, workDate: '2026-08-20', department: dept(10) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 8, status: 'approved' }), row]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.month.usedHours, 11);
  assert.equal(usage.month.exceeded, true);
  assert.equal(usage.month.exceeded, overCap(usage.month.usedHours, usage.month.capHours));
});

test('sitting exactly on the ceiling is not over it', () => {
  assert.equal(overCap(40, 40), false);
  assert.equal(overCap(40.01, 40), true);
});

// ── the weekly ceiling, where one is set ────────────────────────────────────

test('no weekly ceiling means no weekly figures — and no query to find that out', async () => {
  const row = entry({ id: 'live', workDate: '2026-08-06', department: dept(40, null) });
  const { find, calls } = reader([row]);

  const usage = await queueCapUsage([row], { policy: POLICY, find });
  assert.deepEqual(usage.get('live').weeks, []);
  assert.equal(calls.length, 1, 'a week query was issued for a department that has no weekly ceiling');
});

test('a weekly ceiling adds the week the row falls in, alongside the month', async () => {
  // 2026-08-06 is a Thursday; its Monday–Sunday week opens on the 3rd.
  const row = entry({ id: 'live', workDate: '2026-08-06', otHours: 3, department: dept(40, 12) });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 4, status: 'approved' }),
    entry({ workDate: '2026-08-11', otHours: 9, status: 'approved' }), // the next week
    row,
  ]);

  const usage = (await queueCapUsage([row], { policy: POLICY, find })).get('live');
  assert.equal(usage.month.usedHours, 16);
  assert.equal(usage.weeks.length, 1);
  assert.deepEqual(
    { ...usage.weeks[0] },
    {
      weekStart: '2026-08-03',
      weekEnd: '2026-08-09',
      usedHours: 7,
      capHours: 12,
      adding: 3,
      exceeded: false,
    },
  );
});

/**
 * The same entry the month refuses to split, split by the week — because the
 * week is a range of dates and the two halves fell in two of them.
 */
test('a shift crossing into a new week is measured against both weeks', async () => {
  const overnight = entry({
    id: 'overnight',
    workDate: '2026-08-09', // Sunday
    startTime: '22:00',
    endTime: '02:00',
    endsNextDay: true,
    otHours: 4,
    department: dept(40, 12),
    segments: [
      { date: '2026-08-09', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
      { date: '2026-08-10', hours: 2, minutes: 120, bucket: BUCKETS.OT15_WEEKDAY, multiplier: 1.5 },
    ],
  });
  const { find } = reader([
    entry({ workDate: '2026-08-03', otHours: 2, status: 'approved' }),
    entry({ workDate: '2026-08-10', otHours: 11, status: 'approved' }),
    overnight,
  ]);

  const usage = (await queueCapUsage([overnight], { policy: POLICY, find })).get('overnight');
  assert.equal(usage.weeks.length, 2);

  const closing = usage.weeks.find((w) => w.weekStart === '2026-08-03');
  const opening = usage.weeks.find((w) => w.weekStart === '2026-08-10');
  assert.equal(closing.usedHours, 4, '2 already there + the Sunday half');
  assert.equal(closing.exceeded, false);
  assert.equal(opening.usedHours, 13, '11 already there + the Monday half');
  assert.equal(opening.exceeded, true, 'the week it finished in is over the ceiling');
  // The month is not split by any of this.
  assert.equal(usage.month.usedHours, 17);
});

// ── one query per window, however long the queue ────────────────────────────

/**
 * The rule this exists to keep: a queue of ten rows asks the database the same
 * number of times a queue of one does.
 *
 * A per-row lookup is the obvious way to write this and it is the way that
 * turns an HR queue at month end into a hundred round trips — the same trap
 * `birthDatesFor` was written to avoid in the replay loop.
 */
const MAX_QUERIES = 2; // one for the months on screen, one for the weeks

test('a ten-row queue costs a fixed number of queries, not one per row', async () => {
  const rows = [];
  const dataset = [];
  for (let i = 0; i < 10; i++) {
    const row = entry({
      id: `row-${i}`,
      employee: `emp${i}`,
      workDate: `2026-08-${String(i + 3).padStart(2, '0')}`,
      department: dept(40, 12),
    });
    rows.push(row);
    dataset.push(row);
    dataset.push(entry({ employee: `emp${i}`, workDate: '2026-08-02', otHours: 5, status: 'approved' }));
  }

  const { find, calls } = reader(dataset);
  const usage = await queueCapUsage(rows, { policy: POLICY, find });

  assert.equal(usage.size, 10);
  assert.ok(
    calls.length <= MAX_QUERIES,
    `${calls.length} queries for 10 rows — the loader is asking per row`,
  );
  // And every row got a real figure out of those two reads.
  for (const row of rows) {
    assert.equal(usage.get(row._id).month.usedHours, 8, row._id);
  }
});

test('rows spanning several months and weeks still cost the same two queries', async () => {
  const rows = [
    entry({ id: 'a', employee: 'emp1', workDate: '2026-07-28', department: dept(40, 12) }),
    entry({ id: 'b', employee: 'emp2', workDate: '2026-08-04', department: dept(40, 12) }),
    entry({ id: 'c', employee: 'emp3', workDate: '2026-09-15', department: dept(40, 12) }),
  ];
  const { find, calls } = reader(rows);

  await queueCapUsage(rows, { policy: POLICY, find });
  assert.ok(calls.length <= MAX_QUERIES, `${calls.length} queries for 3 months`);
});

test('an empty queue asks nothing at all', async () => {
  const { find, calls } = reader([]);
  const usage = await queueCapUsage([], { policy: POLICY, find });
  assert.equal(usage.size, 0);
  assert.equal(calls.length, 0);
});

test('rows naming no employee are skipped rather than queried for', async () => {
  // An `$or: []` is a malformed query in mongo, not an empty result — it would
  // fail the whole list request rather than blank one column.
  const orphan = { ...entry({ id: 'orphan' }), employee: null };
  const { find, calls } = reader([orphan]);

  const usage = await queueCapUsage([orphan], { policy: POLICY, find });
  assert.equal(usage.size, 0);
  assert.equal(calls.length, 0);
});

// ── the basis follows policy, in both windows ───────────────────────────────

test('a weighted ceiling counts weighted hours — the row and the total together', async () => {
  const weighted = { ...POLICY, capBasis: 'weighted' };
  const row = entry({ id: 'live', otHours: 4, workDate: '2026-08-20', department: dept(40) });
  const { find } = reader([entry({ workDate: '2026-08-03', otHours: 6, status: 'approved' }), row]);

  const usage = (await queueCapUsage([row], { policy: weighted, find })).get('live');
  assert.equal(usage.basis, 'weighted');
  assert.equal(usage.month.usedHours, 15, '(6 + 4) hours at ×1.5');
  assert.equal(usage.month.adding, 6, 'the row own contribution is on the same basis as the total');
});
